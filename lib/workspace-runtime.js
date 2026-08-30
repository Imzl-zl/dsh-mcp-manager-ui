import { mkdir, readFile, stat } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
import { allMcpEntries, MCP_NAME } from "./mcp-registry.js";
import { readWorkspaceConfig, toMcpClientConfig, writeWorkspaceConfig, WORKSPACE_CONFIG_REL } from "./workspace-config.js";

// ---------- workspace 项目层运行时 ----------
// 项目配置的读写状态，以及 agent setup 时把项目 MCP 挂到 agent scope 的装饰器。
// 只依赖 mcp-registry 与 workspace-config，不认识 profile patch，因此可被 index.js 单向依赖。

// 配置缓存按 ctx.root 命名空间隔离（多 app 同进程时互不串读），每 app 内按插入序有上限。
const workspaceConfigCache = new Map(); // ctx.root -> Map<canonicalWsPath, { mtimeMs, size, config }>
const WORKSPACE_CACHE_LIMIT = 64;
// 串行化同一工作区的 read→modify→write：与全局 withPatchWrite 对称，防止并发写丢更新。
const workspaceWriteQueues = new Map(); // canonicalWsPath -> Promise
const agentWorkspaceStates = new Map(); // agent -> { wsPath, restrictKey, restrictDisposer }；随 agent scope 清理
const wrappedAgentsServices = new WeakSet(); // 已包装 agents.create/resume 的服务单例
const AGENT_METHODS = ["create", "resume"];
// cordis 的 traceable proxy 用该 symbol 暴露原始服务对象；proxy 每次 ctx.get() 都新建，
// 只有解包后的实例才有稳定身份可作判重键。
const CORDIS_ORIGINAL = Symbol.for("cordis.original");
// 打在装饰函数上的标记，使“是否已包装”不依赖任何对象身份。
const AGENT_WRAPPED = Symbol.for("dsh-mcp-manager-ui.agentRuntimeWrapped");
// 项目 MCP 挂载失败（serverName 冲突/启动/连接失败）的可观测记录：Host 无法直接看到 agent 层
// 注册，因此把 setup 阶段的失败显式呈现给用户，避免“静默缺失”。
const workspaceMountErrors = new Map(); // wsPath -> Map<serverName, errorMessage>
const workspaceRestrictErrors = new Map(); // wsPath -> { deny, error, ts }

// ---------- 项目 MCP 共享连接（每 (wsPath, serverName) 一份实例）----------
// 官方 mcp-client 的 serverName 在 ctx.root（=整个进程）唯一，且工具注册绑作用域。
// 旧做法「每会话各挂一份」会让同项目第二个会话撞名。改为：每 (wsPath, serverName) 只挂
// 一份 mcp-client 到我们自建的隔离作用域上（serverName 只登记一次），再把它注册出的工具
// 定义原样投射进每个会话自己的 own 层——多个会话共享同一份连接、各自可见、互不干扰。
//
// 同一 connKey 的生命周期必须串行化，否则两条异步窗口都会重新撞名：
//   1. 建连：check→await→set 之间并发 setup 会各建一份连接（serverName 在 apply 的 effect
//      里同步登记，第二个实例必抛 already in use）。解法：建连 promise 先入表，并发者共享结果。
//   2. 释放：teardown 是异步的（quiesceFiber），serverName 直到 teardown 完成才归还；若立即
//      删表并新建，新连接会撞上未归还的旧名。解法：释放后保留「disposing」占位，acquire 等待。
// MCP 协议本身是无状态 + 每请求独立 + 鼓励客户端在一个 stdio 进程上交织多会话请求，因此
// 共享单连接对合规服务端无语义损失；这里是纯插件层的命名/生命周期串行化问题。
const sharedConnections = new Map(); // ctx.root -> Map<connKey, ConnCell>
// ConnCell 状态机（互斥）：
//   { entry }        —— 就绪：refs 计数在 entry 上，acquire 直接复用
//   { pending }      —— 建连中：所有并发 acquire 等待同一 promise，只建一条连接
//   { disposing }    —— 释放中：teardown 完成（serverName 归还）前保留占位，acquire 等待后新建
// ConnEntry: { key, scopeKey, scoped, fiber, refs, serverName, wsPath, configFingerprint }
const agentProjectSlotsByRoot = new Map(); // ctx.root -> Map<agent, Map<connKey, { entry, toolDisposers: Map<name, dispose> }>>
const scopeModulePromises = new Map(); // ctx.root -> Promise<dsh-scope 模块>（按 app 隔离，避免跨 app/HMR 串用）

