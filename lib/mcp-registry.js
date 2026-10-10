import { createHash } from "node:crypto";
import { setOwn } from "./own-property.js";

// loader 中的 MCP 条目视图与工具归属推断。这一层只认 loader/tools 两个宿主服务，
// 不涉及 profile patch 与 workspace 概念，因此可以被全局层与项目层同时依赖而不成环。
const MCP_NAME = "@deepseek-ai/dsh-mcp-client";

// All valid MCP entries include read-only entries from bundles, presets, and
// nested loader trees. Mutation checks in callers still require the profile entry id.
function allMcpEntries(ctx) {
	return [...ctx.loader.entries()].filter((entry) => entry.options.name === MCP_NAME && typeof entry.options.config?.serverName === "string");
}
function entriesForName(ctx, name) {
	return allMcpEntries(ctx).filter((entry) => entry.options.config.serverName === name);
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
		// serverName 是用户可控的键：`counts["__proto__"] = 0` 会被静默丢弃，读回来是
		// Object.prototype，于是这条永远报"未连接"且 toolCount 是个对象。走赋值原语。
		setOwn(counts, name, owned.length);
		setOwn(revisions, name, revisionOf(owned.map(projectToolSchema)));
	}
	return { ambiguous, counts, revisions, schemas };
}

export { allMcpEntries, entriesForName, MCP_NAME, projectToolSchema, revisionOf, toolInventory };
