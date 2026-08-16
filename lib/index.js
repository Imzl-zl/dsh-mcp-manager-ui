import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";

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
const PHASE_TEXT = { 0: "waiting", 1: "loading", 2: "connected", 3: "failed", 4: "stopped", 5: "unloading" };

function mcpEntries(ctx) {
	const out = [];
	for (const entry of ctx.loader.entries()) {
		if (entry.options.group) continue;
		if (entry.options.name !== MCP_NAME) continue;
		const config = entry.options.config;
		if (!config || typeof config.serverName !== "string") continue;
		out.push(entry);
	}
	return out;
}
function findEntry(ctx, name) {
	return mcpEntries(ctx).find((e) => e.options.config.serverName === name);
}
function countTools(ctx) {
	const counts = {};
	for (const s of ctx.tools.schemas()) {
		const m = /^mcp__([^.]+?)__/.exec(s.name);
		if (m) counts[m[1]] = (counts[m[1]] || 0) + 1;
	}
	return counts;
}
function yamlScalar(v) {
	if (typeof v !== "string") return "";
	const t = v.trim();
	if (t.startsWith("!!js ")) return t;
	return JSON.stringify(v);
}
function yamlFlowArray(arr) {
	return "[" + (arr || []).map((x) => JSON.stringify(String(x))).join(", ") + "]";
}
function yamlKey(k) {
	return String(k).replace(/[^A-Za-z0-9_-]/g, "_") || "key";
}
function summarize(entry, counts) {
	const config = entry.options.config;
	const phase = entry.fiber === void 0 || entry.fiber === null ? "stopped" : PHASE_TEXT[entry.fiber.state] ?? "unknown";
	const transport = config.transport === "streamable-http" || config.transport === "http" ? "http" : config.transport === "stdio" ? "stdio" : "?";
	const row = { serverName: config.serverName, enabled: !entry.disabled, transport, phase, toolCount: counts[config.serverName] || 0 };
	if (typeof config.command === "string") row.command = config.command;
	if (typeof config.url === "string") row.url = config.url;
	if (Array.isArray(config.args)) row.args = config.args.map(String);
	if (config.env && typeof config.env === "object") row.env = config.env;
	if (config.headers && typeof config.headers === "object") row.headers = config.headers;
	return row;
}
function patchPath(ctx) {
	for (const e of ctx.loader.entries()) {
		if (e.options.name !== "cordis:include") continue;
		const p = e.options.config && e.options.config.path;
		if (typeof p === "string")
			return p.replace(/^file:\/\//, "").replace(/^\//, "").replace(/\//g, "\\").replace(/cordis\.yml$/, "cordis.patch.yml");
	}
	return null;
}
async function readPatch(ctx) {
	const fs = ctx.get("fs");
	const path = patchPath(ctx);
	if (!fs || !path) return null;
	const target = await fs.resolve(path);
	return await fs.readText(target);
}
async function writePatch(ctx, content) {
	const fs = ctx.get("fs");
	const path = patchPath(ctx);
	if (!fs || !path) return { ok: false, error: "fs service unavailable" };
	const target = await fs.resolve(path);
	await fs.writeText(target, content);
	return { ok: true };
}
const splitLines = (content) => content.split(/\r?\n/);
const joinLines = (lines) => lines.join("\n");
function entryBlock(content, name) {
	const lines = splitLines(content);
	const idLine = "    - id: mcp-" + name;
	let start = -1;
	for (let i = 0; i < lines.length; i++) {
		if (lines[i] === idLine) { start = i; break; }
	}
	if (start < 0) return null;
	let end = lines.length;
	for (let i = start + 1; i < lines.length; i++) {
		const t = lines[i].trim();
		if (t.startsWith("- id:")) { end = i; break; }
		if (lines[i] !== "" && !lines[i].startsWith(" ") && !lines[i].startsWith("#")) { end = i; break; }
	}
	return { lines, start, end };
}
function buildEntryLines(name, transport, spec) {
	const lines = ["- insert:", "    - id: mcp-" + name, "      name: '" + MCP_NAME + "'", "      config:", "        transport: " + transport, "        serverName: " + yamlScalar(name)];
	if (transport === "streamable-http") {
		const url = String(spec.url || "").trim();
		if (!/^https?:\/\//.test(url)) return { error: "http server needs a valid url (http(s)://…)" };
		lines.push("        url: " + yamlScalar(url));
		const headers = spec.headers;
		if (headers && typeof headers === "object") {
			const keys = Object.keys(headers);
			if (keys.length) {
				lines.push("        headers:");
				for (const k of keys) {
					const v = String(headers[k] ?? "");
					if (!v) continue;
					lines.push("          " + yamlKey(k) + ": " + yamlScalar(v));
				}
			}
		}
	} else {
		const command = String(spec.command || "").trim();
		if (!command) return { error: "stdio server needs a command" };
		lines.push("        command: " + yamlScalar(command));
		if (Array.isArray(spec.args) && spec.args.length) lines.push("        args: " + yamlFlowArray(spec.args.map(String)));
		const env = spec.env;
		if (env && typeof env === "object") {
			const keys = Object.keys(env);
			if (keys.length) {
				lines.push("        env:");
				for (const k of keys) {
					const v = String(env[k] ?? "");
					if (v === "") continue;
					lines.push("          " + yamlKey(k) + ": " + yamlScalar(v));
				}
			}
		}
	}
	return { lines };
}

let McpManagerGateway = (() => {
	let _classSuper = TypertRemoteService;
	let _instanceExtraInitializers = [];
	let _list_decorators, _status_decorators, _enable_decorators, _disable_decorators, _reconnect_decorators, _tools_decorators, _add_decorators, _update_decorators, _remove_decorators;
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
			_add_decorators = [Remote("add")];
			__esDecorate(this, null, _add_decorators, { kind: "method", name: "add", static: false, private: false, access: { has: (obj) => "add" in obj, get: (obj) => obj.add }, metadata: _metadata }, null, _instanceExtraInitializers);
			_update_decorators = [Remote("update")];
			__esDecorate(this, null, _update_decorators, { kind: "method", name: "update", static: false, private: false, access: { has: (obj) => "update" in obj, get: (obj) => obj.update }, metadata: _metadata }, null, _instanceExtraInitializers);
			_remove_decorators = [Remote("removeServer")];
			__esDecorate(this, null, _remove_decorators, { kind: "method", name: "removeServer", static: false, private: false, access: { has: (obj) => "removeServer" in obj, get: (obj) => obj.removeServer }, metadata: _metadata }, null, _instanceExtraInitializers);
			if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
		}
		static inject = ["loader", "tools"];
		constructor(ctx) {
			super(ctx, "mcpManager");
			__runInitializers(this, _instanceExtraInitializers);
		}
		async list() {
			return { servers: mcpEntries(this.ctx).map((e) => summarize(e, countTools(this.ctx))) };
		}
		async status(name) {
			const entry = findEntry(this.ctx, String(name));
			if (!entry) throw new Error("no such server: " + name);
			return { server: summarize(entry, countTools(this.ctx)) };
		}
		async enable(name) {
			const entry = findEntry(this.ctx, String(name));
			if (!entry) throw new Error("no such server: " + name);
			if (!entry.disabled) return { note: "already enabled" };
			const content = await readPatch(this.ctx);
			if (content === null) { await entry.update({ disabled: false }); return { note: "enabled (memory only, fs unavailable)" }; }
			const block = entryBlock(content, name);
			if (!block) throw new Error("cannot locate entry in patch file");
			const kept = block.lines.filter((l, i) => i < block.start || i >= block.end || l.trim() !== "disabled: true");
			const res = await writePatch(this.ctx, joinLines(kept));
			if (!res.ok) throw new Error("write failed: " + res.error);
			await entry.update({ disabled: false });
			return { note: "enabled (patch file updated, applied live)" };
		}
		async disable(name) {
			const entry = findEntry(this.ctx, String(name));
			if (!entry) throw new Error("no such server: " + name);
			if (entry.disabled) return { note: "already disabled" };
			const content = await readPatch(this.ctx);
			if (content === null) { await entry.update({ disabled: true }); return { note: "disabled (memory only, fs unavailable)" }; }
			const block = entryBlock(content, name);
			if (!block) throw new Error("cannot locate entry in patch file");
			const lines = block.lines.slice();
			let inserted = false;
			for (let i = block.start; i < block.end; i++) {
				if (lines[i].trim() === "disabled: true") { inserted = true; break; }
			}
			if (!inserted) {
				for (let i = block.start; i < block.end; i++) {
					if (lines[i].trim() === "config:") { lines.splice(i, 0, "      disabled: true"); inserted = true; break; }
				}
			}
			if (!inserted) throw new Error("cannot find config: line in entry");
			const res = await writePatch(this.ctx, joinLines(lines));
			if (!res.ok) throw new Error("write failed: " + res.error);
			await entry.update({ disabled: true });
			return { note: "disabled (patch file updated, applied live)" };
		}
		async reconnect(name) {
			const entry = findEntry(this.ctx, String(name));
			if (!entry) throw new Error("no such server: " + name);
			if (entry.disabled) throw new Error("server is disabled; enable it first");
			if (entry.fiber) await entry.fiber.restart();
			else await entry.refresh();
			return { note: "restart requested" };
		}
		async tools(name) {
			const prefix = "mcp__" + String(name) + "__";
			const tools = this.ctx.tools.schemas().filter((s) => s.name.startsWith(prefix)).map((s) => ({ name: s.name, description: s.description || "" }));
			return { tools };
		}
		async add(spec) {
			if (!spec || typeof spec !== "object") throw new Error("invalid spec");
			const name = String(spec.name || "").trim();
			if (!name || !/^[a-z0-9][a-z0-9_-]*$/.test(name)) throw new Error("server name must match [a-z0-9][a-z0-9_-]*");
			if (findEntry(this.ctx, name)) throw new Error("server already exists: " + name);
			const transport = spec.transport === "http" ? "streamable-http" : "stdio";
			const built = buildEntryLines(name, transport, spec);
			if (built.error) throw new Error(built.error);
			const content = await readPatch(this.ctx);
			if (content === null) throw new Error("fs service unavailable; cannot persist");
			const appended = content.endsWith("\n") ? content + built.lines.join("\n") + "\n" : content + "\n" + built.lines.join("\n") + "\n";
			const res = await writePatch(this.ctx, appended);
			if (!res.ok) throw new Error("write failed: " + res.error);
			return { note: "added to patch file; HMR applying" };
		}
		async update(spec) {
			if (!spec || typeof spec !== "object") throw new Error("invalid spec");
			const name = String(spec.name || "").trim();
			const entry = findEntry(this.ctx, name);
			if (!entry) throw new Error("no such server: " + name);
			const transport = spec.transport === "http" ? "streamable-http" : "stdio";
			const built = buildEntryLines(name, transport, spec);
			if (built.error) throw new Error(built.error);
			const content = await readPatch(this.ctx);
			if (content === null) throw new Error("fs service unavailable; cannot persist");
			const block = entryBlock(content, name);
			if (!block) throw new Error("cannot locate entry in patch file");
			const hadDisabled = block.lines.slice(block.start, block.end).some((l) => l.trim() === "disabled: true");
			const out = block.lines.slice(0, block.start).concat(built.lines, block.lines.slice(block.end));
			if (hadDisabled) {
				const idx = out.indexOf(built.lines[1]);
				const configIdx = idx >= 0 ? idx + 3 : -1;
				if (configIdx >= 0 && out[configIdx].trim() === "config:") out.splice(configIdx, 0, "      disabled: true");
			}
			const res = await writePatch(this.ctx, joinLines(out));
			if (!res.ok) throw new Error("write failed: " + res.error);
			return { note: "updated in patch file; HMR applying" };
		}
		async removeServer(name) {
			if (!findEntry(this.ctx, String(name))) throw new Error("no such server: " + name);
			const content = await readPatch(this.ctx);
			if (content === null) throw new Error("fs service unavailable; cannot persist");
			const block = entryBlock(content, name);
			if (!block) throw new Error("cannot locate entry in patch file");
			let start = block.start;
			const prevLine = block.lines[block.start - 1];
			if (block.start > 0 && prevLine !== undefined && prevLine.trim() === "- insert:") {
				let entries = 0;
				for (let i = block.start; i < block.end; i++) {
					if (block.lines[i].trim().startsWith("- id:")) entries++;
				}
				if (entries === 1) start = block.start - 1;
			}
			const kept = block.lines.filter((l, i) => i < start || i >= block.end);
			const res = await writePatch(this.ctx, joinLines(kept));
			if (!res.ok) throw new Error("write failed: " + res.error);
			return { note: "removed from patch file; takes effect next restart" };
		}
	};
})();

export { McpManagerGateway, McpManagerGateway as default };