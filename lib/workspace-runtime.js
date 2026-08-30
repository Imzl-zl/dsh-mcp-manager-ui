import { mkdir, readFile, stat } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
import { allMcpEntries, MCP_NAME } from "./mcp-registry.js";
import { readWorkspaceConfig, toMcpClientConfig, writeWorkspaceConfig, WORKSPACE_CONFIG_REL } from "./workspace-config.js";

// ---------- workspace 项目层运行时 ----------
// 项目配置的读写状态，以及 agent setup 时把项目 MCP 挂到 agent scope 的装饰器。
// 只依赖 mcp-registry 与 workspace-config，不认识 profile patch，因此可被 index.js 单向依赖。

// ---------- 模块级状态的键约定（全模块唯一一份，不要再引入第三种）----------
//   属于某个 dsh app 实例的状态 → 以 appRoot(ctx) 为键存进 WeakMap，app 消失即随之回收
//     （官方 mcp-client 的 serverName 注册表用的也是 `WeakMap keyed by ctx.root`）。
//   属于某个项目目录的状态       → 以 canonical wsPath 为键（文件路径本就全进程唯一）。
function appRoot(ctx) {
	const root = (ctx && typeof ctx === "object" && ctx.root) || ctx;
	if (!root || typeof root !== "object") throw new TypeError("mcp-manager: 需要一个 cordis context 才能定位 app root");
	return root;
}
function bucketOf(store, ctx) {
	const root = appRoot(ctx);
	let bucket = store.get(root);
	if (!bucket) { bucket = new Map(); store.set(root, bucket); }
	return bucket;
}

// 配置缓存按 app root 隔离（多 app 同进程时互不串读），每 app 内按插入序有上限。
const workspaceConfigCache = new WeakMap(); // appRoot -> Map<canonicalWsPath, { stamp, mtimeMs, size, config }>
const WORKSPACE_CACHE_LIMIT = 64;
// 某个项目目录的写序：既要串行化 read→modify→write（与全局 withPatchWrite 对称，防止并发写
// 丢更新），又要给配置缓存一个「写入代号」——写盘后自增，缓存条目记下读取时的代号，失效因此
// 不需要枚举所有 app 的缓存桶（WeakMap 不可枚举），也顺带盖住「同一 mtime 粒度内改回同样
// 字节数」这种骗过 stat 的情况。两者是同一个不变量的两面，放一张表，不各存一份。
const workspaceWriteState = new Map(); // canonicalWsPath -> { queue: Promise, stamp: number }
function workspaceWriteEntry(wsPath) {
	let state = workspaceWriteState.get(wsPath);
	if (!state) { state = { queue: Promise.resolve(), stamp: 0 }; workspaceWriteState.set(wsPath, state); }
	return state;
}
function workspaceWriteStamp(wsPath) { return workspaceWriteState.get(wsPath)?.stamp ?? 0; }
// 会话记录：本模块对该会话的项目层记账（属于哪个项目、restrict 当前展开成什么）。
// 它**不是**任何存活性凭据：会话是否还活着由 cordis 的 agentCtx.effect() 判定，
// 本代装饰器是否还在管事由 installAgentRuntime 的 generation 令牌判定。
const agentWorkspaceStates = new Map(); // agent -> { root, wsPath, restrictKey, restrictDisposer }；随 agent scope 清理
const wrappedAgentsServices = new WeakSet(); // 已包装 agents.create/resume 的服务单例
const AGENT_METHODS = ["create", "resume"];
// cordis 的 traceable proxy 用该 symbol 暴露原始服务对象；proxy 每次 ctx.get() 都新建，
// 只有解包后的实例才有稳定身份可作判重键。
const CORDIS_ORIGINAL = Symbol.for("cordis.original");
// 打在装饰函数上的标记，使“是否已包装”不依赖任何对象身份。
const AGENT_WRAPPED = Symbol.for("dsh-mcp-manager-ui.agentRuntimeWrapped");
// 项目 MCP 挂载失败（serverName 冲突/启动/连接失败）的可观测记录：Host 无法直接看到 agent 层
// 注册，因此把 setup 阶段的失败显式呈现给用户，避免“静默缺失”。
// 这两张表按 wsPath 而不按 app root 分桶：诊断对象是「某项目的某个 server」，而项目路径本身
// 就全进程唯一；即使两个 app 同时读同一项目，结论也应该是同一份。
const workspaceMountErrors = new Map(); // wsPath -> Map<serverName, errorMessage>
const workspaceRestrictErrors = new Map(); // wsPath -> { deny, error, ts }