function connKeyOf(wsPath, serverName) { return `${wsPath}\u0000${serverName}`; }
function sharedConnRoot(ctx) { return (ctx && typeof ctx === "object" && ctx.root) || ctx || null; }
function sharedConnBucket(ctx) {
	const root = sharedConnRoot(ctx);
	let bucket = sharedConnections.get(root);
	if (!bucket) { bucket = new Map(); sharedConnections.set(root, bucket); }
	return bucket;
}
function toolsServiceOf(ctx) {
	const get = typeof ctx.get === "function" ? ctx.get.bind(ctx) : null;
	return (get && get("tools")) || ctx.tools || null;
}
async function loadScopeModule(ctx) {
	// 通过宿主 loader 解析 dsh-scope：与宿主 dsh-tools 用同一份模块（Node ESM 按解析路径缓存），
	// createScope 造出的作用域才会被宿主的 ToolRuntime 认得。
	const root = sharedConnRoot(ctx);
	let pending = scopeModulePromises.get(root);
	if (!pending) {
		pending = ctx.loader.import("@deepseek-ai/dsh-scope");
		scopeModulePromises.set(root, pending);
		// 解析失败不缓存失败态，下次重试。
		pending.catch(() => scopeModulePromises.delete(root));
	}
	return pending;
}
// 配置指纹：同一 (wsPath, serverName) 的连接由首个 acquire 的配置建立；后续配置变更
// 时复用旧连接的会话如实提示，不静默（见 acquire 的警告），也不在运行中替换连接。
function configFingerprintOf(server) {
	return [server.transport, server.command, server.url, server.args && JSON.stringify(server.args), server.env && JSON.stringify(server.env), server.cwd, server.headers && JSON.stringify(server.headers), server.toolCallTimeoutMs, server.failOnStartupError, server.reconnect && JSON.stringify(server.reconnect)].join("\u0001");
}
// 创建一份共享连接（每个 (wsPath, serverName) 全进程只执行一次，由 acquire 串行化）。
// serverName 在 mcp-client apply 的 effect 里同步登记，因此这条路径不能并发执行。
async function createSharedConnection(ctx, wsPath, server, configFingerprint) {
	const [scopeMod, mcpClient] = await Promise.all([loadScopeModule(ctx), ctx.loader.import(MCP_NAME)]);
	const scopeKey = { dshMcpProjectConn: true, wsPath, serverName: server.name };
	const scoped = scopeMod.createScope(ctx, scopeKey);
	const clientConfig = toMcpClientConfig(server, wsPath);
	// 挂在隔离作用域上：serverName 全进程只登记这一次；工具注册进该作用域层（不进全局，不进任何会话）。
	const fiber = scoped.ctx.plugin({ apply: mcpClient.apply, inject: mcpClient.inject, name: mcpClient.name, Config: mcpClient.Config }, clientConfig);
	return { key: connKeyOf(wsPath, server.name), scopeKey, scoped, fiber, refs: 0, serverName: server.name, wsPath, configFingerprint };
}
// 获取（或新建）某 (wsPath, serverName) 的共享连接；refs 计数。只在首次挂载官方 mcp-client。
// 并发 acquire 共享同一份建连结果；释放中的条目等待 teardown 完成后才允许重建。
async function acquireSharedConnection(ctx, wsPath, server) {
	const bucket = sharedConnBucket(ctx);
	const key = connKeyOf(wsPath, server.name);
	const configFingerprint = configFingerprintOf(server);
	while (true) {
		const cell = bucket.get(key);
		if (!cell) {
			// 建连 promise 先入表：并发 setup 的后续 acquire 命中 pending，共享同一份结果。
			const pending = createSharedConnection(ctx, wsPath, server, configFingerprint);
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
			if (cell.entry.configFingerprint !== configFingerprint) {
				ctx.logger?.warn?.(`mcp-manager: 项目 MCP ${cell.entry.serverName} 的配置已变化，但共享连接由先前会话建立，本会话复用现有连接；待该项目的所有会话结束后，新连接才采用新配置`);
			}
			cell.entry.refs += 1;
			return cell.entry;
		}
		if (cell.disposing) {
			// 释放中（serverName 尚未归还）：等 teardown 完成后重新走循环新建，避免撞名。
			await cell.disposing;
			continue;
		}
		// 建连中：等待同一份结果，不再各自创建。
		const entry = await cell.pending;
		entry.refs += 1;
		return entry;
	}
}
function releaseSharedConnection(ctx, entry) {
	entry.refs -= 1;
	if (entry.refs > 0) return;
	const bucket = sharedConnBucket(ctx);
	const cell = bucket.get(entry.key);
	const beginDispose = () => { try { return entry.scoped.dispose(); } catch { return undefined; } };
	if (cell && cell.entry === entry) {
		// 转为「释放中」占位：teardown 完成（serverName 归还）前不删除，期间的 acquire 会等待。
		cell.entry = undefined;
		cell.pending = undefined;
		const disposing = Promise.resolve(beginDispose()).catch((error) => {
			ctx.logger?.error?.(`mcp-manager: 项目 MCP ${entry.serverName} 连接释放失败: ${error?.message ?? error}`);
		}).finally(() => {
			if (sharedConnBucket(ctx).get(entry.key) === cell) sharedConnBucket(ctx).delete(entry.key);
		});
		cell.disposing = disposing;
	} else {
		// 该 entry 已不在桶内（异常路径），直接释放，不留占位。
		Promise.resolve(beginDispose()).catch((error) => {
			ctx.logger?.error?.(`mcp-manager: 项目 MCP ${entry.serverName} 连接释放失败: ${error?.message ?? error}`);
		});
	}
}
// 把某共享连接当前注册出的工具定义投射进该会话自己的 own 层；工具增减时幂等重算。
function syncSessionProjectTools(ctx, agentCtx, agent, entry) {
	const tools = toolsServiceOf(ctx);
	const agentTools = agentCtx.tools;
	if (!tools || !agentTools || typeof agentTools.register !== "function") return;
	const root = sharedConnRoot(ctx);
	let slotsByAgent = agentProjectSlotsByRoot.get(root);
	if (!slotsByAgent) { slotsByAgent = new Map(); agentProjectSlotsByRoot.set(root, slotsByAgent); }
	let slots = slotsByAgent.get(agent);
	if (!slots) { slots = new Map(); slotsByAgent.set(agent, slots); }
	let slot = slots.get(entry.key);
	if (!slot) { slot = { entry, toolDisposers: new Map() }; slots.set(entry.key, slot); }
	const prefix = `mcp__${entry.serverName}__`;
	const present = new Set();
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
			clearWorkspaceMountError(entry.wsPath, entry.serverName);
		} catch (error) {
			recordWorkspaceMountError(entry.wsPath, entry.serverName, error);
			ctx.logger?.warn?.(`mcp-manager: 项目 MCP ${entry.serverName} 工具 ${schema.name} 注册失败: ${error?.message ?? error}`);
		}
	}
	// 撤掉已从共享连接消失的工具（服务器 tools/list_changed 或断连）。
	for (const [name, dispose] of slot.toolDisposers) {
		if (present.has(name)) continue;
		try { dispose(); } catch { /* noop */ }
		slot.toolDisposers.delete(name);
	}
}
// 释放某会话对所有共享连接的投射与引用（会话作用域销毁时调用）。
function disposeAgentProjectSlots(ctx, agent) {
	const root = sharedConnRoot(ctx);
	const slotsByAgent = agentProjectSlotsByRoot.get(root);
	const slots = slotsByAgent?.get(agent);
	if (!slots) return;
	for (const slot of slots.values()) {
		for (const dispose of slot.toolDisposers.values()) { try { dispose(); } catch { /* noop */ } }
		slot.toolDisposers.clear();
		releaseSharedConnection(ctx, slot.entry);
	}
	slotsByAgent.delete(agent);
	if (!slotsByAgent.size) agentProjectSlotsByRoot.delete(root);
}
// 撤回某 app root 下所有存活会话的项目工具投射并释放引用（插件 HMR/卸载时调用）。
// 不撤的话，运行中会话的工具定义仍指向已被销毁的共享连接（僵尸工具）。
function disposeAllAgentProjectSlots(ctx) {
	const root = sharedConnRoot(ctx);
	const slotsByAgent = agentProjectSlotsByRoot.get(root);
	if (!slotsByAgent) return;
	for (const agent of [...slotsByAgent.keys()]) disposeAgentProjectSlots(ctx, agent);
	agentProjectSlotsByRoot.delete(root);
}
// 项目 MCP 现在是一份长驻共享连接，Host 侧可以枚举它的真实连接态（与全局 MCP 一致）：
// 该 (wsPath, serverName) 的共享作用域里注册了多少个工具、当前有几个会话在用。
// 未建连/建连中/释放中（该项目尚无可用会话）时 mounted=false，面板显示“待会话挂载”。
function workspaceConnectionStatus(ctx, wsPath, serverName) {
	const bucket = sharedConnections.get(sharedConnRoot(ctx));
	const entry = bucket?.get(connKeyOf(wsPath, serverName))?.entry;
	if (!entry) return { mounted: false, toolCount: 0, refs: 0 };
	const tools = toolsServiceOf(ctx);
	const prefix = `mcp__${serverName}__`;
	let toolCount = 0;
	try { toolCount = (tools?.schemas(entry.scopeKey) || []).filter((s) => s.name.startsWith(prefix)).length; } catch { toolCount = 0; }
	return { mounted: true, toolCount, refs: entry.refs };
}

