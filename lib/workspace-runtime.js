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
					agentCtx.effect?.(() => () => { agentWorkspaceStates.delete(agent); }, "mcp-manager.workspaceScope");
					let mcpClient;
					for (const server of config.servers) {
						if (server.disabled) continue;
						try {
							// 走宿主 loader 解析：基点是 profile（与全局 MCP 的加载路径一致），而不是本插件的
							// 真实路径——后者在 link/pnpm 安装下找不到 dsh 自带的 mcp-client，且会引入第二份模块实例。
							mcpClient ??= await ctx.loader.import(MCP_NAME);
							const clientConfig = toMcpClientConfig(server, wsPath);
							// 传 Config 让 mcp-client 的 schemastery 校验参与兜底（args/env 默认化等）。
							const fiber = agentCtx.plugin({ apply: mcpClient.apply, inject: mcpClient.inject, name: mcpClient.name, Config: mcpClient.Config }, clientConfig);
							if (server.failOnStartupError) {
								// 与 mcp-client 全局语义一致：显式要求“启动失败阻止”的服务器等待就绪；
								// 失败（含 serverName 并发占用）在此记录，避免静默缺失。
								try {
									await fiber;
									clearWorkspaceMountError(wsPath, server.name);
								} catch (error) {
									recordWorkspaceMountError(wsPath, server.name, error);
									ctx.logger?.warn?.(`mcp-manager: 项目 MCP ${server.name} 启动失败: ${error?.message ?? error}`);
								}
							} else {
								// 默认异步挂载：首轮可能未就绪（README 已说明），失败仍记录为可观测错误。
								void Promise.resolve(fiber).then(
									() => clearWorkspaceMountError(wsPath, server.name),
									(error) => {
										recordWorkspaceMountError(wsPath, server.name, error);
										ctx.logger?.warn?.(`mcp-manager: 项目 MCP ${server.name} 加载失败: ${error?.message ?? error}`);
									},
								);
							}
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
	const disposeToolsChange = ctx.on?.("tools/change", () => reconcileWorkspaceRestricts(ctx));
	wrappedAgentsServices.add(identity);
	const cleanup = () => {
		if (!wrappedAgentsServices.has(identity)) return;
		wrappedAgentsServices.delete(identity);
		restore.forEach((fn) => fn());
		disposeToolsChange?.();
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
	workspaceMountErrorsView,
	workspaceRestrictErrorView,
	writeWorkspaceConfigFile,
};
