import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { normalizeMcpImport } from '../lib/mcp-config.js'
import {
  evaluateEnvExpression,
  jsExpressionToTemplate,
  readWorkspaceConfig,
  specToMcpEntry,
  toMcpClientConfig,
  writeWorkspaceConfig,
} from '../lib/workspace-config.js'

test('jsExpressionToTemplate reverts every expressionValue form', () => {
  assert.equal(jsExpressionToTemplate('!!js process.env.API_KEY'), '${API_KEY}')
  assert.equal(jsExpressionToTemplate('!!js (process.env.TOKEN ?? "")'), '${TOKEN}')
  assert.equal(jsExpressionToTemplate('!!js (process.env.TOKEN ?? "fallback")'), '${TOKEN:-fallback}')
  assert.equal(jsExpressionToTemplate('!!js "Bearer " + (process.env.TOKEN ?? "")'), 'Bearer ${TOKEN}')
  assert.equal(jsExpressionToTemplate('!!js "a" + (process.env.X ?? "") + "b"'), 'a${X}b')
  assert.equal(jsExpressionToTemplate('!!js "C:\\\\tools\\\\" + (process.env.TOKEN ?? "") + "\\\\s.js"'), 'C:\\tools\\${TOKEN}\\s.js')
  assert.equal(jsExpressionToTemplate('npx'), 'npx')
  assert.equal(jsExpressionToTemplate(42), 42)
  assert.throws(() => jsExpressionToTemplate('!!js globalThis.exit()'), /无法安全写回/)
  assert.throws(() => jsExpressionToTemplate('!!js '), /空的 !!js/)
})

test('spec_to_entry roundtrips through normalizeMcpImport', () => {
  const spec = {
    name: 'local',
    transport: 'stdio',
    command: '!!js process.env.NPX',
    args: ['-y', 'example-mcp', '!!js (process.env.MODE ?? "")'],
    env: { API_KEY: '!!js process.env.API_KEY', GREETING: '!!js "hi " + (process.env.WHO ?? "you")' },
    cwd: 'C:\\proj',
    toolCallTimeoutMs: 30000,
    failOnStartupError: true,
    reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 },
    disabled: false,
  }
  const entry = specToMcpEntry(spec)
  assert.deepEqual(entry, {
    command: '${NPX}',
    args: ['-y', 'example-mcp', '${MODE}'],
    env: { API_KEY: '${API_KEY}', GREETING: 'hi ${WHO:-you}' },
    cwd: 'C:\\proj',
    toolCallTimeoutMs: 30000,
    failOnStartupError: true,
    reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 },
    disabled: false,
  })
  const back = normalizeMcpImport({ mcpServers: { local: entry } }).servers[0]
  assert.deepEqual(back, {
    name: 'local',
    transport: 'stdio',
    command: '!!js process.env.NPX',
    args: ['-y', 'example-mcp', '!!js process.env.MODE'],
    env: {
      API_KEY: '!!js process.env.API_KEY',
      GREETING: '!!js "hi " + (process.env.WHO ?? "you")',
    },
    cwd: 'C:\\proj',
    toolCallTimeoutMs: 30000,
    failOnStartupError: true,
    reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 },
    disabled: false,
  })
})

test('http spec roundtrip keeps type/url/headers', () => {
  const spec = {
    name: 'remote',
    transport: 'streamable-http',
    url: 'https://example.test/mcp',
    headers: { Authorization: '!!js "Bearer " + (process.env.TOKEN ?? "")' },
  }
  const entry = specToMcpEntry(spec)
  assert.deepEqual(entry, { type: 'http', url: 'https://example.test/mcp', headers: { Authorization: 'Bearer ${TOKEN}' } })
  const back = normalizeMcpImport({ mcpServers: { remote: entry } }).servers[0]
  assert.deepEqual(back, spec)
})

