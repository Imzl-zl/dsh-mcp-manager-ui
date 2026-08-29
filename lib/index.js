import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { withFileLock, writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { appendSelectedBuiltinMcpServers, BUILTIN_MCP_SERVERS, builtinMcpCatalog, normalizeMcpImport, readManagedMcpServers, setManagedMcpDisabled, updateManagedMcpPatch } from "./mcp-config.js";
import { deriveMcpPhase, formatMcpLog, sanitizeMcpLog } from "./mcp-observability.js";
import { jsExpressionToTemplate, readWorkspaceConfig, toMcpClientConfig, writeWorkspaceConfig, WORKSPACE_CONFIG_REL } from "./workspace-config.js";

var __runInitializers = function(thisArg, initializers, value) {
	var useValue = arguments.length > 2;
	for (var i = 0; i < initializers.length; i++) value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
	return useValue ? value : void 0;
};
var __esDecorate = function(ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
	function accept(f) {
		if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected");
		return f;
	}
	var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
	var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
	var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
	var _, done = false;
	for (var i = decorators.length - 1; i >= 0; i--) {
		var context = {};
		for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
		for (var p in contextIn.access) context.access[p] = contextIn.access[p];
		context.addInitializer = function(f) {
			if (done) throw new TypeError("Cannot add initializers after decoration has completed");
			extraInitializers.push(accept(f || null));
		};
		var result = (0, decorators[i])(kind === "accessor" ? {
			get: descriptor.get,
			set: descriptor.set
		} : descriptor[key], context);
		if (kind === "accessor") {
			if (result === void 0) continue;
			if (result === null || typeof result !== "object") throw new TypeError("Object expected");
			if (_ = accept(result.get)) descriptor.get = _;
			if (_ = accept(result.set)) descriptor.set = _;
			if (_ = accept(result.init)) initializers.unshift(_);
		} else if (_ = accept(result)) if (kind === "field") initializers.unshift(_);
		else descriptor[key] = _;
	}
	if (target) Object.defineProperty(target, contextIn.name, descriptor);
	done = true;
};

const MCP_NAME = "@deepseek-ai/dsh-mcp-client";
const ROOT_INCLUDE_ID = "include";
const REDACTED_VALUE = "__DSH_MCP_REDACTED__";
const REVEAL_REVISION_KEY = randomBytes(32);
const patchWriteQueues = new WeakMap();
const PHASE_TEXT = { 0: "waiting", 1: "loading", 2: "connected", 3: "failed", 4: "stopped", 5: "unloading" };

// mcp-client 的连接状态只存在于日志（rc.7 没有可订阅的 wire 事件）。
// 我们通过 ctx.logger.exporter 订阅全部日志，按 scope 过滤出 mcp-client(<serverName>) 的记录。
const recentMcpLogs = new WeakMap();
const recentFiberLogs = new WeakMap();
const MAX_LOG_RECORDS = 12;
const logScope = (ctx) => ctx?.root || ctx;
function appendRecent(store, key, record) {
  const list = store.get(key) || [];
  list.push(record);
  if (list.length > MAX_LOG_RECORDS) list.splice(0, list.length - MAX_LOG_RECORDS);
  store.set(key, list);
}
function recordMcpLog(ctx, message) {
  const text = sanitizeMcpLog(formatMcpLog(message));
  const record = { type: message.type, text, ts: message.ts };
  const fiber = message.fiber?.deref?.();
  if (fiber && (message.type === "error" || message.type === "warn")) appendRecent(recentFiberLogs, fiber, record);
  const match = /^mcp-client\(([^)]+)\)/.exec(String(message.name || "")) || /mcp-client\(([^)]+)\):/.exec(text);
  if (!match) return;
  const scope = logScope(ctx);
  const entry = recentMcpLogs.get(scope) || new Map();
  const serverName = match[1];
  appendRecent(entry, serverName, record);
  recentMcpLogs.set(scope, entry);
}
function lastLogFor(ctx, serverName, fiber) {
  const named = recentMcpLogs.get(logScope(ctx))?.get(serverName) || [];
  const scoped = fiber ? recentFiberLogs.get(fiber) || [] : [];
  const logs = [...named, ...scoped].sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const diagnostic = logs.filter((record) => /attempt failed|tool .*failed|McpError|ECONNREFUSED|giving up|did not close/i.test(record.text)).at(-1);
  return diagnostic || logs.at(-1) || null;
}
// 每个 ctx 只挂一次 exporter；构造与首次 list/status 都会触发，保证幂等。
const logCaptureState = new WeakMap();
function ensureLogCapture(ctx) {
  const scope = logScope(ctx);
  if (logCaptureState.has(scope)) return logCaptureState.get(scope).dispose;
  const logger = scope?.logger || ctx?.logger;
  const exporter = { colors: 0, levels: { default: 3 }, export: (message) => recordMcpLog(ctx, message) };
  let dispose = () => {};
  // Cordis 4.0.1 LoggerService.exporter() 的 disposer 删除的是“当前最大 ID”而非
  // 注册时 ID。固定 peer 版本下直接捕获 ID，避免热重载泄漏或误删其他 exporter。
  if (logger?.exporters instanceof Map && Number.isInteger(logger._snExporter)) {
    const exporterId = ++logger._snExporter;
    logger.exporters.set(exporterId, exporter);
    dispose = () => logger.exporters.delete(exporterId);
  } else if (logger?.exporter) {
    dispose = logger.exporter(exporter);
  }
  // 回放 exporter 注册前 buffer 中已有的 mcp-client 日志。
  for (const message of logger?.buffer || []) recordMcpLog(ctx, message);
  logCaptureState.set(scope, { dispose });
  ctx?.effect?.(() => () => {
    dispose();
    logCaptureState.delete(scope);
    recentMcpLogs.delete(scope);
  }, "mcpManager.logCapture");
  return dispose;
}

