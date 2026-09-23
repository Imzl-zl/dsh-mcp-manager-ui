import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'
import {
  collectImportLocations,
  displayPath,
  hashSourceText,
  IMPORT_SOURCES,
  MAX_SOURCE_BYTES,
  normalizeSourceText,
  missingEnvNames,
  stripJsonComments,
  resolveImportLocation,
} from '../lib/mcp-import-sources.js'

const HOME = join('/home', 'u')
const SECRET = 'sk-live-LEAKCHECK-9000'

function context(overrides = {}) {
  return { home: HOME, platform: 'linux', env: {}, cwd: undefined, ...overrides }
}

/** 假的 readText：缺失文件按 ENOENT 抛出，与 Host 注入的实现契约一致。 */
function reader(files) {
  return async (path, maxBytes) => {
    if (!Object.hasOwn(files, path)) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
    const text = files[path]
    if (Buffer.byteLength(text) > maxBytes) throw Object.assign(new Error('too large'), { code: 'CODE_TOO_LARGE' })
    return text
  }
}

const codexPath = join(HOME, '.codex', 'config.toml')
const claudePath = join(HOME, '.claude.json')
const cursorPath = join(HOME, '.cursor', 'mcp.json')
const vscodePath = join('/home', 'u', '.config', 'Code', 'User', 'mcp.json')

function sourceOf(id) {
  return IMPORT_SOURCES.find((source) => source.id === id)
}

test('every declared source translates into the mcpServers shape the existing importer consumes', async () => {
  const files = {
    [claudePath]: JSON.stringify({ mcpServers: { files: { command: 'npx', args: ['-y', 'srv'] } } }),
    [codexPath]: '[mcp_servers.files]\ncommand = "npx"\n',
    [cursorPath]: JSON.stringify({ mcpServers: { files: { command: 'npx' } } }),
    [vscodePath]: JSON.stringify({ servers: { files: { type: 'stdio', command: 'npx' } } }),
  }
  const rows = await collectImportLocations(context(), reader(files), 'global')

  assert.ok(rows.length >= 4)
  for (const row of rows) {
    assert.equal(row.error, '')
    assert.equal(row.exists, true)
    assert.equal(row.contentHash, hashSourceText(files[row.path]))
    const importable = row.entries.filter((entry) => !entry.error)
    assert.ok(importable.length, `${row.sourceId} 应至少有一条可导入条目`)
    for (const entry of importable) {
      assert.equal(entry.spec.name, 'files')
      assert.equal(entry.spec.transport, 'stdio')
      assert.equal(entry.spec.command, 'npx')
    }
  }
})

test('Codex TOML maps the fields DSH can represent and warns about the rest', () => {
  const toml = `
[mcp_servers.files]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-filesystem", "/data"]
env = { LOG_LEVEL = "debug" }
cwd = "/data"
enabled = false
startup_timeout_sec = 30
tool_timeout_sec = 45
enabled_tools = ["read_file"]

[mcp_servers.api]
url = "https://mcp.example.test/mcp"
bearer_token_env_var = "COMPANY_TOKEN"
tool_timeout_sec = 12.5
http_headers = { "X-Org" = "org-1" }
env_http_headers = { "X-Token" = "TOKEN_ENV" }
`
  const { entries, warnings, error } = normalizeSourceText(sourceOf('codex'), toml, 'toml')
  assert.equal(error, '')

  const filesEntry = entries.find((entry) => entry.name === 'files')
  const apiEntry = entries.find((entry) => entry.name === 'api')
  const files = filesEntry.spec
  assert.deepEqual(files, {
    name: 'files',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/data'],
    env: { LOG_LEVEL: 'debug' },
    cwd: '/data',
    toolCallTimeoutMs: 45000,
    disabled: true,
  })

  const api = apiEntry.spec
  assert.deepEqual(api, {
    name: 'api',
    transport: 'streamable-http',
    url: 'https://mcp.example.test/mcp',
    headers: {
      Authorization: '!!js "Bearer " + (process.env.COMPANY_TOKEN ?? "")',
      'X-Org': 'org-1',
      'X-Token': '!!js (process.env.TOKEN_ENV ?? "")',
    },
    toolCallTimeoutMs: 12500,
  })

  for (const field of ['startup_timeout_sec', 'enabled_tools']) {
    assert.ok(filesEntry.warnings.some((warning) => warning.includes(`files.${field}`)), `${field} 应产生条目级提示`)
  }
  // 条目级提示挂在条目上，供预览只汇总选中的条目；来源级列表保持干净。
  assert.deepEqual(warnings, [])
  assert.deepEqual(apiEntry.warnings, [])
  assert.equal(api.headers['X-Org'], 'org-1')
})