function workspaceCacheRoot(ctx) { return (ctx && typeof ctx === "object" && ctx.root) || ctx || null; }
function workspaceCacheGet(ctx, wsPath) { return workspaceConfigCache.get(workspaceCacheRoot(ctx))?.get(wsPath); }
function workspaceCacheSet(ctx, wsPath, entry) {
	const root = workspaceCacheRoot(ctx);
	let bucket = workspaceConfigCache.get(root);
	if (!bucket) { bucket = new Map(); workspaceConfigCache.set(root, bucket); }
	if (bucket.size >= WORKSPACE_CACHE_LIMIT && !bucket.has(wsPath)) bucket.delete(bucket.keys().next().value);
	bucket.set(wsPath, entry);
}
function workspaceCacheDelete(ctx, wsPath) {
	const bucket = workspaceConfigCache.get(workspaceCacheRoot(ctx));
	if (bucket) bucket.delete(wsPath);
}
function withWorkspaceWrite(wsPath, operation) {
	const previous = workspaceWriteQueues.get(wsPath) || Promise.resolve();
	const run = async () => operation();
	const current = previous.then(run, run);
	workspaceWriteQueues.set(wsPath, current.catch(() => {}));
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
// 该项目当前有多少个会话持有项目作用域。项目 MCP 是挂到会话作用域的，serverName 全局唯一，
// 因此并发会话数是「第二个会话挂不上项目 MCP」的第一诊断线索。
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
	const cached = workspaceCacheGet(ctx, wsPath);
	if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached.config;
	const config = await readWorkspaceConfig(wsPath, (path) => readFile(path, "utf8"));
	workspaceCacheSet(ctx, wsPath, { mtimeMs: info.mtimeMs, size: info.size, config });
	return config;
}
async function writeWorkspaceConfigFile(wsPath, servers, exclude) {
	await writeWorkspaceConfig(
		wsPath,
		{ servers, exclude },
		(path, text) => writeFileAtomic(path, text, { mode: 0o600 }),
		(path, options) => mkdir(path, options),
	);
	// 写后失效所有 ctx.root 命名空间下该路径的缓存条目。
	for (const bucket of workspaceConfigCache.values()) bucket.delete(wsPath);
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
	for (const [agent, state] of agentWorkspaceStates) {
		if (!agent?.ctx) continue;
		if (wsPath && state.wsPath !== wsPath) continue;
		try {
			const config = await readWorkspaceConfigCached(ctx, state.wsPath);
			applyWorkspaceRestrict(ctx, agent.ctx, agent, config.exclude);
		} catch { /* 下一次变化再重试 */ }
	}
}
// 工具集变化时重算所有存活会话的项目工具投射（共享连接异步就绪/重连/工具增减）。
// register() 自身会再发 tools/change，用重入守卫避免无限递归；标志按 app root 隔离。
const syncingProjectToolsByRoot = new Map(); // ctx.root -> boolean
function reconcileSessionProjectTools(ctx) {
	const root = sharedConnRoot(ctx);
	if (syncingProjectToolsByRoot.get(root)) return;
	syncingProjectToolsByRoot.set(root, true);
	try {
		const slotsByAgent = agentProjectSlotsByRoot.get(root);
		if (!slotsByAgent) return;
		for (const [agent, slots] of slotsByAgent) {
			const agentCtx = agent?.ctx;
			if (!agentCtx) continue;
			for (const slot of slots.values()) {
				try { syncSessionProjectTools(ctx, agentCtx, agent, slot.entry); } catch { /* 下一次变化再试 */ }
			}
		}
	} finally {
		syncingProjectToolsByRoot.delete(root);
	}
}
function composeAgentSetup(ctx, callerSetup) {
	return async (agentCtx) => {
		const agent = agentCtx.agent;
		const cwd = agent?.session?.header?.cwd;
		if (typeof cwd === "string" && cwd.length > 0) {
			const wsPath = canonicalWorkspacePath(cwd);
			try {
				const config = await readWorkspaceConfigCached(ctx, wsPath);
				if (!config.error && !config.missing) {
					agentWorkspaceStates.set(agent, { wsPath, restrictKey: undefined, restrictDisposer: undefined });
					agentCtx.effect?.(() => () => {
						agentWorkspaceStates.delete(agent);
						disposeAgentProjectSlots(ctx, agent);
					}, "mcp-manager.workspaceScope");
					for (const server of config.servers) {
						if (server.disabled) continue;
						try {
							// 共享连接：每 (wsPath, serverName) 全进程只挂一份官方 mcp-client，所以 serverName
							// 只登记一次——同项目再开多少个会话都不会再撞名。
							const entry = await acquireSharedConnection(ctx, wsPath, server);
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
								void Promise.resolve(entry.fiber).then(
									() => clearWorkspaceMountError(wsPath, server.name),
									(error) => {
										recordWorkspaceMountError(wsPath, server.name, error);
										ctx.logger?.warn?.(`mcp-manager: 项目 MCP ${server.name} 加载失败: ${error?.message ?? error}`);
									},
								);
							}
							// 把当前已注册的工具投射进本会话 own 层（可能为空，等 tools/change 补）。
							syncSessionProjectTools(ctx, agentCtx, agent, entry);
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
	const restore = [];
	for (const method of AGENT_METHODS) {
		const original = agentsService[method];
		if (typeof original !== "function" || original[AGENT_WRAPPED]) continue;
		const wrapper = function (...args) {
			const options = args[0];
			if (!options || typeof options !== "object") throw new TypeError(`mcp-manager: agents.${method}() requires options`);
			return original.call(this, { ...options, setup: composeAgentSetup(ctx, options.setup) });
		};
		wrapper[AGENT_WRAPPED] = true;
		agentsService[method] = wrapper;
		restore.push(() => { agentsService[method] = original; });
	}
	const disposeToolsChange = ctx.on?.("tools/change", () => {
		reconcileSessionProjectTools(ctx);
		return reconcileWorkspaceRestricts(ctx);
	});
	wrappedAgentsServices.add(identity);
	const cleanup = () => {
		if (!wrappedAgentsServices.has(identity)) return;
		wrappedAgentsServices.delete(identity);
		restore.forEach((fn) => fn());
		disposeToolsChange?.();
		// HMR/卸载：撤回所有存活会话的项目工具投射并释放共享连接引用，否则运行中
		// 会话仍持有指向已销毁连接的僵尸工具定义（旧模块的清理只在 agent 销毁时跑）。
		disposeAllAgentProjectSlots(ctx);
	};
	ctx.effect?.(() => () => cleanup(), "mcp-manager.agentRuntime");
	return cleanup;
}
// 幂等安装 agent 运行时装饰器；安装失败(agents 未就绪)静默，下次调用重试。
function ensureAgentRuntime(ctx) {
	try { return installAgentRuntime(ctx); } catch { return () => {}; }
}
// agents 服务可能晚于本插件就绪。交给 ctx.inject：依赖可用时安装、依赖消失时由 fiber 回滚。
// 取代过去「每个 RPC 都重试一次安装」的做法——那条路径会被面板轮询持续触发，把一次性
// 装配变成了按请求装配。
function installAgentRuntimeWhenReady(ctx) {
	if (typeof ctx?.inject !== "function") return ensureAgentRuntime(ctx);
	ctx.inject(["agents"], (scoped) => { ensureAgentRuntime(scoped); });
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
	readWorkspaceConfigCached,
	reconcileWorkspaceRestricts,
	withWorkspaceWrite,
	workspaceConnectionStatus,
	workspaceMountErrorsView,
	workspaceRestrictErrorView,
	writeWorkspaceConfigFile,
};