// All valid MCP entries include read-only entries from bundles, presets, and
// nested loader trees. Mutation checks below still require the profile entry id.
function allMcpEntries(ctx) {
	return [...ctx.loader.entries()].filter((entry) => entry.options.name === MCP_NAME && typeof entry.options.config?.serverName === "string");
}
function entriesForName(ctx, name) {
	return allMcpEntries(ctx).filter((entry) => entry.options.config.serverName === name);
}
function hasExternalMcpName(ctx, state, name) {
	return externalMcpEntries(ctx, state).some((entry) => entry.options.config.serverName === name);
}
function resolveManagedEntry(state, name, matches) {
	const id = state.entryIds.get(name);
	if (!id || matches.length !== 1 || matches[0].options.id !== id) return null;
	return matches[0];
}
function managedLiveEntry(ctx, state, name) {
	return resolveManagedEntry(state, name, entriesForName(ctx, name));
}
function projectToolSchema(schema) {
	return {
		name: schema.name,
		description: schema.description || "",
		parameters: schema.parameters ?? null,
	};
}
function revisionOf(value) {
	const serialized = JSON.stringify(value);
	if (serialized === undefined) throw new TypeError("revision input must be JSON-serializable");
	return createHash("sha256").update(serialized).digest("hex");
}
function toolInventory(ctx) {
	const serverNames = [...new Set(allMcpEntries(ctx).map((entry) => entry.options.config.serverName))];
	const schemas = new Map(serverNames.map((name) => [name, []]));
	const ambiguous = new Set();
	for (const schema of ctx.tools.schemas()) {
		const owners = serverNames.filter((name) => schema.name.startsWith(`mcp__${name}__`));
		if (owners.length === 1) schemas.get(owners[0]).push(schema);
		else if (owners.length > 1) owners.forEach((name) => ambiguous.add(name));
	}
	const counts = {};
	const revisions = {};
	for (const [name, owned] of schemas) {
		counts[name] = owned.length;
		revisions[name] = revisionOf(owned.map(projectToolSchema));
	}
	return { ambiguous, counts, revisions, schemas };
}
function patchPath(ctx) {
	const entry = [...ctx.loader.entries()].find((candidate) => candidate.options.id === ROOT_INCLUDE_ID && candidate.options.name === "cordis:include");
	const path = entry?.options.config?.path;
	if (typeof path !== "string") return null;
	const filename = path.startsWith("file:") ? fileURLToPath(path) : path;
	return join(dirname(filename), "cordis.patch.yml");
}
// Profile persistence is a Host-owned configuration capability, not a session workspace mutation.
// `ctx.fs` is intentionally fenced by the active workspace-write policy, so this target is
// derived only from the trusted root include and committed through the Host atomic writer.
function patchVersion(content) {
	return createHash("sha256").update(content).digest("hex");
}
async function readProfilePatchFile(path) {
	const [content, info] = await Promise.all([readFile(path, "utf8"), stat(path)]);
	if (!info.isFile()) throw new Error("profile patch is not a regular file");
	return { content, target: path, version: patchVersion(content), mode: info.mode & 0o777 || 0o600 };
}
function withPatchWrite(ctx, operation) {
	const previous = patchWriteQueues.get(ctx) || Promise.resolve();
	const run = async () => {
		const path = patchPath(ctx);
		if (!path) throw new Error("root include unavailable; cannot locate profile patch");
		return withFileLock(path, operation);
	};
	const current = previous.then(run, run);
	patchWriteQueues.set(ctx, current.catch(() => {}));
	return current;
}
async function readPatch(ctx) {
	const path = patchPath(ctx);
	if (!path) throw new Error("root include unavailable; cannot locate profile patch");
	return readProfilePatchFile(path);
}
async function writePatch(state, content, version = state.version) {
	const current = await readProfilePatchFile(state.target);
	if (current.version !== version) throw new Error(`FS_STALE_VERSION: profile patch changed since it was read: ${state.target}`);
	await writeFileAtomic(state.target, content, { mode: current.mode });
	return { operation: "update", version: patchVersion(content), before: current.content, after: content };
}
async function managedState(ctx) {
	const patch = await readPatch(ctx);
	const parsed = readManagedMcpServers(patch.content);
	return { ...patch, servers: parsed.servers, byName: new Map(parsed.servers.map((server) => [server.name, server])), entryIds: new Map(Object.entries(parsed.entryIds)) };
}
function profileMcpEntries(ctx) {
	const include = [...ctx.loader.entries()].find((entry) => entry.options.id === ROOT_INCLUDE_ID && entry.options.name === "cordis:include");
	const entries = include?.subtree?.entries?.();
	return entries ? new Set(entries) : null;
}
function externalMcpEntries(ctx, state) {
	const profileEntries = profileMcpEntries(ctx);
	const managedIds = new Set(state.entryIds.values());
	const managedNames = new Set(state.servers.map((server) => server.name));
	return allMcpEntries(ctx).filter((entry) => {
		if (profileEntries) return !profileEntries.has(entry) && !managedIds.has(entry.options.id);
		return !managedIds.has(entry.options.id) && !(!entry.options.group && managedNames.has(entry.options.config.serverName));
	});
}
function effectiveMcpServers(ctx, state) {
	return [
		...state.servers,
		...externalMcpEntries(ctx, state).map((entry) => ({ ...entry.options.config, name: entry.options.config.serverName })),
	];
}
function revealRevision(state, groups) {
	const values = [];
	for (const current of state.servers) {
		const entry = resolveManagedEntry(state, current.name, groups.get(current.name) || []);
		if (!entry) continue;
		const live = entry.options.config;
		values.push({
			name: current.name,
			url: live.url ?? current.url,
			args: live.args ?? current.args,
			env: live.env ?? current.env,
			headers: live.headers ?? current.headers,
		});
	}
	return createHmac("sha256", REVEAL_REVISION_KEY).update(JSON.stringify(values)).digest("base64url");
}
function setOwn(target, key, value) {
	Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
}
function isSafeEnvironmentReference(value) {
	return typeof value === "string" && /^!!js process\.env\.[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}
function redactMap(value) {
	const result = {};
	for (const [key, item] of Object.entries(value || {})) setOwn(result, key, isSafeEnvironmentReference(item) ? item : REDACTED_VALUE);
	return result;
}
function redactUrl(value) {
	if (isSafeEnvironmentReference(value)) return value;
	try {
		const parsed = new URL(value);
		return parsed.username || parsed.password || parsed.search || parsed.hash ? REDACTED_VALUE : value;
	} catch {
		return REDACTED_VALUE;
	}
}
function redactArgs(value) {
	return value.length ? [REDACTED_VALUE] : [];
}
function restoreRedactedMap(incoming, current, field) {
	if (incoming === undefined) return undefined;
	const result = {};
	for (const [key, value] of Object.entries(incoming)) {
		if (value !== REDACTED_VALUE) setOwn(result, key, value);
		else if (current?.[field] && Object.hasOwn(current[field], key)) setOwn(result, key, current[field][key]);
		else throw new Error(`${field}.${key} 没有可保留的现有值`);
	}
	return result;
}
function restoreRedactedSpec(spec, current) {
	const restored = structuredClone(spec);
	if (restored.url === REDACTED_VALUE) {
		if (current.url === undefined) throw new Error("url 没有可保留的现有值");
		restored.url = current.url;
	}
	if (Array.isArray(restored.args)) {
		const redactedCount = restored.args.filter((value) => value === REDACTED_VALUE).length;
		if (redactedCount > 0) {
			if (restored.args.length !== 1 || redactedCount !== 1) throw new Error("敏感参数的保留原值标记不能与新参数混合；请完整重填参数");
			if (!Array.isArray(current.args)) throw new Error("args 没有可保留的现有值");
			restored.args = structuredClone(current.args);
		}
	}
	if (restored.headers !== undefined) restored.headers = restoreRedactedMap(restored.headers, current, "headers");
	if (restored.env !== undefined) restored.env = restoreRedactedMap(restored.env, current, "env");
	return restored;
}
function containsRedactedValue(value) {
	if (value === REDACTED_VALUE) return true;
	if (Array.isArray(value)) return value.some(containsRedactedValue);
	if (value && typeof value === "object") return Object.values(value).some(containsRedactedValue);
	return false;
}
function summarize(entry, inventory, managed, conflict = false, lastLog = null) {
	const live = entry.options.config;
	const raw = managed || live;
	const phase = entry.fiber == null ? "stopped" : PHASE_TEXT[entry.fiber.state] ?? "unknown";
	const transport = live.transport === "streamable-http" || live.transport === "http" ? "http" : live.transport === "stdio" ? "stdio" : "?";
	const toolCountAmbiguous = inventory.ambiguous.has(live.serverName);
	const row = { serverName: live.serverName, enabled: !entry.disabled, managed: !!managed, conflict, transport, phase, toolCount: inventory.counts[live.serverName] || 0, toolCountAmbiguous, toolRevision: inventory.revisions[live.serverName] || "", scope: "global" };
	for (const field of ["command", "cwd", "toolCallTimeoutMs", "failOnStartupError"]) if (raw[field] !== undefined) row[field] = raw[field];
	if (raw.url !== undefined) row.url = redactUrl(raw.url);
	if (raw.args !== undefined) row.args = redactArgs(raw.args);
	if (raw.env !== undefined) row.env = redactMap(raw.env);
	if (raw.headers !== undefined) row.headers = redactMap(raw.headers);
	if (raw.reconnect !== undefined) row.reconnect = structuredClone(raw.reconnect);
	row.status = deriveMcpPhase(row, lastLog);
	row.lastError = row.status !== "failed" ? null : lastLog && (lastLog.type === "error" || lastLog.type === "warn")
		? sanitizeMcpLog(lastLog.text)
		: "MCP 未注册任何工具：连接失败或 tools/list 同步失败";
	return row;
}
// Fingerprint the exact redacted wire projection. Keeping a manual field list here
// would create a second source of truth and let newly projected fields go stale.
function listRevision(servers) {
	return revisionOf(servers);
}
function normalizeOne(spec) {
	return normalizeMcpImport({ mcpServers: { [spec.name]: spec } }).servers[0];
}
function reservedEntryIds(ctx, releasedIds = new Set()) {
	const ids = [];
	for (const entry of ctx.loader.entries()) {
		const id = entry.options.id;
		if (typeof id === "string" && !releasedIds.has(id)) ids.push(id);
	}
	return ids;
}
function importPreview(ctx, normalized, state) {
	const liveByName = new Map();
	for (const entry of externalMcpEntries(ctx, state)) {
		const name = entry.options.config.serverName;
		if (!liveByName.has(name)) liveByName.set(name, []);
		liveByName.get(name).push(entry);
	}
	const managedNames = new Set(state.servers.map((server) => server.name));
	const incomingNames = new Set(normalized.servers.map((server) => server.name));
	return {
		warnings: normalized.warnings,
		added: normalized.servers.filter((server) => !managedNames.has(server.name)).map((server) => server.name),
		updated: normalized.servers.filter((server) => managedNames.has(server.name)).map((server) => server.name),
		removed: state.servers.filter((server) => !incomingNames.has(server.name)).map((server) => server.name),
		conflicts: normalized.servers.filter((server) => {
			const live = liveByName.get(server.name) || [];
			const managedId = state.entryIds.get(server.name);
			return live.length > 0 && (!managedId || live.some((entry) => entry.options.id !== managedId));
		}).map((server) => server.name),
	};
}

// ---------- workspace 项目层 ----------
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
// 该项目当前有多少个运行中的会话。屏蔽只能作用于运行中的会话，这个数字让用户知道
// 这次切换有没有作用对象，也是排查「点了没反应」的第一现场。
function liveWorkspaceAgentCount(wsPath) {
	let count = 0;
	for (const state of agentWorkspaceStates.values()) if (state.wsPath === wsPath) count += 1;
	return count;
}
// 内部 spec 的 `!!js` 表达式 → 文件中的 `${VAR}` 模板形式；还原失败时原样返回（只影响展示，不落盘）。
function restoreTemplate(value) {
	if (typeof value !== "string" || !value.startsWith("!!js ")) return value;
	try { return jsExpressionToTemplate(value); } catch { return value; }
}
function restoreTemplateMap(value) {
	const result = {};
	for (const [key, item] of Object.entries(value || {})) result[key] = restoreTemplate(item);
	return result;
}
function restoreTemplateDeep(value) {
	if (typeof value === "string") return restoreTemplate(value);
	if (Array.isArray(value)) return value.map(restoreTemplateDeep);
	if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, restoreTemplateDeep(item)]));
	return value;
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
function workspaceServerView(server) {
	const row = {
		serverName: server.name,
		enabled: !server.disabled,
		managed: true,
		conflict: false,
		transport: server.transport === "stdio" ? "stdio" : "http",
		phase: "waiting",
		toolCount: 0,
		toolCountAmbiguous: false,
		toolRevision: "",
		status: "waiting",
		lastError: null,
		scope: "workspace",
	};
	// 展示层把内部 `!!js` 表达式还原为文件中的 `${VAR}` 模板，避免向用户泄漏内部表示；
	// 提交时 normalizeEntry 会再转回内部形式，roundtrip 可逆。
	for (const field of ["command", "cwd", "toolCallTimeoutMs", "failOnStartupError"]) if (server[field] !== undefined) row[field] = restoreTemplate(server[field]);
	if (server.url !== undefined) row.url = restoreTemplate(redactUrl(server.url));
	if (server.args !== undefined) row.args = redactArgs(server.args);
	if (server.env !== undefined) row.env = restoreTemplateMap(redactMap(server.env));
	if (server.headers !== undefined) row.headers = restoreTemplateMap(redactMap(server.headers));
	if (server.reconnect !== undefined) row.reconnect = structuredClone(server.reconnect);
	return row;
}
// 返回占用方描述(全局 / 项目名)或 null。全局包括 profile 管理项与外部 bundle/preset live 项。
async function workspaceNameTaken(ctx, name, exceptWsPath) {
	const state = await managedState(ctx);
	if (state.byName.has(name) || hasExternalMcpName(ctx, state, name)) return "全局";
	for (const record of await listWorkspaceRecords(ctx)) {
		if (record.path === exceptWsPath) continue;
		const config = await readWorkspaceConfigCached(ctx, record.path);
		if (config.servers.some((server) => server.name === name)) return record.title || basename(record.path);
	}
	return null;
}