test('a field belonging to the other transport is warned about, never silently dropped', () => {
  // Codex 自己也拒绝这两种错配（stdio 不接受 http_headers，HTTP 不接受 args），
  // 关键是别既不转也不报——那看起来就像“已经导过来了”。
  const toml = `
[mcp_servers.wrong-half]
command = "node"
http_headers = { "X-Foo" = "bar" }
env_http_headers = { "X-Token" = "TOKEN_ENV" }

[mcp_servers.http-with-args]
url = "https://example.test/mcp"
args = ["-y", "srv"]
`
  const { entries } = normalizeSourceText(sourceOf('codex'), toml, 'toml')
  const stdio = entries.find((entry) => entry.name === 'wrong-half')
  assert.equal(stdio.error, null)
  assert.equal(stdio.spec.command, 'node')
  for (const field of ['http_headers', 'env_http_headers']) {
    assert.ok(stdio.warnings.some((warning) => warning.includes(`wrong-half.${field}`) && warning.includes('stdio')), `${field} 应提示与传输方式不符`)
  }
  assert.equal(Object.hasOwn(stdio.spec, 'headers'), false)

  const http = entries.find((entry) => entry.name === 'http-with-args')
  assert.equal(http.error, null)
  assert.ok(http.warnings.some((warning) => warning.includes('http-with-args.args') && warning.includes('streamable_http')))
})

test('Codex entry errors stay local to that entry instead of dropping the whole file', () => {
  const toml = `
[mcp_servers.broken]
command = "node"
url = "https://example.test/mcp"

[mcp_servers.good]
command = "node"

[mcp_servers.no-transport]
enabled = true
`
  const { entries, error } = normalizeSourceText(sourceOf('codex'), toml, 'toml')
  assert.equal(error, '')
  assert.match(entries.find((entry) => entry.name === 'broken').error, /同时配置了 command 和 url/)
  assert.match(entries.find((entry) => entry.name === 'no-transport').error, /既没有 command 也没有 url/)
  assert.equal(entries.find((entry) => entry.name === 'good').spec.command, 'node')
})

test('Codex tool_timeout_sec must be a positive number to become a timeout', () => {
  const toml = '[mcp_servers.files]\ncommand = "node"\ntool_timeout_sec = 0\n'
  const { entries } = normalizeSourceText(sourceOf('codex'), toml, 'toml')
  assert.equal(Object.hasOwn(entries[0].spec, 'toolCallTimeoutMs'), false)
  assert.ok(entries[0].warnings.some((warning) => warning.includes('tool_timeout_sec')))
})

test('JSON clients are read from their own section, including Windsurf serverUrl and VS Code servers', () => {
  const windsurf = normalizeSourceText(sourceOf('windsurf'), JSON.stringify({
    mcpServers: { remote: { serverUrl: 'https://example.test/mcp' } },
  }))
  assert.equal(windsurf.entries[0].spec.transport, 'streamable-http')
  assert.equal(windsurf.entries[0].spec.url, 'https://example.test/mcp')

  const vscode = normalizeSourceText(sourceOf('vscode'), JSON.stringify({
    servers: { remote: { type: 'http', url: 'https://example.test/mcp' }, local: { type: 'stdio', command: 'node' } },
  }))
  assert.deepEqual(vscode.entries.map((entry) => entry.spec.transport).sort(), ['stdio', 'streamable-http'])

  const wrongSection = normalizeSourceText(sourceOf('roo-code'), JSON.stringify({ servers: { x: { command: 'node' } } }))
  assert.deepEqual(wrongSection.entries, [])
  assert.match(wrongSection.error, /没有找到/)
})

test('an unsupported entry is reported per name while its siblings still import', () => {
  const json = JSON.stringify({
    mcpServers: {
      legacy: { type: 'sse', url: 'https://example.test/sse' },
      modern: { type: 'http', url: 'https://example.test/mcp' },
    },
  })
  const { entries } = normalizeSourceText(sourceOf('cursor'), json)
  assert.match(entries.find((entry) => entry.name === 'legacy').error, /sse/i)
  assert.equal(entries.find((entry) => entry.name === 'modern').spec.transport, 'streamable-http')
})

