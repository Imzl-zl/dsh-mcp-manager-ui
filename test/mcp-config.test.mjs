import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeMcpImport,
  readManagedMcpServers,
  setManagedMcpDisabled,
  updateManagedMcpPatch,
} from '../lib/mcp-config.js'

test('normalizes Claude and Cursor JSON server maps into DSH config', () => {
  const result = normalizeMcpImport({
    mcpServers: {
      local: {
        command: 'npx',
        args: ['-y', 'example-mcp'],
        cwd: 'C:\\tools',
        env: { API_KEY: '${API_KEY}' },
      },
      remote: {
        type: 'http',
        url: 'https://example.test/mcp',
        headers: { Authorization: 'Bearer ${env:TOKEN}' },
      },
    },
  })

  assert.deepEqual(result.servers, [
    {
      name: 'local',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'example-mcp'],
      cwd: 'C:\\tools',
      env: { API_KEY: '!!js process.env.API_KEY' },
    },
    {
      name: 'remote',
      transport: 'streamable-http',
      url: 'https://example.test/mcp',
      headers: { Authorization: '!!js "Bearer " + (process.env.TOKEN ?? "")' },
    },
  ])
  assert.deepEqual(result.warnings, [])
})

test('escapes literal text around environment interpolation without enabling arbitrary JS', () => {
  const result = normalizeMcpImport({
    mcpServers: {
      local: { command: 'node', args: ['C:\\tools\\${TOKEN}\\server.js'] },
    },
  })
  assert.equal(result.servers[0].args[0], '!!js "C:\\\\tools\\\\" + (process.env.TOKEN ?? "") + "\\\\server.js"')
  const legacy = normalizeMcpImport({ mcpServers: { safe: { type: 'http', url: 'https://example.test/mcp', headers: { Authorization: '!!js `Bearer ${process.env.TOKEN}`' } } } })
  assert.equal(legacy.servers[0].headers.Authorization, '!!js "Bearer " + (process.env.TOKEN ?? "")')
  assert.throws(
    () => normalizeMcpImport({ mcpServers: { bad: { command: 'node', env: { X: '!!js globalThis.process.exit()' } } } }),
    /!!js.*只允许.*process\.env/i,
  )
  assert.throws(
    () => normalizeMcpImport({ mcpServers: { bad: { type: 'http', url: 'https://example.test/mcp', headers: { X: 'Bearer ${TOKEN} ${globalThis.process.exit()}' } } } }),
    /不支持的变量表达式/i,
  )
})

test('maps directTools true and false to enablement while absent preserves existing state', () => {
  const result = normalizeMcpImport({
    mcpServers: {
      enabled: { command: 'node', directTools: true },
      disabled: { command: 'node', directTools: false },
      absent: { command: 'node' },
      explicit: { command: 'node', directTools: true, disabled: true },
    },
  })

  assert.deepEqual(result.servers.map((server) => server.name), ['enabled', 'disabled', 'absent', 'explicit'])
  assert.equal(result.servers.some((server) => Object.hasOwn(server, 'directTools')), false)
  assert.equal(result.servers[0].disabled, false)
  assert.equal(result.servers[1].disabled, true)
  assert.equal(Object.hasOwn(result.servers[2], 'disabled'), false)
  assert.equal(result.servers[3].disabled, true)
  assert.deepEqual(result.warnings, [
    'enabled.directTools: true 已转换为 disabled: false（DSH 始终直接注册 MCP 工具）',
    'disabled.directTools: false 已转换为 disabled: true（DSH 不支持间接工具模式）',
    'explicit.directTools 已忽略；显式 disabled 优先',
  ])
})

