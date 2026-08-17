import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

async function createProfileFixture(content, extraEntries = []) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-mcp-host-'))
  const rootConfig = join(root, 'cordis.yml')
  const patchPath = join(root, 'cordis.patch.yml')
  await writeFile(rootConfig, '[]\n')
  await writeFile(patchPath, content)
  const entries = [{ options: { id: 'include', name: 'cordis:include', config: { path: pathToFileURL(rootConfig).href } } }, ...extraEntries]
  return {
    root,
    rootConfig,
    patchPath,
    entries,
    ctx: {
      loader: { entries: () => entries },
      tools: { schemas: () => [] },
      get: () => undefined,
    },
    async cleanup() {
      await rm(root, { recursive: true, force: true })
    },
  }
}
test('profile mutations use host-owned storage outside the session workspace', async () => {
  const { McpManagerGateway } = await import('../lib/index.js')
  const fixture = await createProfileFixture('[]\n')
  const sandboxedFs = {
    resolve: async (path) => ({ targetKey: path, displayPath: path }),
    stat: async () => ({ type: 'file', version: 'v1' }),
    readText: async () => await readFile(fixture.patchPath, 'utf8'),
    writeText: async () => { throw new Error('file access denied under workspace-write mode') },
  }
  const ctx = { ...fixture.ctx, get(name) { assert.equal(name, 'fs'); return sandboxedFs } }

  try {
    await McpManagerGateway.prototype.add.call({ ctx }, { name: 'demo', transport: 'stdio', command: 'node' })
    assert.match(await readFile(fixture.patchPath, 'utf8'), /serverName: demo/)
  } finally {
    await fixture.cleanup()
  }
})

test('host entry imports with declared runtime dependencies', async () => {
  const host = await import('../lib/index.js')
  assert.equal(typeof host.default, 'function')
  assert.equal(host.default, host.McpManagerGateway)
})

test('Remote projections redact secrets and preview omits normalized server configs', async () => {
  const { McpManagerGateway } = await import('../lib/index.js')
  const secret = 'super-secret-token'
  const content = `- insert:\n    - id: mcp-remote\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        serverName: remote\n        transport: streamable-http\n        url: https://example.test/mcp?token=${secret}\n        headers:\n          Authorization: Bearer ${secret}\n          X-From-Env: !!js process.env.SAFE_TOKEN\n          Bypass: !!js '"Bearer ${secret}" + process.env.NOOP'\n    - id: mcp-local\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        serverName: local\n        transport: stdio\n        command: node\n        args: [--token, ${secret}, -H, 'Authorization: Bearer ${secret}', --header, 'X-API-Key: ${secret}', 'https://example.test/mcp?token=${secret}']\n        env:\n          API_KEY: ${secret}\n`
  const remote = { options: { id: 'mcp-remote', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'remote', transport: 'streamable-http', url: `https://example.test/mcp?token=${secret}`, headers: { Authorization: `Bearer ${secret}`, 'X-From-Env': '!!js process.env.SAFE_TOKEN', Bypass: `!!js "Bearer ${secret}" + process.env.NOOP` } } }, disabled: false, fiber: null }
  const local = { options: { id: 'mcp-local', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'local', transport: 'stdio', command: 'node', args: ['--token', secret, '-H', `Authorization: Bearer ${secret}`, '--header', `X-API-Key: ${secret}`, `https://example.test/mcp?token=${secret}`], env: { API_KEY: secret } } }, disabled: false, fiber: null }
  const fixture = await createProfileFixture(content, [remote, local])

  try {
    const result = await McpManagerGateway.prototype.list.call({ ctx: fixture.ctx })
    const wire = JSON.stringify(result)
    assert.doesNotMatch(wire, new RegExp(secret))
    assert.equal(result.servers.find((server) => server.serverName === 'remote').headers.Authorization, '__DSH_MCP_REDACTED__')
    assert.equal(result.servers.find((server) => server.serverName === 'remote').headers['X-From-Env'], '!!js process.env.SAFE_TOKEN')
    assert.equal(result.servers.find((server) => server.serverName === 'remote').headers.Bypass, '__DSH_MCP_REDACTED__')
    assert.equal(result.servers.find((server) => server.serverName === 'local').env.API_KEY, '__DSH_MCP_REDACTED__')
    assert.deepEqual(result.servers.find((server) => server.serverName === 'local').args, ['__DSH_MCP_REDACTED__'])
    assert.doesNotMatch(JSON.stringify(await McpManagerGateway.prototype.status.call({ ctx: fixture.ctx }, 'remote')), new RegExp(secret))

    const preview = await McpManagerGateway.prototype.previewImport.call({ ctx: fixture.ctx }, {
      mode: 'merge',
      json: { mcpServers: { imported: { type: 'http', url: 'https://example.test/mcp', headers: { Authorization: `Bearer ${secret}` } } } },
    })
    assert.equal(Object.hasOwn(preview, 'servers'), false)
    assert.doesNotMatch(JSON.stringify(preview), new RegExp(secret))
  } finally {
    await fixture.cleanup()
  }
})