test('VS Code inputs make the file unimportable instead of poisoning single entries', () => {
  const json = JSON.stringify({
    inputs: [{ type: 'promptString', id: 'token' }],
    servers: { remote: { type: 'http', url: 'https://example.test/mcp', headers: { Authorization: 'Bearer ${input:token}' } } },
  })
  const { entries, error } = normalizeSourceText(sourceOf('vscode'), json)
  assert.deepEqual(entries, [])
  assert.match(error, /inputs/)
})

test('parse failures, missing files and oversized files are reported without throwing', async () => {
  const cases = [
    { path: claudePath, text: '{ not json', expect: /不是合法 JSON/ },
    { path: codexPath, text: 'command = ', expect: /不是合法 TOML/ },
  ]
  for (const item of cases) {
    const rows = await collectImportLocations(context(), reader({ [item.path]: item.text }), 'global')
    assert.match(rows[0].error, item.expect)
    assert.deepEqual(rows[0].entries, [])
  }

  const missing = await collectImportLocations(context(), reader({}), 'global')
  assert.deepEqual(missing, [], '摸不到的客户端不应出现在列表里')

  const rows = await collectImportLocations(context(), reader({ [claudePath]: 'x'.repeat(MAX_SOURCE_BYTES + 1) }), 'global')
  assert.equal(rows[0].exists, true)
  assert.match(rows[0].error, /上限/)
})

test('scanning is layer-filtered: the global tab never lists project files and vice versa', async () => {
  const files = {
    [join(HOME, '.cursor', 'mcp.json')]: JSON.stringify({ mcpServers: { glob: { command: 'node' } } }),
    [join(HOME, '.mcp.json')]: '{}',
    [join('/repo', '.mcp.json')]: JSON.stringify({ mcpServers: { proj: { command: 'node' } } }),
    [join('/repo', '.codex', 'config.toml')]: '[mcp_servers.proj]\ncommand = "node"\n',
    [join('/repo', '.vscode', 'mcp.json')]: JSON.stringify({ servers: { proj: { type: 'stdio', command: 'node' } } }),
  }
  // 即使带着 workspace 上下文，全局那一次也只列全局来源——这是「选全局就导全局」的实现处。
  const globals = await collectImportLocations(context({ cwd: '/repo' }), reader(files), 'global')
  assert.deepEqual(globals.map((row) => row.sourceId).sort(), ['cursor'])
  assert.equal(globals.every((row) => row.scope === 'global'), true)

  const projects = await collectImportLocations(context({ cwd: '/repo' }), reader(files), 'project')
  assert.deepEqual(projects.map((row) => row.sourceId).sort(), ['claude-code', 'codex', 'vscode'])
  assert.equal(projects.every((row) => row.entries[0].spec.name === 'proj'), true)
  assert.equal(projects.every((row) => !row.path.includes('..')), true)

  // 没有 workspace 上下文时项目位置根本不产出。
  assert.deepEqual(await collectImportLocations(context(), reader(files), 'project'), [])
})

test('resolveImportLocation recomputes the path from source id and scope only', async () => {
  const files = { [codexPath]: '[mcp_servers.a]\ncommand = "node"\n' }
  const row = await resolveImportLocation(context(), { sourceId: 'codex', scope: 'global' }, reader(files))
  assert.equal(row.path, codexPath)
  assert.equal(row.contentHash, hashSourceText(files[codexPath]))

  await assert.rejects(
    resolveImportLocation(context(), { sourceId: 'codex', scope: 'project' }, reader(files)),
    /需要 workspace 路径/,
  )
  await assert.rejects(
    resolveImportLocation(context(), { sourceId: 'nope', scope: 'global' }, reader(files)),
    /未知的导入来源/,
  )
})