test('normalizes VS Code and DSH advanced fields without dropping supported values', () => {
  const result = normalizeMcpImport({
    servers: {
      advanced: {
        type: 'stdio',
        command: 'node',
        args: ['server.js'],
        env: { COUNT: 2, EMPTY: null },
        cwd: '/tmp/server',
        toolCallTimeoutMs: 120000,
        failOnStartupError: true,
        reconnect: { enabled: false, initialDelayMs: 1000, maxDelayMs: 4000, maxAttempts: 3, jitter: true },
        description: 'client-only metadata',
        disabled: true,
      },
    },
  })

  assert.deepEqual(result.servers[0], {
    name: 'advanced',
    transport: 'stdio',
    command: 'node',
    args: ['server.js'],
    env: { COUNT: '2', EMPTY: '' },
    cwd: '/tmp/server',
    toolCallTimeoutMs: 120000,
    failOnStartupError: true,
    reconnect: { enabled: false, initialDelayMs: 1000, maxDelayMs: 4000, maxAttempts: 3 },
    disabled: true,
  })
  assert.ok(result.warnings.some((warning) => warning.includes('EMPTY')))
  assert.ok(result.warnings.some((warning) => warning.includes('description')))
  assert.ok(result.warnings.some((warning) => warning.includes('reconnect.jitter')))
})

test('rejects transports and fields DSH cannot represent', () => {
  assert.throws(
    () => normalizeMcpImport({ mcpServers: { legacy: { type: 'sse', url: 'https://example.test/sse' } } }),
    /sse.*不受/i,
  )
  assert.throws(
    () => normalizeMcpImport({ mcpServers: { broken: { command: 'node', envFile: '.env' } } }),
    /envFile.*不支持/i,
  )
  assert.throws(
    () => normalizeMcpImport({ inputs: [{ id: 'token' }], servers: { remote: { type: 'http', url: 'https://example.test/mcp', headers: { Authorization: 'Bearer ${input:token}' } } } }),
    /inputs.*不支持/i,
  )
  assert.throws(
    () => normalizeMcpImport({ mcpServers: { local: { command: 'node', cwd: '${workspaceFolder}' } } }),
    /workspaceFolder.*不支持/i,
  )
  for (const url of ['http://', 'https:// ', 'https://?token=x', 'ftp://example.test/mcp']) {
    assert.throws(
      () => normalizeMcpImport({ mcpServers: { remote: { type: 'http', url } } }),
      /HTTP.*URL|http\(s\)/i,
    )
  }
  assert.throws(
    () => normalizeMcpImport({ mcpServers: {}, servers: {} }),
    /同时包含.*mcpServers.*servers/i,
  )
})