test('update preserves values represented by the Remote redaction sentinel', async () => {
  const { McpManagerGateway } = await import('../lib/index.js')
  const secret = 'super-secret-token'
  const content = `- insert:\n    - id: mcp-remote\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        serverName: remote\n        transport: streamable-http\n        url: https://example.test/mcp?token=${secret}\n        headers:\n          Authorization: Bearer ${secret}\n`
  const entry = { options: { id: 'mcp-remote', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'remote', transport: 'streamable-http', url: `https://example.test/mcp?token=${secret}`, headers: { Authorization: `Bearer ${secret}` } } }, disabled: false, fiber: null }
  const fixture = await createProfileFixture(content, [entry])

  try {
    const projected = (await McpManagerGateway.prototype.list.call({ ctx: fixture.ctx })).servers[0]
    await McpManagerGateway.prototype.update.call({ ctx: fixture.ctx }, {
      name: 'remote',
      transport: 'http',
      url: projected.url,
      headers: projected.headers,
    })
    const persisted = await readFile(fixture.patchPath, 'utf8')
    assert.match(persisted, new RegExp(secret))
    assert.doesNotMatch(persisted, /__DSH_MCP_REDACTED__/)
  } finally {
    await fixture.cleanup()
  }
})

test('sensitive args preserve as one opaque value and reject mixed edits', async () => {
  const { McpManagerGateway } = await import('../lib/index.js')
  const secret = 'super-secret-token'
  const content = `- insert:\n    - id: mcp-local\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        serverName: local\n        transport: stdio\n        command: node\n        args: [--token, ${secret}, --verbose]\n`
  const entry = { options: { id: 'mcp-local', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'local', transport: 'stdio', command: 'node', args: ['--token', secret, '--verbose'] } }, disabled: false, fiber: null }
  const fixture = await createProfileFixture(content, [entry])

  try {
    const projected = (await McpManagerGateway.prototype.list.call({ ctx: fixture.ctx })).servers[0]
    assert.deepEqual(projected.args, ['__DSH_MCP_REDACTED__'])
    await McpManagerGateway.prototype.update.call({ ctx: fixture.ctx }, { name: 'local', transport: 'stdio', command: 'node', args: projected.args })
    assert.match(await readFile(fixture.patchPath, 'utf8'), new RegExp(secret))
    await assert.rejects(
      McpManagerGateway.prototype.update.call({ ctx: fixture.ctx }, { name: 'local', transport: 'stdio', command: 'node', args: ['--debug', '__DSH_MCP_REDACTED__'] }),
      /敏感参数.*完整重填|保留原值标记.*混合/,
    )
  } finally {
    await fixture.cleanup()
  }
})

test('concurrent profile mutations are serialized without losing either update', async () => {
  const { McpManagerGateway } = await import('../lib/index.js')
  const { readManagedMcpServers } = await import('../lib/mcp-config.js')
  const fixture = await createProfileFixture('[]\n')

  try {
    await Promise.all([
      McpManagerGateway.prototype.add.call({ ctx: fixture.ctx }, { name: 'alpha', transport: 'stdio', command: 'node' }),
      McpManagerGateway.prototype.add.call({ ctx: fixture.ctx }, { name: 'beta', transport: 'stdio', command: 'node' }),
    ])
    const content = await readFile(fixture.patchPath, 'utf8')
    assert.deepEqual(readManagedMcpServers(content).servers.map((server) => server.name), ['alpha', 'beta'])
  } finally {
    await fixture.cleanup()
  }
})

test('guarded profile writes refuse to overwrite an external edit made after the read', async () => {
  const { McpManagerGateway } = await import('../lib/index.js')
  const external = `- insert:\n    - id: external\n      name: external-plugin\n`
  const fixture = await createProfileFixture('[]\n')
  const entries = fixture.entries
  let calls = 0
  fixture.ctx.loader.entries = () => {
    calls += 1
    if (calls === 3) writeFileSync(fixture.patchPath, external)
    return entries
  }

  try {
    await assert.rejects(
      McpManagerGateway.prototype.add.call({ ctx: fixture.ctx }, { name: 'demo', transport: 'stdio', command: 'node' }),
      /FS_STALE_VERSION/,
    )
    assert.equal(await readFile(fixture.patchPath, 'utf8'), external)
  } finally {
    await fixture.cleanup()
  }
})