test('missing env names are reported without their values', () => {
  const spec = {
    name: 'remote',
    transport: 'streamable-http',
    url: '!!js "https://x.test/mcp?t=" + (process.env.SET_VAR ?? "")',
    headers: { Authorization: '!!js "Bearer " + (process.env.MISSING_VAR ?? "")', 'X-Literal': 'plain' },
    args: ['--token', '!!js process.env.ALSO_MISSING'],
    env: { OK: '!!js (process.env.SET_VAR ?? "")' },
  }
  const names = missingEnvNames(spec, { SET_VAR: 'value', EMPTY_VAR: '' })
  assert.deepEqual(names.sort(), ['ALSO_MISSING', 'MISSING_VAR'])
  // 字符串字面量里的 `process.env.X` 是文案不是引用：只报真正的引用（旧的正则扫全文会
  // 把用户的一段说明文字算成"缺值变量"，界面多一条假提示）。
  assert.deepEqual(
    missingEnvNames({ headers: { X: '!!js "see process.env.NOT_A_REF please " + (process.env.REAL ?? "")' } }, {}),
    ['REAL'],
  )
  // 设了但为空值同样会退化成空字符串，所以也算「没有值」——只测这一个变量。
  assert.deepEqual(missingEnvNames({ headers: { X: '!!js (process.env.EMPTY_VAR ?? "")' } }, { EMPTY_VAR: '' }), ['EMPTY_VAR'])
  assert.equal(JSON.stringify(names).includes('value'), false, '只回变量名，不回值')
})

test('content hash changes with the file, so a stale preview can be detected', () => {
  const before = hashSourceText('[mcp_servers.a]\ncommand = "node"\n')
  const after = hashSourceText('[mcp_servers.a]\ncommand = "other"\n')
  assert.notEqual(before, after)
  assert.equal(before.length, 64)
})

test('parse failures never echo the offending line back to the browser', () => {
  const toml = `[mcp_servers.a]\ncommand = "node"\nbroken = "${SECRET}" extra`
  const tomlResult = normalizeSourceText(sourceOf('codex'), toml, 'toml')
  assert.match(tomlResult.error, /不是合法 TOML/)
  assert.equal(tomlResult.error.includes(SECRET), false)

  const json = `{"mcpServers":{"a":{"command":"node","secret":"${SECRET}"},,}}`
  const jsonResult = normalizeSourceText(sourceOf('cursor'), json)
  assert.match(jsonResult.error, /不是合法 JSON/)
  assert.equal(jsonResult.error.includes(SECRET), false)
})

test('an unsupported template value is reported without echoing the value itself', () => {
  const value = 'Bearer ${globalThis.process.exit()} ' + SECRET
  const result = normalizeSourceText(sourceOf('cursor'), JSON.stringify({
    mcpServers: { bad: { type: 'http', url: 'https://example.test/mcp', headers: { X: value } } },
  }))
  assert.equal(result.entries.length, 1)
  assert.match(result.entries[0].error, /不支持的变量表达式/)
  assert.equal(result.entries[0].error.includes(SECRET), false)
  assert.equal(JSON.stringify(result).includes(SECRET), false)
})

test('every source declares at most one location per scope', () => {
  // 结构不变量：来源的 key 就是 `sourceId:scope`，同作用域出现两个位置就会撞 key，
  // 并且「点哪行导哪个文件」变成不可判定。多个候选文件（OpenCode 的 .json/.jsonc）
  // 要放进同一个位置的 candidates。
  for (const source of IMPORT_SOURCES) {
    for (const ctx of [context(), context({ cwd: '/repo' })]) {
      const scopes = source.locations(ctx).map((location) => location.scope)
      assert.equal(new Set(scopes).size, scopes.length, `${source.id} 在同一作用域声明了多个位置`)
      for (const location of source.locations(ctx)) {
        assert.ok(location.candidates.length > 0, `${source.id} 的位置必须有候选文件`)
        for (const candidate of location.candidates) {
          assert.ok(['json', 'jsonc', 'toml'].includes(candidate.format), `${candidate.path} 的格式未知`)
        }
      }
    }
  }
})

