import { dirname, join } from 'node:path'
import { normalizeMcpImport } from './mcp-config.js'

/**
 * 项目级 MCP 配置文件（<workspace>/.dsh/mcp.json）的读写。
 *
 * 文件格式与 Claude/Codex 生态兼容（mcpServers 映射），额外支持顶层
 * `exclude` 数组表示“本项目屏蔽的全局 serverName”：
 *
 *   {
 *     "mcpServers": {
 *       "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "."] },
 *       "unity-mcp": { "type": "http", "url": "http://localhost:8090/" }
 *     },
 *     "exclude": ["github"]
 *   }
 *
 * 环境变量在内部 spec 里以 `!!js process.env.X` 表达式承载（与 profile patch
 * 一致），写回 JSON 时反转为 `${VAR}` 模板，保证文件可被其他工具复用，且
 * 读回时经 normalizeMcpImport 可逆。
 */

export const WORKSPACE_CONFIG_REL = ['.dsh', 'mcp.json']

const JS_ENV = /^process\.env\.([A-Za-z_][A-Za-z0-9_]*)$/
const JS_FALLBACK = /^\(process\.env\.([A-Za-z_][A-Za-z0-9_]*) \?\? ("(?:\\.|[^"\\])*")\)$/
const JS_STRING = /^"(?:\\.|[^"\\])*"$/

/**
 * 按顶层 `+` 拆分 JS 拼接表达式；字符串字面量内部的 `+` 不拆分。
 * 仅识别由 expressionValue 生成的受限语法（env / fallback / 字符串字面量）。
 */
function splitJsConcat(body) {
  const tokens = []
  let cursor = 0
  let inString = false
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]
    if (char === '"') {
      if (!inString) {
        inString = true
      } else {
        // 引号前连续反斜杠为偶数 → 闭合；奇数 → 转义引号
        let slashes = 0
        for (let previous = index - 1; previous >= 0 && body[previous] === '\\'; previous -= 1) slashes += 1
        if (slashes % 2 === 0) inString = false
      }
      continue
    }
    if (char === '+' && !inString) {
      tokens.push(body.slice(cursor, index).trim())
      cursor = index + 1
    }
  }
  tokens.push(body.slice(cursor).trim())
  return tokens.filter(Boolean)
}

/**
 * 把受限的 `!!js ...` 表达式反转成 `${VAR}` / `${VAR:-fallback}` 模板。
 * 无法安全反转时抛错（宁可拒绝写盘，也不把 JS 表达式当普通字符串存进 JSON）。
 */
export function jsExpressionToTemplate(value) {
  if (typeof value !== 'string') return value
  if (!value.startsWith('!!js ')) return value
  const body = value.slice(5).trim()
  if (!body) throw new Error(`空的 !!js 表达式无法写回项目配置：「${value}」`)
  const tokens = splitJsConcat(body)
  let output = ''
  let hasTemplate = false
  for (const token of tokens) {
    let match = JS_ENV.exec(token)
    if (match) {
      output += `\${${match[1]}}`
      hasTemplate = true
      continue
    }
    match = JS_FALLBACK.exec(token)
    if (match) {
      const fallback = JSON.parse(match[2])
      output += fallback === '' ? `\${${match[1]}}` : `\${${match[1]}:-${fallback}}`
      hasTemplate = true
      continue
    }
    if (JS_STRING.test(token)) {
      output += JSON.parse(token)
      continue
    }
    throw new Error(`无法安全写回项目配置的表达式：「${value}」`)
  }
  if (!hasTemplate && output === '') throw new Error(`空的 !!js 表达式无法写回项目配置：「${value}」`)
  return output
}

function mapValues(value, fn) {
  const result = {}
  for (const [key, item] of Object.entries(value)) result[key] = fn(item)
  return result
}

function tokenValue(token, env) {
  let match = JS_ENV.exec(token)
  if (match) return env?.[match[1]] ?? ''
  match = JS_FALLBACK.exec(token)
  if (match) {
    const fallback = JSON.parse(match[2])
    return env?.[match[1]] ?? fallback
  }
  if (JS_STRING.test(token)) return JSON.parse(token)
  return undefined
}

/**
 * 运行时求值受限 !!js 表达式（process.env / ?? fallback / 字符串字面量拼接）。
 * 非表达式原样返回；无法求值的表达式抛错（绝不把 JS 字符串当普通字面量传下去）。
 */
export function evaluateEnvExpression(value, env = process.env) {
  if (typeof value !== 'string' || !value.startsWith('!!js ')) return value
  const body = value.slice(5).trim()
  const tokens = splitJsConcat(body)
  if (!tokens.length) throw new Error(`空的 !!js 表达式无法求值：「${value}」`)
  let output = ''
  for (const token of tokens) {
    const resolved = tokenValue(token, env)
    if (resolved === undefined) throw new Error(`无法求值的 !!js 表达式：「${value}」`)
    output += resolved
  }
  return output
}