test('enable repairs a disabled patch even when the live entry is already enabled', async () => {
  const { McpManagerGateway } = await import('../lib/index.js')
  const content = `- insert:\n    - id: mcp-one\n      name: '@deepseek-ai/dsh-mcp-client'\n      disabled: true\n      config:\n        serverName: one\n        transport: stdio\n        command: node\n`
  let updates = 0
  const entry = {
    options: { id: 'mcp-one', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'one', transport: 'stdio', command: 'node' } },
    disabled: false,
    fiber: null,
    update: async () => { updates += 1 },
  }
  const fixture = await createProfileFixture(content, [entry])

  try {
    await McpManagerGateway.prototype.setDisabled.call({ ctx: fixture.ctx }, 'one', false)
    assert.doesNotMatch(await readFile(fixture.patchPath, 'utf8'), /disabled: true/)
    assert.equal(updates, 0)
  } finally {
    await fixture.cleanup()
  }
})

test('profile writes target the official root include entry rather than the first nested include', async () => {
  const { McpManagerGateway } = await import('../lib/index.js')
  const fixture = await createProfileFixture('[]\n')
  const nestedRoot = await mkdtemp(join(fixture.root, 'nested-'))
  const nestedConfig = join(nestedRoot, 'cordis.yml')
  const nestedPatch = join(nestedRoot, 'cordis.patch.yml')
  await writeFile(nestedConfig, '[]\n')
  await writeFile(nestedPatch, '[]\n')
  fixture.entries.unshift({ options: { id: 'nested', name: 'cordis:include', config: { path: pathToFileURL(nestedConfig).href } } })

  try {
    await McpManagerGateway.prototype.add.call({ ctx: fixture.ctx }, { name: 'demo', transport: 'stdio', command: 'node' })
    assert.match(await readFile(fixture.patchPath, 'utf8'), /serverName: demo/)
    assert.equal(await readFile(nestedPatch, 'utf8'), '[]\n')
  } finally {
    await fixture.cleanup()
  }
})

test('failed live disable restores the previous persisted patch', async () => {
  const { McpManagerGateway } = await import('../lib/index.js')
  const content = `- insert:\n    - id: mcp-one\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        serverName: one\n        transport: stdio\n        command: node\n`
  const entry = {
    options: { id: 'mcp-one', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'one', transport: 'stdio', command: 'node' } },
    disabled: false,
    fiber: null,
    update: async () => { throw new Error('live update failed') },
  }
  const fixture = await createProfileFixture(content, [entry])

  try {
    await assert.rejects(
      McpManagerGateway.prototype.setDisabled.call({ ctx: fixture.ctx }, 'one', true),
      /live update failed/,
    )
    assert.equal(await readFile(fixture.patchPath, 'utf8'), content)
  } finally {
    await fixture.cleanup()
  }
})

test('profile update persists edited MCP fields through host storage', async () => {
  const { McpManagerGateway } = await import('../lib/index.js')
  const content = `- insert:\n    - id: mcp-demo\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        serverName: demo\n        transport: stdio\n        command: node\n`
  const entry = {
    options: { id: 'mcp-demo', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'demo', transport: 'stdio', command: 'node' } },
    disabled: false,
    fiber: null,
  }
  const fixture = await createProfileFixture(content, [entry])

  try {
    await McpManagerGateway.prototype.update.call({ ctx: fixture.ctx }, { name: 'demo', transport: 'http', url: 'https://example.test/mcp' })
    const next = await readFile(fixture.patchPath, 'utf8')
    assert.match(next, /transport: streamable-http/)
    assert.match(next, /url: https:\/\/example\.test\/mcp/)
    assert.doesNotMatch(next, /command: node/)
  } finally {
    await fixture.cleanup()
  }
})

test('profile removal persists through host storage', async () => {
  const { McpManagerGateway } = await import('../lib/index.js')
  const content = `- insert:\n    - id: mcp-demo\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        serverName: demo\n        transport: stdio\n        command: node\n`
  const entry = {
    options: { id: 'mcp-demo', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'demo', transport: 'stdio', command: 'node' } },
    disabled: false,
    fiber: null,
  }
  const fixture = await createProfileFixture(content, [entry])

  try {
    await McpManagerGateway.prototype.removeServer.call({ ctx: fixture.ctx }, 'demo')
    assert.doesNotMatch(await readFile(fixture.patchPath, 'utf8'), /serverName: demo/)
  } finally {
    await fixture.cleanup()
  }
})