// ---------- 项目 MCP 共享连接（每 (wsPath, serverName) 一份实例）----------
// 官方 mcp-client 的 serverName 在 ctx.root（=整个 app）内唯一，而且它同时是模型可见工具名
// `mcp__<serverName>__*` 的前缀。所以「每会话各挂一份」既会撞名，也无法用「每会话换个名字」
// 规避——换名等于换工具名，会话恢复时的历史工具调用与 prompt 缓存会一起失效。
// 改为：每 (wsPath, serverName) 只挂一份 mcp-client 到我们自建的隔离作用域上（serverName 只
// 登记一次），再把它注册出的工具定义原样投射进每个会话自己的 own 层——多个会话共享
// 同一份连接、各自可见、互不干扰。
//
// 同一 connKey 的生命周期必须串行化，否则两条异步窗口都会重新撞名：
//   1. 建连：check→await→set 之间并发 setup 会各建一份连接（serverName 在 apply 的 effect
//      里同步登记，第二个实例必抛 already in use）。解法：建连 promise 先入表，并发者共享结果。
//   2. 释放：teardown 是异步的（quiesceFiber → fiber unload），若立即删表并新建，新连接可能
//      撞上尚未归还的旧名。解法：释放后保留「disposing」占位，acquire 等它完成再新建。
//      （cordis 的 fiber unload 是 `Promise.all(_disposables)` 并行释放，serverName 实际上比 stdio
//       子进程更早归还；这里等整条 teardown 比必要更保守，换取不依赖官方内部的释放顺序。）
// 共享单连接对合规服务端无语义损失（依据见 README 的「共享连接模型」一节）；这里要解决的
// 是纯插件层的命名/生命周期串行化问题。
const sharedConnections = new WeakMap(); // appRoot -> Map<connKey, ConnCell>
// ConnCell 状态机（互斥）：
//   { entry }        —— 就绪：refs 计数在 entry 上，acquire 直接复用
//   { pending }      —— 建连中：所有并发 acquire 等待同一 promise，只建一条连接
//   { disposing }    —— 释放中：teardown 完成前保留占位，acquire 等待后新建
// ConnEntry: { key, scopeKey, scoped, fiber, refs, released, serverName, wsPath, configFingerprint }
//
// 引用所有权（本模块最关键的不变量）：一份引用由**一个 cordis effect** 唯一持有。
// acquire 返回后立刻用 `agentCtx.effect()` 把「归还」登记给会话作用域，此后所有权完全在
// cordis 手里：
//   * 会话作用域已销毁 → effect() 的 assertActive() 当场抛 INACTIVE_EFFECT，我们在 catch 里
//     归还。dsh-agent-loop 的 setupAndPublish 用 raceAbort 抛弃 setup 但不取消它，会话完全
//     可能在我们 await 建连时已经销毁——这个窗口由官方的 assertActive 关掉，不需要本模块
//     再自建一套「作用域是否还活着」的判定。
//   * 会话正常结束 → cordis 跑 disposer；重复/并发 dispose 由 effect wrapper 的 runner.epoch
//     幂等；异步 disposer 被 Fiber._unload 的 `await runDisposable(dispose)` 等待，于是会话
//     销毁不早于 MCP 连接关闭完成。
// 下面这张索引表因此**不是所有权凭据**，只是两个遍历需求的视图：tools/change 时要找到所有
// 存活 slot 补投射；HMR 卸载时要撤回所有投射。摘除与否都不影响引用是否归还。
const agentProjectSlotsByRoot = new WeakMap(); // appRoot -> Map<agent, Map<connKey, ProjectSlot>>
// ProjectSlot: { key, entry, ctx, agentCtx, agent, toolDisposers: Map<name, dispose>, release, disposed }
const scopeModulePromises = new WeakMap(); // appRoot -> Promise<dsh-scope 模块>（按 app 隔离，避免跨 app/HMR 串用）