/**
 * 项目内部 spec → 官方 @deepseek-ai/dsh-mcp-client 插件配置。
 * 环境变量表达式先求值为实际值（cwd 缺省为 workspace 根）。
 */
export function toMcpClientConfig(server, wsPath, env = process.env) {
  const config = {
    serverName: server.name,
    transport: server.transport,
    toolCallTimeoutMs: server.toolCallTimeoutMs,
    failOnStartupError: server.failOnStartupError,
  }
  if (server.reconnect !== undefined) config.reconnect = structuredClone(server.reconnect)
  if (server.transport === 'stdio') {
    config.command = evaluateEnvExpression(server.command, env)
    if (!config.command) throw new Error(`项目 MCP ${server.name} 的 command 求值为空，请检查环境变量`)
    if (Array.isArray(server.args) && server.args.length) config.args = server.args.map((value) => evaluateEnvExpression(value, env))
    if (server.env && Object.keys(server.env).length) {
      config.env = Object.fromEntries(Object.entries(server.env).map(([key, value]) => [key, evaluateEnvExpression(value, env)]))
    }
    config.cwd = evaluateEnvExpression(server.cwd || '', env) || wsPath
  } else {
    config.url = evaluateEnvExpression(server.url, env)
    if (!config.url) throw new Error(`项目 MCP ${server.name} 的 url 求值为空，请检查环境变量`)
    if (server.headers && Object.keys(server.headers).length) {
      config.headers = Object.fromEntries(Object.entries(server.headers).map(([key, value]) => [key, evaluateEnvExpression(value, env)]))
    }
  }
  return config
}

/**
 * 内部 spec（含 !!js 表达式）→ Claude/Codex 风格 mcpServers 条目（JSON 可写）。
 * HTTP 用 `type: "http"` 显式标注，stdio 由 command 推断；两向均与
 * normalizeMcpImport 兼容。
 */
export function specToMcpEntry(spec) {
  const entry = {}
  if (spec.transport === 'stdio') {
    entry.command = jsExpressionToTemplate(spec.command)
    if (Array.isArray(spec.args) && spec.args.length) entry.args = spec.args.map(jsExpressionToTemplate)
    if (spec.env && Object.keys(spec.env).length) entry.env = mapValues(spec.env, jsExpressionToTemplate)
    if (spec.cwd) entry.cwd = jsExpressionToTemplate(spec.cwd)
  } else {
    entry.type = 'http'
    entry.url = jsExpressionToTemplate(spec.url)
    if (spec.headers && Object.keys(spec.headers).length) entry.headers = mapValues(spec.headers, jsExpressionToTemplate)
  }
  if (spec.toolCallTimeoutMs !== undefined) entry.toolCallTimeoutMs = spec.toolCallTimeoutMs
  if (spec.failOnStartupError !== undefined) entry.failOnStartupError = spec.failOnStartupError
  if (spec.reconnect !== undefined) entry.reconnect = structuredClone(spec.reconnect)
  if (spec.disabled !== undefined) entry.disabled = spec.disabled
  return entry
}

function configPath(cwd) {
  return join(cwd, ...WORKSPACE_CONFIG_REL)
}

/**
 * 读取项目配置并 normalize 为内部 spec 列表。
 * 文件缺失返回空配置；JSON 非法/条目不合法时返回 error（保留最后有效配置由调用方决定）。
 */
export async function readWorkspaceConfig(cwd, readFileFn) {
  const path = configPath(cwd)
  let text
  try {
    text = await readFileFn(path)
  } catch (error) {
    if (error?.code === 'ENOENT') return { servers: [], exclude: [], error: '', missing: true }
    throw error
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { servers: [], exclude: [], error: `${WORKSPACE_CONFIG_REL.join('/')} 不是合法 JSON：${error?.message ?? error}` }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { servers: [], exclude: [], error: `${WORKSPACE_CONFIG_REL.join('/')} 根节点必须是 JSON 对象` }
  }
  const exclude = Array.isArray(parsed.exclude) ? parsed.exclude.filter((value) => typeof value === 'string') : []
  try {
    const normalized = normalizeMcpImport({ mcpServers: parsed.mcpServers })
    return { servers: normalized.servers, exclude, error: '', warnings: normalized.warnings, path }
  } catch (error) {
    return { servers: [], exclude, error: `${WORKSPACE_CONFIG_REL.join('/')} 配置无效：${error?.message ?? error}`, path }
  }
}

/**
 * 写入项目配置。servers 为内部 spec 列表；exclude 为全局 serverName 列表。
 */
export async function writeWorkspaceConfig(cwd, { servers, exclude }, writeFileFn, mkdirFn) {
  const path = configPath(cwd)
  const mcpServers = {}
  for (const server of servers) mcpServers[server.name] = specToMcpEntry(server)
  const doc = { mcpServers }
  if (Array.isArray(exclude) && exclude.length) doc.exclude = [...exclude]
  const text = JSON.stringify(doc, null, 2) + '\n'
  await mkdirFn(dirname(path), { recursive: true })
  await writeFileFn(path, text)
  return { text, path }
}