test('merge import updates named MCPs and preserves other managed entries', async () => {
  const { McpManagerGateway } = await import('../lib/index.js')
  const content = `- insert:\n    - id: mcp-keep\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        serverName: keep\n        transport: stdio\n        command: node\n    - id: mcp-update\n      name: '@deepseek-ai/dsh-mcp-client'\n      disabled: true\n      config:\n        serverName: update\n        transport: stdio\n        command: old\n`
  const keep = { options: { id: 'mcp-keep', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'keep', transport: 'stdio', command: 'node' } }, disabled: false, fiber: null }
  const update = { options: { id: 'mcp-update', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'update', transport: 'stdio', command: 'old' } }, disabled: true, fiber: null }
  const fixture = await createProfileFixture(content, [keep, update])

  try {
    await McpManagerGateway.prototype.importJson.call({ ctx: fixture.ctx }, {
      mode: 'merge',
      json: { mcpServers: {
        update: { type: 'http', url: 'https://example.test/mcp', directTools: true },
        added: { command: 'node', directTools: false },
      } },
    })
    const parsed = (await import('../lib/mcp-config.js')).readManagedMcpServers(await readFile(fixture.patchPath, 'utf8'))
    assert.deepEqual(parsed.servers.map((server) => server.name), ['keep', 'update', 'added'])
    assert.equal(parsed.servers.find((server) => server.name === 'update').disabled, undefined)
    assert.equal(parsed.servers.find((server) => server.name === 'added').disabled, true)
  } finally {
    await fixture.cleanup()
  }
})

test('replace import removes absent MCPs and applies directTools enablement mapping', async () => {
  const { McpManagerGateway } = await import('../lib/index.js')
  const content = `- insert:\n    - id: mcp-remove\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        serverName: remove\n        transport: stdio\n        command: node\n    - id: mcp-keep\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        serverName: keep\n        transport: stdio\n        command: node\n`
  const remove = { options: { id: 'mcp-remove', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'remove', transport: 'stdio', command: 'node' } }, disabled: false, fiber: null }
  const keep = { options: { id: 'mcp-keep', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'keep', transport: 'stdio', command: 'node' } }, disabled: false, fiber: null }
  const fixture = await createProfileFixture(content, [remove, keep])

  try {
    await McpManagerGateway.prototype.importJson.call({ ctx: fixture.ctx }, {
      mode: 'replace',
      json: { mcpServers: { keep: { command: 'updated', directTools: false } } },
    })
    const parsed = (await import('../lib/mcp-config.js')).readManagedMcpServers(await readFile(fixture.patchPath, 'utf8'))
    assert.deepEqual(parsed.servers.map((server) => server.name), ['keep'])
    assert.equal(parsed.servers[0].command, 'updated')
    assert.equal(parsed.servers[0].disabled, true)
  } finally {
    await fixture.cleanup()
  }
})

test('duplicate cross-layer server names are exposed once as a read-only conflict', async () => {
  const { McpManagerGateway } = await import('../lib/index.js')
  const patch = `- insert:\n    - id: mcp-shared-profile\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        serverName: shared\n        transport: stdio\n        command: node\n`
  const external = { options: { id: 'mcp-shared-external', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'shared', transport: 'stdio', command: 'external' } }, disabled: false, fiber: null }
  const profile = { options: { id: 'mcp-shared-profile', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'shared', transport: 'stdio', command: 'node' } }, disabled: false, fiber: null }
  const fixture = await createProfileFixture(patch, [external, profile])

  try {
    const result = await McpManagerGateway.prototype.list.call({ ctx: fixture.ctx })
    assert.equal(result.servers.length, 1)
    assert.equal(result.servers[0].serverName, 'shared')
    assert.equal(result.servers[0].managed, false)
    assert.equal(result.servers[0].conflict, true)
    const gateway = { ctx: fixture.ctx }
    await assert.rejects(
      McpManagerGateway.prototype.update.call(gateway, { name: 'shared', transport: 'stdio', command: 'node' }),
      /同名冲突|不能编辑/,
    )
    await assert.rejects(
      McpManagerGateway.prototype.removeServer.call(gateway, 'shared'),
      /同名冲突|不能移除/,
    )
  } finally {
    await fixture.cleanup()
  }
})