function connKeyOf(wsPath, serverName) { return `${wsPath}\u0000${serverName}`; }
function sharedConnBucket(ctx) { return bucketOf(sharedConnections, ctx); }
function toolsServiceOf(ctx) {
	const get = typeof ctx.get === "function" ? ctx.get.bind(ctx) : null;
	return (get && get("tools")) || ctx.tools || null;
}
async function loadScopeModule(ctx) {
	// 通过宿主 loader 解析 dsh-scope：与宿主 dsh-tools 用同一份模块（Node ESM 按解析路径缓存），
	// createScope 造出的作用域才会被宿主的 ToolRuntime 认得。
	const root = appRoot(ctx);
	let pending = scopeModulePromises.get(root);
	if (!pending) {
		pending = ctx.loader.import("@deepseek-ai/dsh-scope");
		scopeModulePromises.set(root, pending);
		// 解析失败不缓存失败态，下次重试。
		pending.catch(() => scopeModulePromises.delete(root));
	}
	return pending;
}
// 配置指纹：直接对「实际下发给 mcp-client 的配置」取指纹，而不是对原始 spec 列字段：
//   —— 字段集不会漏（无需手工维护一份清单，日后 mcp-client 加字段自动跟上）；
//   —— 包含 `${VAR}` 求值后的结果，环境变量变了同样算“配置变了”。
// 同一 (wsPath, serverName) 的连接由首个 acquire 的配置建立；后续配置变更时，复用旧连接
// 的会话会得到日志警告 + 面板的 configStale 提示（不静默），但不在运行中替换连接
// —— 与 Claude Code / Codex 的项目级 MCP 一致：配置变更不影响已在运行的会话。
function stableStringify(value) {
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
	return JSON.stringify(value) ?? "null";
}
function configFingerprintOf(server, wsPath) {
	// 求值失败（如 command 求值为空）返回 undefined：这时“是否变更”无从判定，由建连路径
	// 抛出真正的错误（记入 mountErrors），而不是在这里伪造一个指纹。
	try { return stableStringify(toMcpClientConfig(server, wsPath)); } catch { return undefined; }
}
// 创建一份共享连接（每个 (wsPath, serverName) 全 app 只执行一次，由 acquire 串行化）。
// serverName 在 mcp-client apply 的 effect 里同步登记，因此这条路径不能并发执行。
// clientConfig 由调用方传入：保证指纹与真正下发的配置是同一次求值的结果，不会发散。
async function createSharedConnection(ctx, wsPath, server, clientConfig, configFingerprint) {
	const [scopeMod, mcpClient] = await Promise.all([loadScopeModule(ctx), ctx.loader.import(MCP_NAME)]);
	const scopeKey = { dshMcpProjectConn: true, wsPath, serverName: server.name };
	const scoped = scopeMod.createScope(ctx, scopeKey);
	// 挂在隔离作用域上：serverName 全 app 只登记这一次；工具注册进该作用域层（不进全局，不进任何会话）。
	const fiber = scoped.ctx.plugin({ apply: mcpClient.apply, inject: mcpClient.inject, name: mcpClient.name, Config: mcpClient.Config }, clientConfig);
	return { key: connKeyOf(wsPath, server.name), scopeKey, scoped, fiber, refs: 0, serverName: server.name, wsPath, configFingerprint };
}
// 同一 (wsPath, serverName) 的配置变了但仍在复用旧连接：不静默，写日志（面板另有 configStale）。
function warnStaleConfig(ctx, entry, configFingerprint) {
	if (entry.configFingerprint === configFingerprint) return;
	ctx.logger?.warn?.(`mcp-manager: 项目 MCP ${entry.serverName} 的配置已变化，但共享连接由先前会话建立，本会话复用现有连接；待该项目的所有会话结束后，新连接才采用新配置`);
}
// 获取（或新建）某 (wsPath, serverName) 的共享连接；refs 计数。只在首次挂载官方 mcp-client。
// 并发 acquire 共享同一份建连结果；释放中的条目等待 teardown 完成后才允许重建。
// 调用方必须把返回的引用交给 commitSharedConnection，否则就漏了一份。
async function acquireSharedConnection(ctx, wsPath, server) {
	const bucket = sharedConnBucket(ctx);
	const key = connKeyOf(wsPath, server.name);
	const clientConfig = toMcpClientConfig(server, wsPath);
	const configFingerprint = stableStringify(clientConfig);
	while (true) {
		const cell = bucket.get(key);
		if (!cell) {
			// 建连 promise 先入表：并发 setup 的后续 acquire 命中 pending，共享同一份结果。
			const pending = createSharedConnection(ctx, wsPath, server, clientConfig, configFingerprint);
			const created = { pending };
			bucket.set(key, created);
			try {
				const entry = await pending;
				created.entry = entry; // 就绪：后续 acquire 直接复用
				entry.refs += 1;
				return entry;
			} catch (error) {
				if (bucket.get(key) === created) bucket.delete(key);
				throw error;
			}
		}
		if (cell.entry) {
			warnStaleConfig(ctx, cell.entry, configFingerprint);
			cell.entry.refs += 1;
			return cell.entry;
		}
		if (cell.disposing) {
			// 释放中：等 teardown 完成（占位被删）后重新走循环新建，避免撞名。
			// disposing 本身就是「删除占位」那一步之后的 promise，所以等待者恢复时 cell 必已不在表中；
			// 多个等待者会收敛成「第一个新建、其余命中 pending」（新建者在首个 await 前已同步入表）。
			await cell.disposing;
			continue;
		}
		// 建连中：等待同一份结果，不再各自创建。恢复后必须确认这份 entry 没有在此期间被归零：
		// 创建者可能在提交点上失败（会话已销毁 / 插件已卸载）并把它释放掉。不校验就会把一份正在
		// teardown 的连接发给这个会话——它永远拿不到工具，面板也看不到任何错误。
		// （当前的微任务序恰好让这个窗口不发生，但那是隐式的、一次重构就会失效的保证。）
		const entry = await cell.pending;
		if (entry.released) continue;
		warnStaleConfig(ctx, entry, configFingerprint);
		entry.refs += 1;
		return entry;
	}
}
// 归还一份引用。返回 teardown promise（本次归零才有），让调用方能把它交回 cordis：
// cordis 会 await 异步 disposer，于是会话销毁/插件卸载不会早于 MCP 子进程关闭完成。
function releaseSharedConnection(ctx, entry) {
	entry.refs -= 1;
	if (entry.refs > 0) return undefined;
	// 归零即刻标记：仍停在 `await cell.pending` 上的并发 acquire 据此放弃这份 entry 并重建，
	// 不会把 refs 从 0 再加回到一份正在 teardown 的连接上。
	entry.released = true;
	const bucket = sharedConnBucket(ctx);
	const cell = bucket.get(entry.key);
	const onError = (error) => { ctx.logger?.error?.(`mcp-manager: 项目 MCP ${entry.serverName} 连接释放失败: ${error?.message ?? error}`); };
	// scoped.dispose() 已由 dsh-scope 的 `disposing ??=` 与 cordis 的 runner.epoch 双重幂等守护。
	const beginDispose = () => { try { return entry.scoped.dispose(); } catch (error) { onError(error); return undefined; } };
	if (!cell || cell.entry !== entry) {
		// 该 entry 已不在桶内（HMR/异常路径）：直接释放，不留占位。
		return Promise.resolve(beginDispose()).catch(onError);
	}
	// 转为「释放中」占位：teardown 完成前不删除，期间的 acquire 会等待后重建。
	cell.entry = undefined;
	cell.pending = undefined;
	cell.disposing = Promise.resolve(beginDispose()).catch(onError).finally(() => {
		if (bucket.get(entry.key) === cell) bucket.delete(entry.key);
	});
	return cell.disposing;
}
function agentSlotIndex(ctx, agent) {
	const slotsByAgent = bucketOf(agentProjectSlotsByRoot, ctx);
	let slots = slotsByAgent.get(agent);
	if (!slots) { slots = new Map(); slotsByAgent.set(agent, slots); }
	return slots;
}
// 把刚拿到的引用交给 cordis：所有权唯一落在会话作用域的一个 effect 上（见文件上方「引用所有权」）。
// 两种不能接管的情形各用自己的凭据判定，不再共用一张表：
//   * 本代装饰器已被 HMR 卸载 → generation.active（这是插件代次的属性，不是会话的属性）；
//   * 会话作用域已销毁       → agentCtx.effect() 的 assertActive()（cordis 的职责，不自建）。
// effect() 本身是原子的：抛出时它没有登记任何 disposable，我们仍持有唯一的一份引用，直接归还；
// 成功时归还已经不可能丢。因此不再需要「从检查到记账之间不得有 await」这类只能靠注释约束的临界区。
function commitSharedConnection(ctx, agentCtx, agent, entry, generation) {
	if (!generation.active) {
		void releaseSharedConnection(ctx, entry);
		ctx.logger?.warn?.(`mcp-manager: 插件已卸载，放弃接管项目 MCP ${entry.serverName} 的共享连接引用`);
		return null;
	}
	const slots = agentSlotIndex(ctx, agent);
	const existing = slots.get(entry.key);
	// 同一会话对同一 connKey 重复 acquire：多出的引用当场归还，不积压。
	if (existing) { void releaseSharedConnection(ctx, entry); return existing; }
	const slot = { key: entry.key, entry, ctx, agentCtx, agent, toolDisposers: new Map(), release: undefined, disposed: false };
	try {
		slot.release = agentCtx.effect(() => () => disposeProjectSlot(slot), `mcp-manager.projectConn(${entry.serverName})`);
	} catch (error) {
		void releaseSharedConnection(ctx, entry);
		ctx.logger?.warn?.(`mcp-manager: 会话在项目 MCP ${entry.serverName} 建连期间已结束，已归还共享连接引用: ${error?.message ?? error}`);
		return null;
	}
	slots.set(entry.key, slot);
	return slot;
}
// 撤回一个 slot：撤投射 → 从遍历索引摘除 → 归还引用。返回 teardown promise 供 cordis 等待。
// 幂等由自身 disposed 标志与 cordis effect wrapper 的 runner.epoch 双重保证。
function disposeProjectSlot(slot) {
	if (slot.disposed) return undefined;
	slot.disposed = true;
	for (const dispose of slot.toolDisposers.values()) { try { dispose(); } catch { /* noop */ } }
	slot.toolDisposers.clear();
	const slotsByAgent = agentProjectSlotsByRoot.get(appRoot(slot.ctx));
	const slots = slotsByAgent?.get(slot.agent);
	if (slots?.get(slot.key) === slot) {
		slots.delete(slot.key);
		if (!slots.size) slotsByAgent.delete(slot.agent);
	}
	return releaseSharedConnection(slot.ctx, slot.entry);
}
// 把某共享连接当前注册出的工具定义投射进该会话自己的 own 层；工具增减时幂等重算。
function syncSessionProjectTools(ctx, slot) {
	if (slot.disposed) return;
	const { entry, agentCtx } = slot;
	const tools = toolsServiceOf(ctx);
	const agentTools = agentCtx.tools;
	if (!tools || !agentTools || typeof agentTools.register !== "function") return;
	const prefix = `mcp__${entry.serverName}__`;
	const present = new Set();
	let failed = false;
	let schemas = [];
	try { schemas = tools.schemas(entry.scopeKey) || []; } catch { schemas = []; }
	for (const schema of schemas) {
		if (!schema.name.startsWith(prefix)) continue;
		present.add(schema.name);
		if (slot.toolDisposers.has(schema.name)) continue;
		const def = tools.get(schema.name, entry.scopeKey);
		if (!def) continue;
		try {
			slot.toolDisposers.set(schema.name, agentTools.register(def));
		} catch (error) {
			failed = true;
			recordWorkspaceMountError(entry.wsPath, entry.serverName, error);
			ctx.logger?.warn?.(`mcp-manager: 项目 MCP ${entry.serverName} 工具 ${schema.name} 注册失败: ${error?.message ?? error}`);
		}
	}
	// 只在本轮全部成功、且确实拿到了工具时才清除失败记录。放在循环里清会让前一个工具刚记下的
	// 失败被后一个工具的成功抹掉，于是面板看起来一切正常而会话实际缺工具。
	if (!failed && slot.toolDisposers.size) clearWorkspaceMountError(entry.wsPath, entry.serverName);
	// 撤掉已从共享连接消失的工具（服务器 tools/list_changed 或断连）。
	for (const [name, dispose] of slot.toolDisposers) {
		if (present.has(name)) continue;
		try { dispose(); } catch { /* noop */ }
		slot.toolDisposers.delete(name);
	}
}
// 撤回某 app root 下所有存活会话的项目工具投射并释放引用（插件 HMR/卸载时调用）。
// 不撤的话，运行中会话的工具定义仍指向已被销毁的共享连接（僵尸工具）。
// 走每个 slot 自己的 cordis disposer（官方幂等），于是会话之后正常销毁时不会重复释放。
function disposeAllProjectSlots(ctx) {
	const slotsByAgent = agentProjectSlotsByRoot.get(appRoot(ctx));
	if (!slotsByAgent) return undefined;
	const pending = [];
	for (const slots of [...slotsByAgent.values()]) {
		for (const slot of [...slots.values()]) {
			try {
				const settled = typeof slot.release === "function" ? slot.release() : disposeProjectSlot(slot);
				if (settled) pending.push(Promise.resolve(settled));
			} catch (error) {
				ctx.logger?.error?.(`mcp-manager: 撤回项目 MCP ${slot.entry.serverName} 的会话投射失败: ${error?.message ?? error}`);
			}
		}
	}
	return pending.length ? Promise.all(pending) : undefined;
}
// 项目 MCP 是一份长驻共享连接，Host 侧可以枚举它的真实连接态（与全局 MCP 一致）：
// 该 (wsPath, serverName) 的共享作用域里注册了多少个工具、当前有几个会话在用。
// 未建连/建连中/释放中（refs 均为 0，即尚无会话持有）时 mounted=false。
// 传入 server 而不是 serverName：还要拿当前配置与建连时的指纹对比，好让面板如实提示
// “配置已变化但仍在复用旧连接”，而不是只写进一条没人看的日志。
// phase 直接取 cordis fiber 的状态代号，交给 mcp-observability 的 deriveMcpPhase 判定——
// 项目行因此和全局行走同一套规则、同一个真相源，而不是再写一套日志启发式。
function workspaceConnectionStatus(ctx, wsPath, server) {
	const entry = sharedConnections.get(appRoot(ctx))?.get(connKeyOf(wsPath, server.name))?.entry;
	const duplicateOwners = duplicateServerNameOwners(ctx, wsPath, server.name);
	if (!entry) return { mounted: false, schemas: [], refs: 0, configStale: false, fiberState: undefined, duplicateOwners };
	const current = configFingerprintOf(server, wsPath);
	return {
		mounted: true,
		schemas: projectToolSchemasOf(ctx, entry),
		refs: entry.refs,
		configStale: current !== undefined && current !== entry.configFingerprint,
		fiberState: entry.fiber?.state,
		duplicateOwners,
	};
}
// 跨连接的只读诊断视图。面板每行只看得见自己那一格（某项目某 server 的 refs 与失败原因），
// 看不到进程级的事实：一共有几条共享连接、有没有 refs 卡住不归零的僵尸。模块级表按 app root
// 分桶（WeakMap 本身不可枚举），但桶内是普通 Map，所以按 root 枚举可行，且这条路径全程只读，
// 不 acquire、不 release、不碰 fiber。
// 三种 cell 状态都如实出现：卡在建连中/释放中恰恰是最需要排障的形态，过滤掉就等于看不见。
// refs 与 sessions 分开给而不合成一个「健康」布尔：健康时两者相等；refs > sessions 就是漏了
// 引用（会话已销毁但引用没归还 → 连接永不释放，配置也永远刷不新），判定留给读的人。
async function projectConnectionsView(ctx) {
	const bucket = sharedConnections.get(appRoot(ctx));
	if (!bucket) return [];
	const rows = [];
	for (const [key, cell] of [...bucket]) {
		const separator = key.indexOf("\u0000");
		const wsPath = key.slice(0, separator);
		const serverName = key.slice(separator + 1);
		const base = {
			wsPath,
			serverName,
			sessions: sessionSlotCount(ctx, key),
			duplicateOwners: duplicateServerNameOwners(ctx, wsPath, serverName),
		};
		const entry = cell.entry;
		if (!entry) {
			// 还没有 entry：要么在建连，要么在释放。两者都没有连接态可读，configStale 无从判定。
			rows.push({ ...base, state: cell.disposing ? "disposing" : "connecting", refs: 0, toolCount: 0, fiberState: undefined, configStale: null, configError: "" });
			continue;
		}
		// configStale 与 toolCount 走面板那条同一个判定（workspaceConnectionStatus），不另写一套
		// 指纹比较——两套判定迟早会对同一条连接给出两种说法。
		const current = await currentServerSpec(ctx, wsPath, serverName);
		const status = current.server ? workspaceConnectionStatus(ctx, wsPath, current.server) : null;
		rows.push({
			...base,
			state: entry.released ? "disposing" : "ready",
			refs: entry.refs,
			toolCount: (status ? status.schemas : projectToolSchemasOf(ctx, entry)).length,
			fiberState: entry.fiber?.state,
			// 配置里已经没有这个 server（刚被移除），或读配置失败 → 无从判定，给 null 并带上原因，
			// 不伪造一个 false 说「配置没变」。
			configStale: status ? status.configStale : null,
			configError: current.error,
		});
	}
	return rows;
}
// 某 connKey 当前被多少个存活会话持有（遍历索引即事实来源：每个 slot 就是一个会话的投射）。
function sessionSlotCount(ctx, key) {
	const slotsByAgent = agentProjectSlotsByRoot.get(appRoot(ctx));
	if (!slotsByAgent) return 0;
	let count = 0;
	for (const slots of slotsByAgent.values()) if (slots.has(key)) count += 1;
	return count;
}
// 该项目当前磁盘配置里的这个 server（诊断视图专用）。读失败原样带回给调用方，不吞。
async function currentServerSpec(ctx, wsPath, serverName) {
	try {
		const config = await readWorkspaceConfigCached(ctx, wsPath);
		return { server: config.servers.find((server) => server.name === serverName), error: config.error || "" };
	} catch (error) {
		return { server: undefined, error: error?.message ?? String(error) };
	}
}
// 同一 app 内还有哪些项目在用这个 serverName。保存路径会拦（见 index.js 的 workspaceNameTaken），
// 但手工编辑 `.dsh/mcp.json` 能绕过；那时第二份 mcp-client 必然撞名启动失败，而 serverName 又是
// 日志、工具名、注册表的共同键——与其只把 mcp-client 的原始报错抛给用户，不如把「和谁撞了」说清楚。
function duplicateServerNameOwners(ctx, wsPath, serverName) {
	const bucket = sharedConnections.get(appRoot(ctx));
	if (!bucket) return [];
	const owners = [];
	for (const cell of bucket.values()) {
		const entry = cell.entry;
		if (entry && entry.serverName === serverName && entry.wsPath !== wsPath) owners.push(entry.wsPath);
	}
	return owners;
}
// 某共享连接当前真实注册出的工具。它们在共享作用域层里，全局视图（tools.schemas() 不传
// scope，见 dsh-tools 的 view(undefined)）看不到，所以必须按 scopeKey 读——这也是面板能
// 枚举项目 MCP 工具的唯一通路（mcp-registry.toolInventory 只认 loader 条目 + 全局视图）。
function projectToolSchemasOf(ctx, entry) {
	const tools = toolsServiceOf(ctx);
	const prefix = `mcp__${entry.serverName}__`;
	try { return (tools?.schemas(entry.scopeKey) || []).filter((schema) => schema.name.startsWith(prefix)); } catch { return []; }
}
// 枚举某项目 MCP 当前的工具（面板详情用）。优先按 (wsPath, serverName) 精确定位：serverName
// 的全 app 唯一性只在保存路径被校验，手工编辑 `.dsh/mcp.json` 能造出两个项目同名，按名字扫描
// 就会把另一个项目的工具显示到这里。wsPath 缺省时退回按名字取首个匹配（全局条目的调用方没有 wsPath）。
function workspaceToolSchemas(ctx, serverName, wsPath) {
	const bucket = sharedConnections.get(appRoot(ctx));
	if (!bucket) return [];
	if (wsPath) {
		const entry = bucket.get(connKeyOf(wsPath, serverName))?.entry;
		return entry ? projectToolSchemasOf(ctx, entry) : [];
	}
	for (const cell of bucket.values()) {
		if (cell.entry?.serverName === serverName) return projectToolSchemasOf(ctx, cell.entry);
	}
	return [];
}