test('preserves unrelated patch entries and JS expressions during managed replacement', () => {
  const original = `# keep this comment\n- insert:\n    - id: other-plugin\n      name: other-plugin\n- insert:\n    - id: mcp-old\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        transport: stdio\n        serverName: old\n        command: node\n        env:\n          TOKEN: !!js process.env.OLD_TOKEN\n`
  const parsed = readManagedMcpServers(original)
  assert.equal(parsed.entryIds.old, 'mcp-old')
  assert.deepEqual(parsed.servers, [{
    name: 'old',
    transport: 'stdio',
    command: 'node',
    env: { TOKEN: '!!js process.env.OLD_TOKEN' },
  }])

  const replaced = updateManagedMcpPatch(original, [{
    name: 'new',
    transport: 'streamable-http',
    url: 'https://example.test/mcp',
    headers: { Authorization: 'Bearer token' },
  }], { replace: true })
  assert.match(replaced, /# keep this comment/)
  assert.match(replaced, /id: other-plugin/)
  assert.doesNotMatch(replaced, /serverName: old/)
  assert.match(replaced, /serverName: new/)
})

test('toggles disabled in place without dropping comments or future fields', () => {
  const original = `- insert:\n    - id: mcp-one\n      name: '@deepseek-ai/dsh-mcp-client'\n      # keep managed comment\n      futureOption: keep-me\n      config:\n        transport: stdio\n        serverName: one\n        command: node\n`
  const disabled = setManagedMcpDisabled(original, 'one', true)
  assert.match(disabled, /# keep managed comment/)
  assert.match(disabled, /futureOption: keep-me/)
  assert.match(disabled, /disabled: true/)
  const enabled = setManagedMcpDisabled(disabled, 'one', false)
  assert.doesNotMatch(enabled, /disabled: true/)
  assert.match(enabled, /futureOption: keep-me/)
})

test('preserves entry identity, comments, and future fields when updating one managed MCP', () => {
  const original = `- insert:\n    - id: custom-one\n      name: '@deepseek-ai/dsh-mcp-client'\n      # keep managed comment\n      futureOption: keep-me\n      config:\n        transport: stdio\n        serverName: one\n        command: node\n        futureConfig: keep-config\n`

  const next = updateManagedMcpPatch(original, [{
    name: 'one',
    transport: 'streamable-http',
    url: 'https://example.test/mcp',
  }])

  assert.match(next, /id: custom-one/)
  assert.match(next, /# keep managed comment/)
  assert.match(next, /futureOption: keep-me/)
  assert.match(next, /futureConfig: keep-config/)
  assert.match(next, /transport: streamable-http/)
  assert.match(next, /url: https:\/\/example\.test\/mcp/)
  assert.doesNotMatch(next, /command: node/)
})

test('rejects duplicate managed server names in one profile patch', () => {
  const duplicate = `- insert:\n    - id: mcp-one-a\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        transport: stdio\n        serverName: one\n        command: node\n    - id: mcp-one-b\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        transport: stdio\n        serverName: one\n        command: other\n`
  assert.throws(() => readManagedMcpServers(duplicate), /重复.*serverName.*one/i)
})

test('tracks prototype-shaped server names as ordinary managed entry ids', () => {
  const parsed = readManagedMcpServers(`- insert:\n    - id: mcp-__proto__\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        transport: stdio\n        serverName: __proto__\n        command: node\n`)

  assert.equal(Object.hasOwn(parsed.entryIds, '__proto__'), true)
  assert.equal(parsed.entryIds.__proto__, 'mcp-__proto__')
})

test('preserves prototype-shaped env and header keys as ordinary map entries', () => {
  const input = JSON.parse('{"mcpServers":{"local":{"command":"node","env":{"__proto__":"env-value"}},"remote":{"type":"http","url":"https://example.test/mcp","headers":{"__proto__":"header-value"}}}}')
  const result = normalizeMcpImport(input)

  assert.equal(Object.hasOwn(result.servers[0].env, '__proto__'), true)
  assert.equal(result.servers[0].env.__proto__, 'env-value')
  assert.equal(Object.hasOwn(result.servers[1].headers, '__proto__'), true)
  assert.equal(result.servers[1].headers.__proto__, 'header-value')

  const parsed = readManagedMcpServers(`- insert:\n    - id: mcp-local\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        transport: stdio\n        serverName: local\n        command: node\n        env:\n          __proto__: env-value\n`)
  assert.equal(Object.hasOwn(parsed.servers[0].env, '__proto__'), true)
})

test('accepts positive finite reconnect delays supported by DSH rc.6', () => {
  const result = normalizeMcpImport({
    mcpServers: {
      local: { command: 'node', reconnect: { initialDelayMs: 500.5, maxDelayMs: 1000.5, maxAttempts: 3 } },
    },
  })
  assert.deepEqual(result.servers[0].reconnect, { initialDelayMs: 500.5, maxDelayMs: 1000.5, maxAttempts: 3 })
})

test('rejects reconnect settings that the installed DSH MCP client rejects', () => {
  assert.throws(
    () => normalizeMcpImport({ mcpServers: { bad: { command: 'node', reconnect: { initialDelayMs: 5000, maxDelayMs: 1000 } } } }),
    /initialDelayMs.*maxDelayMs/i,
  )
  assert.throws(
    () => normalizeMcpImport({ mcpServers: { bad: { command: 'node', reconnect: { initialDelayMs: 2147483648 } } } }),
    /2147483647/,
  )
})

test('generates a unique loader entry id when another plugin already owns the default id', () => {
  const original = `- insert:\n    - id: mcp-new\n      name: other-plugin\n`
  const next = updateManagedMcpPatch(original, [{ name: 'new', transport: 'stdio', command: 'node' }])
  assert.equal((next.match(/id: mcp-new(?:\n|-2\n)/g) || []).length, 2)
  assert.match(next, /id: mcp-new-2/)
  assert.match(next, /serverName: new/)
})

test('removes selected managed MCP entries without touching other managed entries', () => {
  const original = `- insert:\n    - id: mcp-one\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        transport: stdio\n        serverName: one\n        command: node\n    - id: mcp-two\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        transport: stdio\n        serverName: two\n        command: node\n`

  const next = updateManagedMcpPatch(original, [], { removeNames: ['one'] })
  assert.doesNotMatch(next, /serverName: one/)
  assert.match(next, /serverName: two/)
})