test('OpenCode maps its own shape: mcp key, type discriminator, command array, environment, {env:}', () => {
  const json = JSON.stringify({
    $schema: 'https://opencode.ai/config.json',
    mcp: {
      'local-one': {
        type: 'local',
        command: ['docker', 'run', '-i', '--rm', 'ghcr.io/github/github-mcp-server'],
        environment: { GITHUB_TOKEN: '{env:GITHUB_PERSONAL_ACCESS_TOKEN}', PLAIN: 'kept' },
        cwd: '/work',
        enabled: false,
      },
      'remote-one': {
        type: 'remote',
        url: 'https://mcp.example.test/mcp',
        headers: { Authorization: 'Bearer {env:MCP_PAT}' },
        oauth: { clientId: 'x' },
        timeout: 5000,
      },
      'no-type': { command: ['node'] },
    },
  })
  const { entries } = normalizeSourceText(sourceOf('opencode'), json)

  const local = entries.find((entry) => entry.name === 'local-one')
  assert.deepEqual(local.spec, {
    name: 'local-one',
    transport: 'stdio',
    command: 'docker',
    args: ['run', '-i', '--rm', 'ghcr.io/github/github-mcp-server'],
    env: {
      GITHUB_TOKEN: '!!js (process.env.GITHUB_PERSONAL_ACCESS_TOKEN ?? "")',
      PLAIN: 'kept',
    },
    cwd: '/work',
    disabled: true,
  })

  const remote = entries.find((entry) => entry.name === 'remote-one')
  assert.deepEqual(remote.spec, {
    name: 'remote-one',
    transport: 'streamable-http',
    url: 'https://mcp.example.test/mcp',
    headers: { Authorization: '!!js "Bearer " + (process.env.MCP_PAT ?? "")' },
  })
  // 语义不同的东西不能静默吞掉。
  assert.ok(remote.warnings.some((warning) => warning.includes('timeout') && warning.includes('toolCallTimeoutMs')))
  assert.ok(remote.warnings.some((warning) => warning.includes('oauth')))
  assert.match(entries.find((entry) => entry.name === 'no-type').error, /type 必须是 local 或 remote/)
})

test('JSONC support survives comment markers inside strings and trailing commas', () => {
  const jsonc = `{
  // 行注释
  "mcpServers": {
    "docs": {
      "url": "https://mcp.example.test/mcp", /* 块注释 */
      "headers": { "X-Note": "a\\"b//not-a-comment", },
    },
  },
}`
  const stripped = stripJsonComments(jsonc)
  const parsed = JSON.parse(stripped)
  // 关键对抗用例：URL 里的 `//` 与字符串里的 `/*` 都不是注释，转义引号也不能提前结束字符串。
  assert.equal(parsed.mcpServers.docs.url, 'https://mcp.example.test/mcp')
  assert.equal(parsed.mcpServers.docs.headers['X-Note'], 'a"b//not-a-comment')

  const result = 
    // 走真实的读取路径：格式属于文件，`format: 'jsonc'` 就该把注释吃掉。
    normalizeSourceText(sourceOf('windsurf'), jsonc, 'jsonc')
  assert.equal(result.error, '')
  assert.equal(result.entries[0].spec.url, 'https://mcp.example.test/mcp')

  // 去掉注释后仍不是 JSON 时，报的是 JSONC（而不是 JSON）
  assert.match(normalizeSourceText(sourceOf('windsurf'), '{ "a": }', 'jsonc').error, /不是合法 JSONC/)
})

test('openCode reads .json first and falls back to .jsonc, reporting the file it actually read', async () => {
  const dir = join(HOME, '.config', 'opencode')
  const jsonPath = join(dir, 'opencode.json')
  const jsoncPath = join(dir, 'opencode.jsonc')
  const both = reader({
    [jsonPath]: JSON.stringify({ mcp: { fromJson: { type: 'local', command: ['node'] } } }),
    [jsoncPath]: `{ // jsonc\n "mcp": { "fromJsonc": { "type": "local", "command": ["node"] } } }`,
  })
  const first = await collectImportLocations(context(), both, 'global')
  const opencode = first.find((row) => row.sourceId === 'opencode')
  assert.deepEqual(opencode.entries.map((entry) => entry.name), ['fromJson'])
  assert.equal(opencode.path, jsonPath)

  const onlyJsonc = await collectImportLocations(context(), reader({
    [jsoncPath]: `{ // jsonc\n "mcp": { "fromJsonc": { "type": "local", "command": ["node"] } } }`,
  }), 'global')
  const fallback = onlyJsonc.find((row) => row.sourceId === 'opencode')
  assert.deepEqual(fallback.entries.map((entry) => entry.name), ['fromJsonc'])
  assert.equal(fallback.path, jsoncPath, '回退到 .jsonc 时报告的是真正读的那个文件')
})