test('readWorkspaceConfig parses valid file and surfaces errors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ws-'))
  const read = (path) => readFile(path, 'utf8')
  try {
    const configDir = join(root, '.dsh')
    await import('node:fs/promises').then((fs) => fs.mkdir(configDir, { recursive: true }))
    await writeFile(join(configDir, 'mcp.json'), JSON.stringify({
      mcpServers: {
        local: { command: 'npx', args: ['-y', 'demo'], env: { KEY: '${KEY}' } },
        remote: { type: 'http', url: 'https://example.test/mcp' },
      },
      exclude: ['github'],
    }, null, 2))
    const config = await readWorkspaceConfig(root, read)
    assert.equal(config.error, '')
    assert.deepEqual(config.servers.map((s) => s.name), ['local', 'remote'])
    assert.deepEqual(config.exclude, ['github'])
    assert.deepEqual(config.servers[0].env, { KEY: '!!js process.env.KEY' })

    const missing = await readWorkspaceConfig(join(root, 'nope'), read)
    assert.equal(missing.error, '')
    assert.equal(missing.missing, true)
    assert.deepEqual(missing.servers, [])

    const rootOnly = await mkdtemp(join(tmpdir(), 'dsh-ws-'))
    const rootOnlyDir = join(rootOnly, '.dsh')
    await import('node:fs/promises').then((fs) => fs.mkdir(rootOnlyDir, { recursive: true }))
    await writeFile(join(rootOnlyDir, 'mcp.json'), 'not json {')
    const invalid = await readWorkspaceConfig(rootOnly, read)
    assert.match(invalid.error, /不是合法 JSON/)
    assert.deepEqual(invalid.servers, [])

    const badEntry = await mkdtemp(join(tmpdir(), 'dsh-ws-'))
    const badEntryDir = join(badEntry, '.dsh')
    await import('node:fs/promises').then((fs) => fs.mkdir(badEntryDir, { recursive: true }))
    await writeFile(join(badEntryDir, 'mcp.json'), JSON.stringify({ mcpServers: { bad: { url: 'nope' } } }))
    const bad = await readWorkspaceConfig(badEntry, read)
    assert.match(bad.error, /配置无效/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('writeWorkspaceConfig produces Claude-compatible JSON and roundtrips', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ws-'))
  const read = (path) => readFile(path, 'utf8')
  const write = (path, text) => writeFile(path, text)
  const mkdir = (path, opts) => import('node:fs/promises').then((fs) => fs.mkdir(path, opts))
  try {
    const servers = [
      { name: 'local', transport: 'stdio', command: 'npx', args: ['-y', 'demo'], env: { KEY: '!!js process.env.KEY' } },
      { name: 'remote', transport: 'streamable-http', url: 'https://example.test/mcp', headers: { A: '!!js process.env.T' } },
    ]
    const { path } = await writeWorkspaceConfig(root, { servers, exclude: ['github'] }, write, mkdir)
    const text = await readFile(path, 'utf8')
    const parsed = JSON.parse(text)
    assert.deepEqual(parsed, {
      mcpServers: {
        local: { command: 'npx', args: ['-y', 'demo'], env: { KEY: '${KEY}' } },
        remote: { type: 'http', url: 'https://example.test/mcp', headers: { A: '${T}' } },
      },
      exclude: ['github'],
    })
    const config = await readWorkspaceConfig(root, read)
    assert.deepEqual(config.servers, servers)
    assert.deepEqual(config.exclude, ['github'])
    assert.equal(config.error, '')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('evaluateEnvExpression resolves runtime values', () => {
  const env = { TOKEN: 'abc', MISSING: undefined, EMPTY: '', WHO: 'world' }
  assert.equal(evaluateEnvExpression('!!js process.env.TOKEN', env), 'abc')
  assert.equal(evaluateEnvExpression('!!js (process.env.MISSING ?? "fb")', env), 'fb')
  assert.equal(evaluateEnvExpression('!!js (process.env.EMPTY ?? "fb")', env), '')
  assert.equal(evaluateEnvExpression('!!js "Bearer " + (process.env.TOKEN ?? "")', env), 'Bearer abc')
  assert.equal(evaluateEnvExpression('!!js "hi " + (process.env.WHO ?? "you")', env), 'hi world')
  assert.equal(evaluateEnvExpression('plain', env), 'plain')
  assert.throws(() => evaluateEnvExpression('!!js globalThis.exit()', env), /无法求值/)
})

test('toMcpClientConfig maps spec to official client config', () => {
  const env = { TOKEN: 'abc', DB_BIN: 'psql' }
  const config = toMcpClientConfig(
    {
      name: 'db',
      transport: 'stdio',
      command: '!!js process.env.DB_BIN',
      args: ['--url', '!!js (process.env.DB_URL ?? "default")'],
      env: { KEY: '!!js process.env.TOKEN' },
      cwd: '',
      toolCallTimeoutMs: 30000,
    },
    '/ws/a',
    env,
  )
  assert.equal(config.serverName, 'db')
  assert.equal(config.transport, 'stdio')
  assert.equal(config.command, 'psql')
  assert.deepEqual(config.args, ['--url', 'default'])
  assert.deepEqual(config.env, { KEY: 'abc' })
  assert.equal(config.cwd, '/ws/a')

  const http = toMcpClientConfig(
    { name: 'api', transport: 'streamable-http', url: 'https://api.test/mcp', headers: { A: '!!js process.env.TOKEN' } },
    '/ws/a',
    env,
  )
  assert.equal(http.url, 'https://api.test/mcp')
  assert.deepEqual(http.headers, { A: 'abc' })
})

test('writeWorkspaceConfig omits empty exclude', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-ws-'))
  const write = (path, text) => writeFile(path, text)
  const mkdir = (path, opts) => import('node:fs/promises').then((fs) => fs.mkdir(path, opts))
  try {
    const { path } = await writeWorkspaceConfig(root, { servers: [], exclude: [] }, write, mkdir)
    const parsed = JSON.parse(await readFile(path, 'utf8'))
    assert.deepEqual(parsed, { mcpServers: {} })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
test('toMcpClientConfig rejects empty resolved command/url', () => {
  assert.throws(
    () => toMcpClientConfig({ name: 'broken', transport: 'stdio', command: '!!js process.env.DSH_MCP_UNDEFINED_VAR_XYZ' }, '/ws'),
    /command 求值为空/,
  )
  assert.throws(
    () => toMcpClientConfig({ name: 'broken', transport: 'streamable-http', url: '!!js process.env.DSH_MCP_UNDEFINED_URL_XYZ' }, '/ws'),
    /url 求值为空/,
  )
})