// ---- workspace 项目层运行时:agent setup 时挂载到 agent scope ----
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
// 把 exclude 变更同步到运行中的会话。tools/change 只在全局工具集变化时触发，而面板改屏蔽
// 只写项目配置文件、不动全局工具集，必须由写入方主动触发重算，否则要等下一个会话才生效。
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

// 全局 MCP 列表核心（list / getWorkspaceView 共用）。
async function listMcpServers(ctx) {
	ensureLogCapture(ctx);
	const state = await managedState(ctx);
	const inventory = toolInventory(ctx);
	const groups = new Map();
	for (const entry of allMcpEntries(ctx)) {
		const name = entry.options.config.serverName;
		if (!groups.has(name)) groups.set(name, []);
		groups.get(name).push(entry);
	}
	const servers = [];
	for (const [name, entries] of groups) {
		const profileId = state.entryIds.get(name);
		const entry = entries.find((candidate) => candidate.options.id === profileId) || entries[0];
		const conflict = entries.length > 1;
		const managed = !conflict && entry.options.id === profileId ? state.byName.get(name) : null;
		servers.push(summarize(entry, inventory, managed, conflict, lastLogFor(ctx, name, entry.fiber)));
	}
	return {
		servers,
		revision: listRevision(servers),
		revealRevision: revealRevision(state, groups),
	};
}