test('pi and the shared MCP convention are read from their own paths', async () => {
  const piDir = join('/opt', 'pi-agent')
  const sharedDir = join(HOME, '.config', 'mcp')
  const files = {
    [join(piDir, 'mcp.json')]: JSON.stringify({ mcpServers: { docs: { command: 'node', args: ['d.js'] } } }),
    [join('/repo', '.pi', 'mcp.json')]: JSON.stringify({ mcpServers: { proj: { command: 'node' } } }),
    [join(sharedDir, 'mcp.json')]: JSON.stringify({ mcpServers: { shared: { url: 'https://example.test/mcp' } } }),
  }
  const env = { PI_CODING_AGENT_DIR: piDir }
  const globals = await collectImportLocations(context({ cwd: '/repo', env }), reader(files), 'global')
  const projects = await collectImportLocations(context({ cwd: '/repo', env }), reader(files), 'project')
  const bySource = new Map(globals.map((row) => [row.key, row]))
  const projectBySource = new Map(projects.map((row) => [row.key, row]))

  assert.deepEqual(bySource.get('pi:global').entries.map((entry) => entry.name), ['docs'])
  assert.equal(bySource.get('pi:global').path, join(piDir, 'mcp.json'), 'PI_CODING_AGENT_DIR 覆盖生效')
  assert.deepEqual(projectBySource.get('pi:project').entries.map((entry) => entry.name), ['proj'])
  assert.deepEqual(bySource.get('shared-mcp:global').entries.map((entry) => entry.name), ['shared'])
  assert.equal(globals.some((row) => row.scope === 'project'), false)
  assert.equal(projects.some((row) => row.scope === 'global'), false)
})

test('a pi entry using an unsupported transport fails alone, not the whole file', () => {
  const json = JSON.stringify({
    mcpServers: {
      old: { transport: 'sse', url: 'https://example.test/sse' },
      modern: { transport: 'streamable-http', url: 'https://example.test/mcp' },
      lazy: { command: 'node', transport: 'stdio', lifecycle: 'lazy', requestTimeoutMs: 30000 },
    },
  })
  const { entries } = normalizeSourceText(sourceOf('pi'), json)
  assert.match(entries.find((entry) => entry.name === 'old').error, /sse/i)
  assert.equal(entries.find((entry) => entry.name === 'modern').spec.transport, 'streamable-http')
  // pi 自己的字段没有 DSH 对应项，但要逐条告诉用户。
  const lazy = entries.find((entry) => entry.name === 'lazy')
  assert.equal(lazy.spec.command, 'node')
  assert.ok(lazy.warnings.some((warning) => warning.includes('lifecycle')))
  assert.ok(lazy.warnings.some((warning) => warning.includes('requestTimeoutMs')))
})

test('display paths hide the user name before anything reaches the browser', () => {
  // 这条断言必须在 Windows 上也跑：它正是唯一挡住用户名进浏览器的逻辑，
  // 而 `join('/') === '/'` 那种平台开关会让它在插件的主平台上永远被跳过。
  assert.equal(displayPath(join(HOME, '.claude.json'), HOME), '~/.claude.json')
  assert.equal(displayPath('/etc/hosts', HOME), '/etc/hosts')
  // Windows 风格路径（含反斜杠）同样要剥掉 home 前缀，且前缀必须整段匹配。
  assert.equal(displayPath('C:\\Users\\u\\.claude.json', 'C:\\Users\\u'), '~/.claude.json')
  assert.equal(displayPath('C:\\Users\\other\\.claude.json', 'C:\\Users\\u'), 'C:\\Users\\other\\.claude.json')
  assert.equal(displayPath('C:\\Users\\u2\\.claude.json', 'C:\\Users\\u'), 'C:\\Users\\u2\\.claude.json')
})

test('JSONC line comments end at every JSON line terminator, not only LF', () => {
  // CR-only（经典 Mac 换行）与 U+2028/U+2029 都是 JSON 的换行。只认 `\n` 会把后面的整段
  // 配置当成注释吃掉，剩下的还可能正好是一份"合法 JSON"——那是解析错，不是解析失败。
  for (const eol of ['\r', '\r\n', '\u2028', '\u2029']) {
    assert.deepEqual(JSON.parse(stripJsonComments(`{"a":1,// note${eol}"b":2}`)), { a: 1, b: 2 }, JSON.stringify(eol))
  }
  // 块注释仍然按 `*/` 结束，与 VS Code 的 jsonc 一致。
  assert.deepEqual(JSON.parse(stripJsonComments('{"a":1/* c */}')), { a: 1 })
})