function workspaceCacheGet(ctx, wsPath) { return workspaceConfigCache.get(appRoot(ctx))?.get(wsPath); }
function workspaceCacheSet(ctx, wsPath, entry) {
	const bucket = bucketOf(workspaceConfigCache, ctx);
	if (bucket.size >= WORKSPACE_CACHE_LIMIT && !bucket.has(wsPath)) bucket.delete(bucket.keys().next().value);
	bucket.set(wsPath, entry);
}
function workspaceCacheDelete(ctx, wsPath) {
	workspaceConfigCache.get(appRoot(ctx))?.delete(wsPath);
}
function withWorkspaceWrite(wsPath, operation) {
	const state = workspaceWriteEntry(wsPath);
	const run = async () => operation();
	const current = state.queue.then(run, run);
	state.queue = current.catch(() => {});
	return current;
}
function recordWorkspaceMountError(wsPath, serverName, error) {
	let byServer = workspaceMountErrors.get(wsPath);
	if (!byServer) { byServer = new Map(); workspaceMountErrors.set(wsPath, byServer); }
	byServer.set(serverName, error?.message ?? String(error));
}
function clearWorkspaceMountError(wsPath, serverName) {
	const byServer = workspaceMountErrors.get(wsPath);
	if (!byServer) return;
	byServer.delete(serverName);
	if (!byServer.size) workspaceMountErrors.delete(wsPath);
}
function workspaceMountErrorsView(wsPath) {
	const byServer = workspaceMountErrors.get(wsPath);
	if (!byServer) return [];
	return [...byServer.entries()].map(([serverName, error]) => ({ serverName, error }));
}
// restrict 失败此前只写进一个读不到的 logger，等于静默失败：用户点了屏蔽却毫无反馈，
// 也无从判断是没生效还是宿主拒绝。与挂载失败同样记为可观测状态。
function recordWorkspaceRestrictError(wsPath, deny, error) {
	workspaceRestrictErrors.set(wsPath, { deny, error: error?.message ?? String(error), ts: Date.now() });
}
function clearWorkspaceRestrictError(wsPath) {
	workspaceRestrictErrors.delete(wsPath);
}
function workspaceRestrictErrorView(wsPath) {
	return workspaceRestrictErrors.get(wsPath) ?? null;
}
// 该项目当前有多少个会话持有项目作用域。共享连接下它不再是“撞名”的诊断线索（已不可能
// 撞名），而是告知面板「这份连接当前被几个会话共用、何时会释放」——也就是配置何时才能生效。
// 按 wsPath 统计而不区分 app root：与 mountErrors 一致，诊断对象是项目目录本身。
function liveWorkspaceAgentCount(wsPath) {
	let count = 0;
	for (const state of agentWorkspaceStates.values()) if (state.wsPath === wsPath) count += 1;
	return count;
}