let McpManagerGateway = (() => {
	let _classSuper = TypertRemoteService;
	let _instanceExtraInitializers = [];
	let _list_decorators, _status_decorators, _enable_decorators, _disable_decorators, _reconnect_decorators, _tools_decorators, _builtins_decorators, _installBuiltins_decorators, _add_decorators, _update_decorators, _remove_decorators, _reveal_decorators, _previewImport_decorators, _importJson_decorators, _listWorkspaces_decorators, _getWorkspaceView_decorators, _addWorkspaceServer_decorators, _updateWorkspaceServer_decorators, _removeWorkspaceServer_decorators, _setWorkspaceExclude_decorators, _installWorkspaceBuiltins_decorators, _previewWorkspaceImport_decorators, _importWorkspaceJson_decorators, _revealWorkspaceServer_decorators;
	return class McpManagerGateway extends _classSuper {
		static {
			const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
			_list_decorators = [Remote("list")];
			__esDecorate(this, null, _list_decorators, { kind: "method", name: "list", static: false, private: false, access: { has: (obj) => "list" in obj, get: (obj) => obj.list }, metadata: _metadata }, null, _instanceExtraInitializers);
			_status_decorators = [Remote("status")];
			__esDecorate(this, null, _status_decorators, { kind: "method", name: "status", static: false, private: false, access: { has: (obj) => "status" in obj, get: (obj) => obj.status }, metadata: _metadata }, null, _instanceExtraInitializers);
			_enable_decorators = [Remote("enable")];
			__esDecorate(this, null, _enable_decorators, { kind: "method", name: "enable", static: false, private: false, access: { has: (obj) => "enable" in obj, get: (obj) => obj.enable }, metadata: _metadata }, null, _instanceExtraInitializers);
			_disable_decorators = [Remote("disable")];
			__esDecorate(this, null, _disable_decorators, { kind: "method", name: "disable", static: false, private: false, access: { has: (obj) => "disable" in obj, get: (obj) => obj.disable }, metadata: _metadata }, null, _instanceExtraInitializers);
			_reconnect_decorators = [Remote("reconnect")];
			__esDecorate(this, null, _reconnect_decorators, { kind: "method", name: "reconnect", static: false, private: false, access: { has: (obj) => "reconnect" in obj, get: (obj) => obj.reconnect }, metadata: _metadata }, null, _instanceExtraInitializers);
			_tools_decorators = [Remote("tools")];
			__esDecorate(this, null, _tools_decorators, { kind: "method", name: "tools", static: false, private: false, access: { has: (obj) => "tools" in obj, get: (obj) => obj.tools }, metadata: _metadata }, null, _instanceExtraInitializers);
			_builtins_decorators = [Remote("builtins")];
			__esDecorate(this, null, _builtins_decorators, { kind: "method", name: "builtins", static: false, private: false, access: { has: (obj) => "builtins" in obj, get: (obj) => obj.builtins }, metadata: _metadata }, null, _instanceExtraInitializers);
			_installBuiltins_decorators = [Remote("installBuiltins")];
			__esDecorate(this, null, _installBuiltins_decorators, { kind: "method", name: "installBuiltins", static: false, private: false, access: { has: (obj) => "installBuiltins" in obj, get: (obj) => obj.installBuiltins }, metadata: _metadata }, null, _instanceExtraInitializers);
			_add_decorators = [Remote("add")];
			__esDecorate(this, null, _add_decorators, { kind: "method", name: "add", static: false, private: false, access: { has: (obj) => "add" in obj, get: (obj) => obj.add }, metadata: _metadata }, null, _instanceExtraInitializers);
			_update_decorators = [Remote("update")];
			__esDecorate(this, null, _update_decorators, { kind: "method", name: "update", static: false, private: false, access: { has: (obj) => "update" in obj, get: (obj) => obj.update }, metadata: _metadata }, null, _instanceExtraInitializers);
			_remove_decorators = [Remote("removeServer")];
			__esDecorate(this, null, _remove_decorators, { kind: "method", name: "removeServer", static: false, private: false, access: { has: (obj) => "removeServer" in obj, get: (obj) => obj.removeServer }, metadata: _metadata }, null, _instanceExtraInitializers);
			_reveal_decorators = [Remote("reveal")];
			__esDecorate(this, null, _reveal_decorators, { kind: "method", name: "reveal", static: false, private: false, access: { has: (obj) => "reveal" in obj, get: (obj) => obj.reveal }, metadata: _metadata }, null, _instanceExtraInitializers);
			_previewImport_decorators = [Remote("previewImport")];
			__esDecorate(this, null, _previewImport_decorators, { kind: "method", name: "previewImport", static: false, private: false, access: { has: (obj) => "previewImport" in obj, get: (obj) => obj.previewImport }, metadata: _metadata }, null, _instanceExtraInitializers);
			_importJson_decorators = [Remote("importJson")];
			__esDecorate(this, null, _importJson_decorators, { kind: "method", name: "importJson", static: false, private: false, access: { has: (obj) => "importJson" in obj, get: (obj) => obj.importJson }, metadata: _metadata }, null, _instanceExtraInitializers);
			_listWorkspaces_decorators = [Remote("listWorkspaces")];
			__esDecorate(this, null, _listWorkspaces_decorators, { kind: "method", name: "listWorkspaces", static: false, private: false, access: { has: (obj) => "listWorkspaces" in obj, get: (obj) => obj.listWorkspaces }, metadata: _metadata }, null, _instanceExtraInitializers);
			_getWorkspaceView_decorators = [Remote("getWorkspaceView")];
			__esDecorate(this, null, _getWorkspaceView_decorators, { kind: "method", name: "getWorkspaceView", static: false, private: false, access: { has: (obj) => "getWorkspaceView" in obj, get: (obj) => obj.getWorkspaceView }, metadata: _metadata }, null, _instanceExtraInitializers);
			_addWorkspaceServer_decorators = [Remote("addWorkspaceServer")];
			__esDecorate(this, null, _addWorkspaceServer_decorators, { kind: "method", name: "addWorkspaceServer", static: false, private: false, access: { has: (obj) => "addWorkspaceServer" in obj, get: (obj) => obj.addWorkspaceServer }, metadata: _metadata }, null, _instanceExtraInitializers);
			_updateWorkspaceServer_decorators = [Remote("updateWorkspaceServer")];
			__esDecorate(this, null, _updateWorkspaceServer_decorators, { kind: "method", name: "updateWorkspaceServer", static: false, private: false, access: { has: (obj) => "updateWorkspaceServer" in obj, get: (obj) => obj.updateWorkspaceServer }, metadata: _metadata }, null, _instanceExtraInitializers);
			_removeWorkspaceServer_decorators = [Remote("removeWorkspaceServer")];
			__esDecorate(this, null, _removeWorkspaceServer_decorators, { kind: "method", name: "removeWorkspaceServer", static: false, private: false, access: { has: (obj) => "removeWorkspaceServer" in obj, get: (obj) => obj.removeWorkspaceServer }, metadata: _metadata }, null, _instanceExtraInitializers);
			_setWorkspaceExclude_decorators = [Remote("setWorkspaceExclude")];
			__esDecorate(this, null, _setWorkspaceExclude_decorators, { kind: "method", name: "setWorkspaceExclude", static: false, private: false, access: { has: (obj) => "setWorkspaceExclude" in obj, get: (obj) => obj.setWorkspaceExclude }, metadata: _metadata }, null, _instanceExtraInitializers);
			_installWorkspaceBuiltins_decorators = [Remote("installWorkspaceBuiltins")];
			__esDecorate(this, null, _installWorkspaceBuiltins_decorators, { kind: "method", name: "installWorkspaceBuiltins", static: false, private: false, access: { has: (obj) => "installWorkspaceBuiltins" in obj, get: (obj) => obj.installWorkspaceBuiltins }, metadata: _metadata }, null, _instanceExtraInitializers);
			_previewWorkspaceImport_decorators = [Remote("previewWorkspaceImport")];
			__esDecorate(this, null, _previewWorkspaceImport_decorators, { kind: "method", name: "previewWorkspaceImport", static: false, private: false, access: { has: (obj) => "previewWorkspaceImport" in obj, get: (obj) => obj.previewWorkspaceImport }, metadata: _metadata }, null, _instanceExtraInitializers);
			_importWorkspaceJson_decorators = [Remote("importWorkspaceJson")];
			__esDecorate(this, null, _importWorkspaceJson_decorators, { kind: "method", name: "importWorkspaceJson", static: false, private: false, access: { has: (obj) => "importWorkspaceJson" in obj, get: (obj) => obj.importWorkspaceJson }, metadata: _metadata }, null, _instanceExtraInitializers);
			_revealWorkspaceServer_decorators = [Remote("revealWorkspaceServer")];
			__esDecorate(this, null, _revealWorkspaceServer_decorators, { kind: "method", name: "revealWorkspaceServer", static: false, private: false, access: { has: (obj) => "revealWorkspaceServer" in obj, get: (obj) => obj.revealWorkspaceServer }, metadata: _metadata }, null, _instanceExtraInitializers);
			if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
		}
		static inject = ["loader", "tools"];
		constructor(ctx) {
			super(ctx, "mcpManager");
			ensureLogCapture(ctx);
			installAgentRuntimeWhenReady(ctx);
			__runInitializers(this, _instanceExtraInitializers);
		}
		async list() {
			return listMcpServers(this.ctx);
		}
		async status(name) {
			ensureLogCapture(this.ctx);
			const value = String(name);
			const state = await managedState(this.ctx);
			const matches = entriesForName(this.ctx, value);
			if (!matches.length) throw new Error("no such MCP: " + name);
			const profileId = state.entryIds.get(value);
			const entry = matches.find((candidate) => candidate.options.id === profileId) || matches[0];
			const conflict = matches.length > 1;
			const inventory = toolInventory(this.ctx);
			return { server: summarize(entry, inventory, !conflict && entry.options.id === profileId ? state.byName.get(value) : null, conflict, lastLogFor(this.ctx, value, entry.fiber)) };
		}
		async enable(name) {
			return this.setDisabled(String(name), false);
		}
		async disable(name) {
			return this.setDisabled(String(name), true);
		}
		async setDisabled(name, disabled) {
			return withPatchWrite(this.ctx, async () => {
				const state = await managedState(this.ctx);
				const entry = managedLiveEntry(this.ctx, state, name);
				if (!entry) throw new Error("此 MCP 来自其他 bundle、存在同名冲突，或不属于当前 Web profile，不能修改");
				const persistedDisabled = state.byName.get(name)?.disabled === true;
				if (entry.disabled === disabled && persistedDisabled === disabled) return { note: disabled ? "already disabled" : "already enabled" };
				const outcome = await writePatch(state, setManagedMcpDisabled(state.content, name, disabled));
				if (entry.disabled === disabled) return { note: disabled ? "已校准 profile patch 为禁用" : "已校准 profile patch 为启用" };
				try {
					await entry.update({ disabled });
				} catch (error) {
					try {
						await writePatch(state, state.content, outcome.version);
					} catch (rollbackError) {
						throw new AggregateError([error, rollbackError], "MCP 状态更新失败，且 profile patch 回滚失败");
					}
					throw error;
				}
				return { note: disabled ? "已禁用并写入 profile patch" : "已启用并写入 profile patch" };
			});
		}
		async reconnect(name) {
			const value = String(name);
			const state = await managedState(this.ctx);
			const entry = managedLiveEntry(this.ctx, state, value);
			if (!entry) throw new Error("此 MCP 来自其他 bundle、存在同名冲突，或不属于当前 Web profile，不能重连");
			if (entry.disabled) throw new Error("MCP 已禁用，请先启用");
			if (entry.fiber) await entry.fiber.restart();
			else await entry.refresh();
			return { note: "restart requested" };
		}
		async tools(name) {
			const value = String(name);
			const inventory = toolInventory(this.ctx);
			return {
				tools: (inventory.schemas.get(value) || []).map(projectToolSchema),
				ambiguous: inventory.ambiguous.has(value),
			};
		}
		async builtins() {
			const state = await managedState(this.ctx);
			return { builtins: builtinMcpCatalog(effectiveMcpServers(this.ctx, state)) };
		}
		async installBuiltins(payload) {
			return withPatchWrite(this.ctx, async () => {
				const state = await managedState(this.ctx);
				const result = appendSelectedBuiltinMcpServers(
					state.content,
					effectiveMcpServers(this.ctx, state),
					payload?.ids,
					{ reservedIds: reservedEntryIds(this.ctx) },
				);
				if (result.content !== state.content) await writePatch(state, result.content);
				const notes = [];
				if (result.added.length) notes.push(`已追加：${result.added.join(", ")}`);
				if (result.skipped.length) notes.push(`已存在并跳过：${result.skipped.join(", ")}`);
				const { content: _content, ...summary } = result;
				return { ...summary, note: notes.join("；") || "未修改配置" };
			});
		}
		async add(spec) {
			if (containsRedactedValue(spec)) throw new Error("新增 MCP 不能包含保留原值标记");
			const normalized = normalizeOne(spec);
			return withPatchWrite(this.ctx, async () => {
				const state = await managedState(this.ctx);
				if (hasExternalMcpName(this.ctx, state, normalized.name) || state.byName.has(normalized.name)) throw new Error("MCP already exists: " + normalized.name);
				await writePatch(state, updateManagedMcpPatch(state.content, [normalized], { replace: false, reservedIds: reservedEntryIds(this.ctx) }));
				return { note: "已添加到 profile patch，正在热加载" };
			});
		}
		async update(spec) {
			const requestedName = String(spec?.name || "").trim();
			return withPatchWrite(this.ctx, async () => {
				const state = await managedState(this.ctx);
				const current = state.byName.get(requestedName);
				if (!current || !managedLiveEntry(this.ctx, state, requestedName)) throw new Error("此 MCP 存在同名冲突或不属于当前 Web profile，不能编辑");
				const normalized = normalizeOne(restoreRedactedSpec(spec, current));
				if (!Object.hasOwn(normalized, "disabled") && current.disabled) normalized.disabled = true;
				await writePatch(state, updateManagedMcpPatch(state.content, [normalized], { replace: false, reservedIds: reservedEntryIds(this.ctx, new Set([state.entryIds.get(normalized.name)].filter(Boolean))) }));
				return { note: "已更新 profile patch，正在热加载" };
			});
		}
		async removeServer(name) {
			const value = String(name);
			return withPatchWrite(this.ctx, async () => {
				const state = await managedState(this.ctx);
				if (!state.byName.has(value) || !managedLiveEntry(this.ctx, state, value)) throw new Error("此 MCP 存在同名冲突或不属于当前 Web profile，不能移除");
				await writePatch(state, updateManagedMcpPatch(state.content, [], { removeNames: [value] }));
				return { note: "已从 profile patch 移除；完全卸载以 DSH 热加载结果为准" };
			});
		}
		async reveal(payload) {
			const name = String(payload?.name || "");
			const field = String(payload?.field || "");
			const key = payload?.key === undefined ? undefined : String(payload.key);
			const state = await managedState(this.ctx);
			const current = state.byName.get(name);
			const entry = current ? managedLiveEntry(this.ctx, state, name) : null;
			if (!current || !entry) throw new Error("此 MCP 不属于当前 Web profile，不能读取配置");
			if (!["url", "args", "env", "headers"].includes(field)) throw new Error("不支持读取该配置字段");
			// 使用 loader 中已经解析环境表达式后的有效运行值；编辑表单仅把它用于显示，
			// 未实际修改输入时仍提交保留原值标记，不会把密钥写回 profile。
			const value = entry.options.config[field] ?? current[field];
			if (key !== undefined) {
				if (!value || typeof value !== "object" || !Object.hasOwn(value, key)) throw new Error("没有该配置项");
				return { value: value[key] };
			}
			return { value: structuredClone(value) };
		}
		async previewImport(payload) {
			const json = typeof payload?.json === "string" ? JSON.parse(payload.json) : payload?.json;
			const normalized = normalizeMcpImport(json);
			const state = await managedState(this.ctx);
			return importPreview(this.ctx, normalized, state);
		}
		async importJson(payload) {
			const mode = payload?.mode === "replace" ? "replace" : "merge";
			const json = typeof payload?.json === "string" ? JSON.parse(payload.json) : payload?.json;
			const normalized = normalizeMcpImport(json);
			return withPatchWrite(this.ctx, async () => {
				const state = await managedState(this.ctx);
				const preview = importPreview(this.ctx, normalized, state);
				if (preview.conflicts.length) throw new Error("以下同名 MCP 来自其他配置层，不能覆盖：" + preview.conflicts.join(", "));
				const releasedNames = mode === "replace" ? state.servers.map((server) => server.name) : preview.updated;
				const releasedIds = new Set(releasedNames.map((name) => state.entryIds.get(name)).filter(Boolean));
				await writePatch(state, updateManagedMcpPatch(state.content, normalized.servers, { replace: mode === "replace", reservedIds: reservedEntryIds(this.ctx, releasedIds) }));
				return {
					added: preview.added,
					updated: preview.updated,
					removed: mode === "replace" ? preview.removed : [],
					warnings: preview.warnings,
					note: mode === "replace" ? "已替换当前 profile 管理的 MCP 配置" : "已合并 MCP 配置",
				};
			});
		}
		async listWorkspaces() {
			const records = await listWorkspaceRecords(this.ctx);
			const workspaces = [];
			for (const record of records) {
				const config = await readWorkspaceConfigCached(this.ctx, record.path);
				workspaces.push({
					path: record.path,
					name: record.title || basename(record.path),
					serverCount: config.servers.length,
					excluded: config.exclude,
					error: config.error || "",
				});
			}
			return { workspaces, revision: revisionOf(workspaces) };
		}
		async getWorkspaceView(payload) {
			const rawPath = String(payload?.wsPath ?? (payload?.path || ""));
			if (!rawPath) throw new Error("缺少 workspace path");
			const wsPath = canonicalWorkspacePath(rawPath);
			const config = await readWorkspaceConfigCached(this.ctx, wsPath);
			const servers = config.servers.map((server) => workspaceServerView(server));
			const globalResult = await listMcpServers(this.ctx);
			const global = globalResult.servers.map((server) => ({ ...server, excluded: config.exclude.includes(server.serverName) }));
			const mountErrors = workspaceMountErrorsView(wsPath);
			const restrictError = workspaceRestrictErrorView(wsPath);
			const liveAgents = liveWorkspaceAgentCount(wsPath);
			return {
				path: wsPath,
				name: basename(wsPath),
				error: config.error || "",
				mountErrors,
				restrictError,
				liveAgents,
				revision: revisionOf({ servers, exclude: config.exclude, global: globalResult.revision, mountErrors, restrictError, liveAgents }),
				servers,
				exclude: config.exclude,
				global,
			};
		}
		async addWorkspaceServer(payload) {
			const wsPath = canonicalWorkspacePath(String(payload?.wsPath || ""));
			const spec = payload?.spec;
			if (!wsPath) throw new Error("缺少 workspace 路径");
			if (containsRedactedValue(spec)) throw new Error("新增 MCP 不能包含保留原值标记");
			const normalized = normalizeOne(spec);
			return withWorkspaceWrite(wsPath, async () => {
				const config = await readWorkspaceConfigCached(this.ctx, wsPath);
				if (config.error) throw new Error(config.error);
				if (config.servers.some((server) => server.name === normalized.name)) throw new Error("该项目已存在：" + normalized.name);
				const owner = await workspaceNameTaken(this.ctx, normalized.name, wsPath);
				if (owner) throw new Error(`serverName "${normalized.name}" 已被${owner}占用，请换一个名称`);
				await writeWorkspaceConfigFile(wsPath, [...config.servers, normalized], config.exclude);
				return { note: `已添加到项目配置：${normalized.name}` };
			});
		}
		async updateWorkspaceServer(payload) {
			const wsPath = canonicalWorkspacePath(String(payload?.wsPath || ""));
			const spec = payload?.spec;
			const requestedName = String(spec?.name || "").trim();
			if (!wsPath) throw new Error("缺少 workspace 路径");
			return withWorkspaceWrite(wsPath, async () => {
				const config = await readWorkspaceConfigCached(this.ctx, wsPath);
				if (config.error) throw new Error(config.error);
				const current = config.servers.find((server) => server.name === requestedName);
				if (!current) throw new Error("该项目中没有此 MCP：" + requestedName);
				const normalized = normalizeOne(restoreRedactedSpec(spec, current));
				if (normalized.name !== requestedName) {
					// 改名同样需要拦截同项目内的名称冲突，否则写盘时 mcpServers 对象键会静默覆盖。
					if (config.servers.some((server) => server.name === normalized.name)) throw new Error("该项目已存在：" + normalized.name);
					const owner = await workspaceNameTaken(this.ctx, normalized.name, wsPath);
					if (owner) throw new Error(`serverName "${normalized.name}" 已被${owner}占用，请换一个名称`);
				}
				const servers = config.servers.map((server) => (server.name === requestedName ? normalized : server));
				await writeWorkspaceConfigFile(wsPath, servers, config.exclude);
				return { note: `已更新项目配置：${normalized.name}` };
			});
		}
		async removeWorkspaceServer(payload) {
			const wsPath = canonicalWorkspacePath(String(payload?.wsPath || ""));
			const name = String(payload?.name || "");
			return withWorkspaceWrite(wsPath, async () => {
				const config = await readWorkspaceConfigCached(this.ctx, wsPath);
				if (config.error) throw new Error(config.error);
				const servers = config.servers.filter((server) => server.name !== name);
				if (servers.length === config.servers.length) throw new Error("该项目中没有此 MCP：" + name);
				await writeWorkspaceConfigFile(wsPath, servers, config.exclude);
				return { note: `已从项目配置移除：${name}；运行中的会话将在下次生效` };
			});
		}
		async setWorkspaceExclude(payload) {
			const wsPath = canonicalWorkspacePath(String(payload?.wsPath ?? (payload?.path || "")));
			const serverName = String(payload?.serverName || "");
			const hidden = payload?.hidden === true;
			if (!serverName) throw new Error("缺少 serverName");
			return withWorkspaceWrite(wsPath, async () => {
				const config = await readWorkspaceConfigCached(this.ctx, wsPath);
				if (config.error) throw new Error(config.error);
				const exclude = config.exclude.filter((name) => name !== serverName);
				if (hidden) exclude.push(serverName);
				await writeWorkspaceConfigFile(wsPath, config.servers, exclude);
				// 屏蔽/取消屏蔽只改项目配置，不会触发 tools/change，必须由写入方主动把新的
				// deny 同步给运行中的会话，否则要等下一个会话才生效。
				await reconcileWorkspaceRestricts(this.ctx, wsPath);
				return { note: hidden ? `已在项目内屏蔽 ${serverName}` : `已取消屏蔽 ${serverName}`, exclude };
			});
		}
		async installWorkspaceBuiltins(payload) {
			const wsPath = canonicalWorkspacePath(String(payload?.wsPath || ""));
			const ids = payload?.ids;
			if (!Array.isArray(ids) || !ids.length || !ids.every((id) => typeof id === "string")) throw new Error("内置 MCP ids 必须是非空字符串数组");
			return withWorkspaceWrite(wsPath, async () => {
				const config = await readWorkspaceConfigCached(this.ctx, wsPath);
				if (config.error) throw new Error(config.error);
				const known = new Map(BUILTIN_MCP_SERVERS.map((builtin) => [builtin.id, builtin]));
				const unknown = ids.filter((id) => !known.has(id));
				if (unknown.length) throw new Error(`未知的内置 MCP：${unknown.join(", ")}`);
				const existing = new Set(config.servers.map((server) => server.name));
				const added = [];
				const skipped = [];
				for (const id of ids) {
					const builtin = known.get(id);
					const owner = await workspaceNameTaken(this.ctx, builtin.name, wsPath);
					if (existing.has(builtin.name) || owner) { skipped.push(id); continue; }
					const spec = { name: builtin.name };
					for (const field of ["transport", "command", "args", "env", "cwd", "url", "headers", "toolCallTimeoutMs", "failOnStartupError", "reconnect"]) {
						if (builtin[field] !== undefined) spec[field] = structuredClone(builtin[field]);
					}
					added.push(spec);
				}
				if (!added.length) return { note: skipped.length ? `已存在并跳过：${skipped.join(", ")}` : "未修改配置" };
				await writeWorkspaceConfigFile(wsPath, [...config.servers, ...added], config.exclude);
				return { note: `已追加：${added.map((server) => server.name).join(", ")}${skipped.length ? `；已存在并跳过：${skipped.join(", ")}` : ""}` };
			});
		}
		async previewWorkspaceImport(payload) {
			const wsPath = canonicalWorkspacePath(String(payload?.wsPath || ""));
			const json = typeof payload?.json === "string" ? JSON.parse(payload.json) : payload?.json;
			const normalized = normalizeMcpImport(json);
			const config = await readWorkspaceConfigCached(this.ctx, wsPath);
			if (config.error) throw new Error(config.error);
			const existingNames = new Set(config.servers.map((server) => server.name));
			const conflicts = [];
			for (const server of normalized.servers) {
				const owner = await workspaceNameTaken(this.ctx, server.name, wsPath);
				if (owner) conflicts.push(`${server.name}（${owner}）`);
			}
			return {
				warnings: normalized.warnings,
				added: normalized.servers.filter((server) => !existingNames.has(server.name)).map((server) => server.name),
				updated: normalized.servers.filter((server) => existingNames.has(server.name)).map((server) => server.name),
				removed: [],
				conflicts,
			};
		}
		async importWorkspaceJson(payload) {
			const wsPath = canonicalWorkspacePath(String(payload?.wsPath || ""));
			const mode = payload?.mode === "replace" ? "replace" : "merge";
			const json = typeof payload?.json === "string" ? JSON.parse(payload.json) : payload?.json;
			const normalized = normalizeMcpImport(json);
			return withWorkspaceWrite(wsPath, async () => {
				const config = await readWorkspaceConfigCached(this.ctx, wsPath);
				if (config.error) throw new Error(config.error);
				const preview = await this.previewWorkspaceImport({ wsPath, json, mode });
				if (preview.conflicts.length) throw new Error("以下 serverName 已被全局或其他项目占用：" + preview.conflicts.join(", "));
				let servers;
				if (mode === "replace") {
					servers = normalized.servers.slice();
				} else {
					const byName = new Map(config.servers.map((server) => [server.name, server]));
					for (const server of normalized.servers) byName.set(server.name, server);
					servers = [...byName.values()];
				}
				await writeWorkspaceConfigFile(wsPath, servers, config.exclude);
				return { added: preview.added, updated: preview.updated, removed: mode === "replace" ? [] : [], warnings: preview.warnings, note: mode === "replace" ? "已替换项目 MCP 配置" : "已合并项目 MCP 配置" };
			});
		}
		async revealWorkspaceServer(payload) {
			const wsPath = canonicalWorkspacePath(String(payload?.wsPath || ""));
			const name = String(payload?.name || "");
			const field = String(payload?.field || "");
			const key = payload?.key === undefined ? undefined : String(payload.key);
			const config = await readWorkspaceConfigCached(this.ctx, wsPath);
			if (config.error) throw new Error(config.error);
			const current = config.servers.find((server) => server.name === name);
			if (!current) throw new Error("该项目中没有此 MCP：" + name);
			if (!["url", "args", "env", "headers"].includes(field)) throw new Error("不支持读取该配置字段");
			const value = current[field];
			if (key !== undefined) {
				if (!value || typeof value !== "object" || !Object.hasOwn(value, key)) throw new Error("没有该配置项");
				return { value: restoreTemplateDeep(value[key]) };
			}
			// 返回文件模板形式（${VAR}）而非内部 `!!js` 表达式，与用户看到的文件一致。
			return { value: restoreTemplateDeep(structuredClone(value)) };
		}
	};
})();

export { McpManagerGateway, McpManagerGateway as default };
// 内部导出（供测试与宿主扩展使用）：agent 运行时装饰器与项目 MCP 挂载错误视图。
// 注意：这些 API 不在版本承诺内，仅服务于本插件测试与文档化调试。
export { applyWorkspaceRestrict, composeAgentSetup, installAgentRuntime, installAgentRuntimeWhenReady, liveWorkspaceAgentCount, workspaceMountErrorsView, workspaceRestrictErrorView };