test('a UTF-8 BOM does not turn a valid config into a parse error', () => {
  // 记事本、PS 5.1 的 Out-File 会写 BOM，而 JSON.parse 不认——用户看到的却只是
  // "不是合法 JSON（第 1 行附近）"，指不到真正的原因。
  const json = '\uFEFF' + JSON.stringify({ mcpServers: { a: { command: 'node' } } })
  const plain = normalizeSourceText(sourceOf('claude-code'), json, 'json')
  assert.equal(plain.error, '')
  assert.equal(plain.entries[0].spec.command, 'node')
  const jsonc = '\uFEFF{ // c\n "mcpServers": { "a": { "command": "node" } } }'
  assert.equal(normalizeSourceText(sourceOf('claude-code'), jsonc, 'jsonc').error, '')
})

test('the documented location of every source is pinned per platform', () => {
  const linux = (env = {}) => ({ home: join('/home', 'u'), platform: 'linux', env, cwd: join('/repo') })
  const paths = (ctx, id, scope) => sourceOf(id).locations(ctx).find((location) => location.scope === scope).candidates.map((candidate) => candidate.path)

  // 这四家此前没有任何路径断言：来源表改错一个字符也不会有测试失败。
  assert.deepEqual(paths(linux(), 'windsurf', 'global'), [join('/home', 'u', '.codeium', 'windsurf', 'mcp_config.json')])
  assert.deepEqual(paths(linux(), 'gemini-cli', 'global'), [join('/home', 'u', '.gemini', 'settings.json')])
  assert.deepEqual(paths(linux(), 'roo-code', 'global'), [join('/home', 'u', '.roo', 'mcp.json')])
  assert.deepEqual(paths(linux(), 'roo-code', 'project'), [join('/repo', '.roo', 'mcp.json')])
  assert.deepEqual(paths(linux(), 'claude-desktop', 'global'), [join('/home', 'u', '.config', 'Claude', 'claude_desktop_config.json')])
  assert.deepEqual(paths(linux(), 'vscode', 'global'), [join('/home', 'u', '.config', 'Code', 'User', 'mcp.json')])
  // XDG_CONFIG_HOME 覆盖走同一条推导（Linux/Windows 都是它）。
  assert.deepEqual(
    paths(linux({ XDG_CONFIG_HOME: join('/etc', 'xdg') }), 'claude-desktop', 'global'),
    [join('/etc', 'xdg', 'Claude', 'claude_desktop_config.json')],
  )

  const win = { home: join('C:', 'Users', 'u'), platform: 'win32', env: { APPDATA: join('C:', 'Users', 'u', 'AppData', 'Roaming') }, cwd: join('C:', 'repo') }
  assert.deepEqual(paths(win, 'claude-desktop', 'global'), [join(win.env.APPDATA, 'Claude', 'claude_desktop_config.json')])
  assert.deepEqual(paths(win, 'vscode', 'global'), [join(win.env.APPDATA, 'Code', 'User', 'mcp.json')])
  // OpenCode 在所有平台都跟随 XDG（不是 Windows 的 APPDATA）。
  assert.deepEqual(paths(win, 'opencode', 'global'), [
    join(win.home, '.config', 'opencode', 'opencode.json'),
    join(win.home, '.config', 'opencode', 'opencode.jsonc'),
  ])
  // 没有 APPDATA 时退回 ~/AppData/Roaming。
  assert.deepEqual(paths({ ...win, env: {} }, 'vscode', 'global'), [join(win.home, 'AppData', 'Roaming', 'Code', 'User', 'mcp.json')])

  const mac = { home: join('/Users', 'u'), platform: 'darwin', env: {}, cwd: join('/repo') }
  assert.deepEqual(paths(mac, 'claude-desktop', 'global'), [join('/Users', 'u', 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')])

  // 没有 workspace 上下文时项目位置根本不产出（避免拼出半截路径）。
  assert.deepEqual(sourceOf('roo-code').locations({ home: '/home/u', platform: 'linux', env: {} }).map((location) => location.scope), ['global'])
})