function canonicalWorkspacePath(path) {
	try { return realpathSync(path); } catch { return path; }
}
function workspaceRegistryOf(ctx) {
	const get = typeof ctx.get === "function" ? ctx.get.bind(ctx) : null;
	const registry = get && get("workspaceRegistry");
	return registry && typeof registry.list === "function" ? registry : null;
}
async function listWorkspaceRecords(ctx) {
	const registry = workspaceRegistryOf(ctx);
	if (!registry) return [];
	try { return registry.list() || []; } catch { return []; }
}
async function readWorkspaceConfigCached(ctx, wsPath) {
	const filePath = join(wsPath, ...WORKSPACE_CONFIG_REL);
	let info;
	try {
		info = await stat(filePath);
	} catch (error) {
		if (error?.code === "ENOENT") {
			workspaceCacheDelete(ctx, wsPath);
			return { servers: [], exclude: [], error: "", missing: true };
		}
		throw error;
	}
	const stamp = workspaceWriteStamp(wsPath);
	const cached = workspaceCacheGet(ctx, wsPath);
	if (cached && cached.stamp === stamp && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached.config;
	const config = await readWorkspaceConfig(wsPath, (path) => readFile(path, "utf8"));
	// 读盘期间又发生了写入：本次结果可能已陈旧，当次返回但不入缓存，下次重读。
	if (workspaceWriteStamp(wsPath) === stamp) workspaceCacheSet(ctx, wsPath, { stamp, mtimeMs: info.mtimeMs, size: info.size, config });
	return config;
}
async function writeWorkspaceConfigFile(wsPath, servers, exclude) {
	await writeWorkspaceConfig(
		wsPath,
		{ servers, exclude },
		(path, text) => writeFileAtomic(path, text, { mode: 0o600 }),
		(path, options) => mkdir(path, options),
	);
	// 写后自增写入代号：所有 app 的缓存条目下次读取时会因代号不符而失效，无需枚举缓存桶。
	workspaceWriteEntry(wsPath).stamp += 1;
}

// ---- agent setup 时挂载到 agent scope ----
function applyWorkspaceRestrict(ctx, agentCtx, agent, exclude) {
	const state = agentWorkspaceStates.get(agent);
	if (!state) return;
	// 归属判定与 toolInventory 一致：仅当某工具的唯一 owner 是被排除的 serverName 才拒绝，
	// 避免 serverName 含 `__` 时裸前缀匹配误伤其他服务器的同名工具。
	const globalNames = allMcpEntries(ctx).map((entry) => entry.options.config.serverName);
	const excluded = new Set(exclude);
	const deny = [];
	for (const schema of ctx.tools.schemas()) {
		const owners = globalNames.filter((name) => schema.name.startsWith(`mcp__${name}__`));
		if (owners.length === 1 && excluded.has(owners[0])) deny.push(schema.name);
	}
	deny.sort();
	// key 基于展开后的 deny 工具名：全局工具集变化或 exclude 变化都会触发重算。
	const key = JSON.stringify(deny);
	if (state.restrictKey === key) return;
	if (state.restrictDisposer) { try { state.restrictDisposer(); } catch { /* noop */ } state.restrictDisposer = undefined; }
	if (!deny.length) { state.restrictKey = key; clearWorkspaceRestrictError(state.wsPath); return; }
	try {
		state.restrictDisposer = agentCtx.tools.restrict({ deny });
		// 仅在 restrict 真正生效后记账：先记账会让抛错的这次被误认为已应用，
		// 之后同一 deny 因 key 命中被跳过，限制永远补不上。
		state.restrictKey = key;
		clearWorkspaceRestrictError(state.wsPath);
	} catch (error) {
		state.restrictKey = undefined;
		recordWorkspaceRestrictError(state.wsPath, deny, error);
		ctx.logger?.warn?.(`mcp-manager: restrict(${deny.join(", ")}) 失败: ${error?.message ?? error}`);
	}
}
// 重算 exclude 并写入会话作用域。会话的工具清单在首轮请求时定型，因此这里服务于
// 启动窗口：setup 时 MCP 可能仍在异步注册，等 tools/change 到达再补算当时还看不到的工具名。
// wsPath 省略时重算全部（tools/change 场景：全局工具集变了，所有会话的 deny 都要重新展开）。
async function reconcileWorkspaceRestricts(ctx, wsPath) {
	const root = appRoot(ctx);
	for (const [agent, state] of agentWorkspaceStates) {
		// 多 app 同进程：别拿其他 app 的全局工具集去展开本 app 会话的 deny。
		if (state.root !== root) continue;
		if (!agent?.ctx) continue;
		if (wsPath && state.wsPath !== wsPath) continue;
		try {
			const config = await readWorkspaceConfigCached(ctx, state.wsPath);
			applyWorkspaceRestrict(ctx, agent.ctx, agent, config.exclude);
		} catch { /* 下一次变化再重试 */ }
	}
}
// 工具集变化时重算所有存活会话的项目工具投射（共享连接异步就绪/重连/工具增减）。这是生产
// 上的主路径：真实 mcp-client 的 apply 在 cordis 的微任务里才跑、工具要等 connect + tools/list
// 才注册，所以 setup 当场投射到的往往是空集，全靠这里补。
// register() 自身会同步再发 tools/change（dsh-scope 的 ScopedLayers.effect 里 onChange 是同步
// emit），用重入守卫避免无限递归；标志按 app root 隔离。
const syncingProjectToolsByRoot = new WeakMap(); // appRoot -> boolean
function reconcileSessionProjectTools(ctx) {
	const root = appRoot(ctx);
	if (syncingProjectToolsByRoot.get(root)) return;
	syncingProjectToolsByRoot.set(root, true);
	try {
		const slotsByAgent = agentProjectSlotsByRoot.get(root);
		if (!slotsByAgent) return;
		for (const slots of [...slotsByAgent.values()]) {
			for (const slot of [...slots.values()]) {
				try { syncSessionProjectTools(ctx, slot); } catch { /* 下一次变化再试 */ }
			}
		}
	} finally {
		syncingProjectToolsByRoot.delete(root);
	}
}
// generation 是「本代装饰器还在管事吗」这一事实的唯一载体：installAgentRuntime 建立，
// cleanup（HMR/卸载）置为 false。它与「会话是否还活着」彻底分开——后者归 cordis。
function composeAgentSetup(ctx, callerSetup, generation) {
	return async (agentCtx) => {
		const agent = agentCtx.agent;
		const cwd = agent?.session?.header?.cwd;
		if (typeof cwd === "string" && cwd.length > 0) {
			const wsPath = canonicalWorkspacePath(cwd);
			try {
				const config = await readWorkspaceConfigCached(ctx, wsPath);
				if (!config.error && !config.missing) {
					// 会话记录只承载「本会话属于哪个项目 + restrict 展开到哪一步」。它不再是任何
					// 存活性凭据：共享连接的引用由 commitSharedConnection 交给 cordis 的 effect 持有。
					// 不允许缺少 effect()：没有生命周期归属就宁可不挂项目 MCP。
					if (typeof agentCtx.effect !== "function") throw new Error("会话作用域没有 effect()，无法为项目 MCP 建立生命周期归属");
					agentCtx.effect(() => () => { agentWorkspaceStates.delete(agent); }, "mcp-manager.workspaceScope");
					agentWorkspaceStates.set(agent, { root: appRoot(ctx), wsPath, restrictKey: undefined, restrictDisposer: undefined });
					for (const server of config.servers) {
						if (server.disabled) continue;
						try {
							// 共享连接：每 (wsPath, serverName) 全 app 只挂一份官方 mcp-client，所以 serverName
							// 只登记一次——同项目再开多少个会话都不会再撞名。
							const entry = await acquireSharedConnection(ctx, wsPath, server);
							// 提交：把引用交给 cordis。会话在建连期间被销毁（dsh-agent-loop 的 raceAbort 抛弃
							// 但不取消 setup）、或本插件已 HMR 卸载时返回 null，引用已在里面归还。
							const slot = commitSharedConnection(ctx, agentCtx, agent, entry, generation);
							if (!slot) break;
							if (server.failOnStartupError) {
								// 与 mcp-client 全局语义一致：显式要求“启动失败阻止”的服务器等待就绪。
								try {
									await entry.fiber;
									clearWorkspaceMountError(wsPath, server.name);
								} catch (error) {
									recordWorkspaceMountError(wsPath, server.name, error);
									ctx.logger?.warn?.(`mcp-manager: 项目 MCP ${server.name} 启动失败: ${error?.message ?? error}`);
								}
							} else {
								// 默认异步：连接就绪后 mcp-client 注册工具会触发 tools/change，届时再补投射。
								// 失败态由 fiber.state 直接呈现给面板，这里只补一条日志与错误文案。
								void Promise.resolve(entry.fiber).then(
									() => clearWorkspaceMountError(wsPath, server.name),
									(error) => {
										recordWorkspaceMountError(wsPath, server.name, error);
										ctx.logger?.warn?.(`mcp-manager: 项目 MCP ${server.name} 加载失败: ${error?.message ?? error}`);
									},
								);
							}
							// 把当前已注册的工具投射进本会话 own 层（通常为空，等 tools/change 补）。
							syncSessionProjectTools(ctx, slot);
						} catch (error) {
							recordWorkspaceMountError(wsPath, server.name, error);
							ctx.logger?.warn?.(`mcp-manager: 项目 MCP ${server.name} 挂载失败: ${error?.message ?? error}`);
						}
					}
					applyWorkspaceRestrict(ctx, agentCtx, agent, config.exclude);
				}
			} catch (error) {
				ctx.logger?.warn?.(`mcp-manager: 项目 MCP 作用域初始化失败 ${cwd}: ${error?.message ?? error}`);
			}
		}
		return (await callerSetup?.(agentCtx)) ?? undefined;
	};
}
// 为什么替换宿主的 agents.create/resume，而不用官方的 `agent/created` 事件（已核对源码，别再重新调研）：
//   * `agent/created` 的派发是 fire-and-forget —— dsh-agent 的 announce() 只把监听器返回的
//     promise 做 `Promise.resolve(returned).catch(...)` 打成 warn，从不 await
//     （dsh-agent/lib/index.js 的 announce()，约 670-676 行）。同文件 enter() 的文档串也写明，
//     只有**同步**监听器才有顺序保证（"When called from a synchronous `agent/created` listener,
//     removal and disposal wait until that creation dispatch unwinds"，约 598 行）。
//   * 我们的挂载天生异步（await 共享连接建连 → 投射工具），做不成同步监听器。
//   * 会话的工具清单在**每轮请求组装时**才读（dsh-agent-loop/lib/index.js 的 `assembly.tools`，
//     约 613 行），而 create() 一 publish 就返回 agent（约 1196-1201 行），调用方可以立刻发第一轮。
//     于是「监听器跑完」与「首轮读工具清单」是无保证的竞态，输了就是会话静默少掉项目工具。
// 替换方法则是在 setup 里 await 挂载完成后才把 agent 交还调用方：会话不可能在项目工具就位前
// 开跑。这份确定性值得付「依赖 cordis 的 proxy 赋值语义」这个代价，所以本函数保留。
function installAgentRuntime(ctx) {
	const agentsService = (typeof ctx.get === "function" ? ctx.get("agents") : null) || ctx.agents;
	if (!agentsService || typeof agentsService.create !== "function" || typeof agentsService.resume !== "function") return () => {};
	// 按 agents 服务单例判重：同一服务只包装一次，HMR 重建后才允许重新包装。
	// ctx.get() 返回的是 traceable proxy，每次调用都是新对象，不能直接作为判重键。
	const identity = agentsService[CORDIS_ORIGINAL] ?? agentsService;
	if (wrappedAgentsServices.has(identity)) return () => {};
	// 二次防线：即便身份判重失效（宿主 proxy 语义变化），已装饰的方法也不再被包装。
	// 装饰器每层都会重新 compose setup，叠加会让 agents.create 的调用深度随运行时长增长直至爆栈。
	if (AGENT_METHODS.every((method) => agentsService[method]?.[AGENT_WRAPPED])) return () => {};
	// 本代装饰器的令牌：飞行中的 setup 靠它判断「我还该不该接管资源」。
	const generation = { active: true };
	const restore = [];
	let disposeToolsChange;
	const cleanup = () => {
		if (!generation.active) return undefined;
		generation.active = false;
		wrappedAgentsServices.delete(identity);
		restore.forEach((fn) => { try { fn(); } catch { /* noop */ } });
		try { disposeToolsChange?.(); } catch { /* noop */ }
		// HMR/卸载：本 app 的会话不再由本模块管理，必须全部撕干净，否则运行中会话会留下指向已
		// 销毁连接的僵尸工具、以及再也无人重算的 restrict（旧模块的 agent 级清理只在会话销毁时
		// 才跑，而那时旧模块已经不在了）。teardown promise 交回 cordis 等待。
		const root = appRoot(ctx);
		for (const [agent, state] of agentWorkspaceStates) {
			if (state.root !== root) continue;
			if (state.restrictDisposer) { try { state.restrictDisposer(); } catch { /* noop */ } }
			agentWorkspaceStates.delete(agent);
		}
		return disposeAllProjectSlots(ctx);
	};
	// 生命周期归属先建立、再动宿主状态：反过来的话，effect() 抛出（fiber 已 inactive）就会留下一个
	// 被死插件永久改写的 agents 服务，而且再也没有重新安装的机会（判重表已被占）。
	// 不允许缺少 effect()：与 composeAgentSetup 同一条原则，没有归属就不装。
	if (typeof ctx.effect !== "function") throw new Error("mcp-manager: 宿主 context 没有 effect()，无法为 agent 装饰器建立生命周期归属");
	const owner = ctx.effect(() => () => cleanup(), "mcp-manager.agentRuntime");
	try {
		for (const method of AGENT_METHODS) {
			const original = agentsService[method];
			if (typeof original !== "function" || original[AGENT_WRAPPED]) continue;
			const wrapper = function (...args) {
				const options = args[0];
				if (!options || typeof options !== "object") throw new TypeError(`mcp-manager: agents.${method}() requires options`);
				return original.call(this, { ...options, setup: composeAgentSetup(ctx, options.setup, generation) });
			};
			wrapper[AGENT_WRAPPED] = true;
			agentsService[method] = wrapper;
			restore.push(() => { agentsService[method] = original; });
		}
		disposeToolsChange = ctx.on?.("tools/change", () => {
			reconcileSessionProjectTools(ctx);
			return reconcileWorkspaceRestricts(ctx);
		});
		wrappedAgentsServices.add(identity);
	} catch (error) {
		// 装配中途失败：把已经动过的宿主状态全部还原，再让错误浮出去（不静默半装配状态）。
		restore.forEach((fn) => { try { fn(); } catch { /* noop */ } });
		generation.active = false;
		owner();
		throw error;
	}
	return cleanup;
}
// agents 服务可能晚于本插件就绪。交给 ctx.inject：依赖可用时安装、依赖消失时由 fiber 回滚。
// 取代过去「每个 RPC 都重试一次安装」的做法——那条路径会被面板轮询持续触发，把一次性
// 装配变成了按请求装配。
// 安装失败不再被吞：agents 未就绪由 installAgentRuntime 的前置检查静默跳过（返回 no-op），
// 剩下的失败都是契约违背（宿主没有 effect()、装配中途出错），必须让 cordis 看见。
function installAgentRuntimeWhenReady(ctx) {
	if (typeof ctx?.inject !== "function") return installAgentRuntime(ctx);
	ctx.inject(["agents"], (scoped) => { installAgentRuntime(scoped); });
	return () => {};
}

export {
	applyWorkspaceRestrict,
	canonicalWorkspacePath,
	composeAgentSetup,
	installAgentRuntime,
	installAgentRuntimeWhenReady,
	listWorkspaceRecords,
	liveWorkspaceAgentCount,
	projectConnectionsView,
	readWorkspaceConfigCached,
	reconcileWorkspaceRestricts,
	withWorkspaceWrite,
	workspaceConnectionStatus,
	workspaceMountErrorsView,
	workspaceRestrictErrorView,
	workspaceToolSchemas,
	writeWorkspaceConfigFile,
};
