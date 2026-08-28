import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

async function createHostFixture(patchContent = '[]\n', registryWorkspaces = [], extraEntries = []) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-mcp-ws-'))
  const rootConfig = join(root, 'cordis.yml')
  const patchPath = join(root, 'cordis.patch.yml')
  await writeFile(rootConfig, '[]\n')
  await writeFile(patchPath, patchContent)
  const wsRoot = join(root, 'proj-a')
  await mkdir(wsRoot, { recursive: true })
  const entries = [{ options: { id: 'include', name: 'cordis:include', config: { path: pathToFileURL(rootConfig).href } } }, ...extraEntries]
  const registry = {
    list: () => registryWorkspaces.map((ws) => ({ ...ws, path: ws.path || wsRoot })),
  }
  const ctx = {
    loader: { entries: () => entries },
    tools: { schemas: () => [] },
    logger: { warn: () => {}, error: () => {}, info: () => {} },
    get(name) {
      if (name === 'workspaceRegistry') return registry
      return undefined
    },
  }
  return {
    root,
    wsRoot,
    patchPath,
    ctx,
    async cleanup() {
      await rm(root, { recursive: true, force: true })
    },
  }
}

const configPath = (wsRoot) => join(wsRoot, '.dsh', 'mcp.json')

test('listWorkspaces enumerates registered workspaces with server counts', async () => {
  const { McpManagerGateway } = await import('../lib/index.js')
  const fixture = await createHostFixture('[]\n', [{ title: 'proj-a' }])
  try {
    await mkdir(join(fixture.wsRoot, '.dsh'), { recursive: true })
    await writeFile(configPath(fixture.wsRoot), JSON.stringify({ mcpServers: { demo: { command: 'node' } }, exclude: ['github'] }))
    const result = await McpManagerGateway.prototype.listWorkspaces.call({ ctx: fixture.ctx })
    assert.equal(result.workspaces.length, 1)
    assert.equal(result.workspaces[0].name, 'proj-a')
    assert.equal(result.workspaces[0].serverCount, 1)
    assert.deepEqual(result.workspaces[0].excluded, ['github'])
    assert.equal(result.workspaces[0].error, '')
    assert.ok(result.revision)
  } finally {
    await fixture.cleanup()
  }
})

test('addWorkspaceServer writes the project file and rejects duplicates and global collisions', async () => {
  const { McpManagerGateway } = await import('../lib/index.js')
  const fixture = await createHostFixture('[]\n', [{ title: 'proj-a' }])
  try {
    const gateway = { ctx: fixture.ctx }
    const added = await McpManagerGateway.prototype.addWorkspaceServer.call(gateway, {
      wsPath: fixture.wsRoot,
      spec: { name: 'demo', transport: 'stdio', command: 'node', env: { KEY: '${KEY}' } },
    })
    assert.match(added.note, /demo/)
    const parsed = JSON.parse(await readFile(configPath(fixture.wsRoot), 'utf8'))
    assert.deepEqual(parsed, {
      mcpServers: { demo: { command: 'node', env: { KEY: '${KEY}' } } },
    })

    await assert.rejects(
      McpManagerGateway.prototype.addWorkspaceServer.call(gateway, {
        wsPath: fixture.wsRoot,
        spec: { name: 'demo', transport: 'stdio', command: 'node' },
      }),
      /该项目已存在/,
    )

    // 全局 patch 存在同名 → 项目层拒绝
    const globalFixture = await createHostFixture('[]\n', [{ title: 'proj-a' }])
    try {
      await McpManagerGateway.prototype.add.call({ ctx: globalFixture.ctx }, { name: 'global-x', transport: 'stdio', command: 'node' })
      await assert.rejects(
        McpManagerGateway.prototype.addWorkspaceServer.call({ ctx: globalFixture.ctx }, {
          wsPath: globalFixture.wsRoot,
          spec: { name: 'global-x', transport: 'stdio', command: 'node' },
        }),
        /已被全局占用/,
      )
    } finally {
      await globalFixture.cleanup()
    }
  } finally {
    await fixture.cleanup()
  }
})

test('getWorkspaceView returns project servers plus global servers with excluded marks', async () => {
  const { McpManagerGateway } = await import('../lib/index.js')
  const githubEntry = {
    options: { id: 'mcp-github', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'github', transport: 'streamable-http', url: 'https://api.github.com/mcp' } },
    disabled: false,
    fiber: null,
  }
  const exaEntry = {
    options: { id: 'mcp-exa', name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'exa', transport: 'streamable-http', url: 'https://mcp.exa.ai/mcp' } },
    disabled: false,
    fiber: null,
  }
  const fixture = await createHostFixture('[]\n', [{ title: 'proj-a' }], [githubEntry, exaEntry])
  try {
    await mkdir(join(fixture.wsRoot, '.dsh'), { recursive: true })
    await writeFile(configPath(fixture.wsRoot), JSON.stringify({
      mcpServers: { db: { command: 'psql', env: { SECRET: 'plaintext' } } },
      exclude: ['github'],
    }))

    const view = await McpManagerGateway.prototype.getWorkspaceView.call({ ctx: fixture.ctx }, { wsPath: fixture.wsRoot })
    assert.equal(view.error, '')
    assert.deepEqual(view.mountErrors, [])
    assert.equal(view.servers.length, 1)
    assert.equal(view.servers[0].serverName, 'db')
    assert.equal(view.servers[0].scope, 'workspace')
    assert.equal(view.servers[0].env.SECRET, '__DSH_MCP_REDACTED__')
    assert.deepEqual(view.exclude, ['github'])
    const globalNames = view.global.map((server) => server.serverName)
    assert.deepEqual(globalNames, ['github', 'exa'])
    assert.equal(view.global.find((server) => server.serverName === 'github').excluded, true)
    assert.equal(view.global.find((server) => server.serverName === 'exa').excluded, false)
  } finally {
    await fixture.cleanup()
  }
})

test('setWorkspaceExclude toggles exclude and roundtrips', async () => {
  const { McpManagerGateway } = await import('../lib/index.js')
  const fixture = await createHostFixture('[]\n', [{ title: 'proj-a' }])
  try {
    const gateway = { ctx: fixture.ctx }
    await mkdir(join(fixture.wsRoot, '.dsh'), { recursive: true })
    await writeFile(configPath(fixture.wsRoot), JSON.stringify({ mcpServers: { db: { command: 'psql' } } }))
    await McpManagerGateway.prototype.setWorkspaceExclude.call(gateway, { wsPath: fixture.wsRoot, serverName: 'github', hidden: true })
    let parsed = JSON.parse(await readFile(configPath(fixture.wsRoot), 'utf8'))
    assert.deepEqual(parsed.exclude, ['github'])
    await McpManagerGateway.prototype.setWorkspaceExclude.call(gateway, { wsPath: fixture.wsRoot, serverName: 'exa', hidden: true })
    parsed = JSON.parse(await readFile(configPath(fixture.wsRoot), 'utf8'))
    assert.deepEqual(parsed.exclude, ['github', 'exa'])
    await McpManagerGateway.prototype.setWorkspaceExclude.call(gateway, { wsPath: fixture.wsRoot, serverName: 'github', hidden: false })
    parsed = JSON.parse(await readFile(configPath(fixture.wsRoot), 'utf8'))
    assert.deepEqual(parsed.exclude, ['exa'])
  } finally {
    await fixture.cleanup()
  }
})

test('concurrent workspace writes are serialized without losing updates', async () => {
  const { McpManagerGateway } = await import('../lib/index.js')
  const fixture = await createHostFixture('[]\n', [{ title: 'proj-a' }])
  try {
    const gateway = { ctx: fixture.ctx }
    await mkdir(join(fixture.wsRoot, '.dsh'), { recursive: true })
    // 两个并发添加基于同一份旧配置读改写：无串行化时后写者覆盖先写者，丢一条更新。
    await Promise.all([
      McpManagerGateway.prototype.addWorkspaceServer.call(gateway, { wsPath: fixture.wsRoot, spec: { name: 'alpha', transport: 'stdio', command: 'node' } }),
      McpManagerGateway.prototype.addWorkspaceServer.call(gateway, { wsPath: fixture.wsRoot, spec: { name: 'beta', transport: 'stdio', command: 'node' } }),
    ])
    const parsed = JSON.parse(await readFile(configPath(fixture.wsRoot), 'utf8'))
    assert.deepEqual(Object.keys(parsed.mcpServers).sort(), ['alpha', 'beta'])
  } finally {
    await fixture.cleanup()
  }
})

test('getWorkspaceView renders internal js expressions as file templates', async () => {
  const { McpManagerGateway } = await import('../lib/index.js')
  const fixture = await createHostFixture('[]\n', [{ title: 'proj-a' }])
  try {
    await mkdir(join(fixture.wsRoot, '.dsh'), { recursive: true })
    await writeFile(configPath(fixture.wsRoot), JSON.stringify({
      mcpServers: { hl: { command: 'npx', args: ['${TOKEN}'], env: { KEY: '${KEY}' } } },
    }))
    const view = await McpManagerGateway.prototype.getWorkspaceView.call({ ctx: fixture.ctx }, { wsPath: fixture.wsRoot })
    assert.equal(view.servers[0].command, 'npx')
    assert.equal(view.servers[0].env.KEY, '${KEY}')
    const revealed = await McpManagerGateway.prototype.revealWorkspaceServer.call({ ctx: fixture.ctx }, { wsPath: fixture.wsRoot, name: 'hl', field: 'args' })
    assert.deepEqual(revealed.value, ['${TOKEN}'])
  } finally {
    await fixture.cleanup()
  }
})

test('updateWorkspaceServer and removeWorkspaceServer mutate the project file', async () => {
  const { McpManagerGateway } = await import('../lib/index.js')
  const fixture = await createHostFixture('[]\n', [{ title: 'proj-a' }])
  try {
    const gateway = { ctx: fixture.ctx }
    await mkdir(join(fixture.wsRoot, '.dsh'), { recursive: true })
    await writeFile(configPath(fixture.wsRoot), JSON.stringify({ mcpServers: { db: { command: 'psql' } } }))
    await McpManagerGateway.prototype.updateWorkspaceServer.call(gateway, {
      wsPath: fixture.wsRoot,
      spec: { name: 'db', transport: 'stdio', command: 'psql', args: ['-U', 'admin'] },
    })
    let parsed = JSON.parse(await readFile(configPath(fixture.wsRoot), 'utf8'))
    assert.deepEqual(parsed.mcpServers.db, { command: 'psql', args: ['-U', 'admin'] })
    await McpManagerGateway.prototype.removeWorkspaceServer.call(gateway, { wsPath: fixture.wsRoot, name: 'db' })
    parsed = JSON.parse(await readFile(configPath(fixture.wsRoot), 'utf8'))
    assert.deepEqual(parsed.mcpServers, {})
    await assert.rejects(
      McpManagerGateway.prototype.removeWorkspaceServer.call(gateway, { wsPath: fixture.wsRoot, name: 'db' }),
      /该项目中没有此 MCP/,
    )
  } finally {
    await fixture.cleanup()
  }
})

test('revealWorkspaceServer returns real values from the project file', async () => {
  const { McpManagerGateway } = await import('../lib/index.js')
  const fixture = await createHostFixture('[]\n', [{ title: 'proj-a' }])
  try {
    const gateway = { ctx: fixture.ctx }
    await mkdir(join(fixture.wsRoot, '.dsh'), { recursive: true })
    await writeFile(configPath(fixture.wsRoot), JSON.stringify({ mcpServers: { db: { command: 'psql', env: { SECRET: 'topsecret' } } } }))
    const revealed = await McpManagerGateway.prototype.revealWorkspaceServer.call(gateway, { wsPath: fixture.wsRoot, name: 'db', field: 'env', key: 'SECRET' })
    assert.equal(revealed.value, 'topsecret')
    await assert.rejects(
      McpManagerGateway.prototype.revealWorkspaceServer.call(gateway, { wsPath: fixture.wsRoot, name: 'nope', field: 'env', key: 'SECRET' }),
      /该项目中没有此 MCP/,
    )
  } finally {
    await fixture.cleanup()
  }
})

test('installWorkspaceBuiltins appends only missing builtins', async () => {
  const { McpManagerGateway } = await import('../lib/index.js')
  const fixture = await createHostFixture('[]\n', [{ title: 'proj-a' }])
  try {
    const gateway = { ctx: fixture.ctx }
    await mkdir(join(fixture.wsRoot, '.dsh'), { recursive: true })
    await writeFile(configPath(fixture.wsRoot), JSON.stringify({ mcpServers: { exa: { type: 'http', url: 'https://mcp.exa.ai/mcp' } } }))
    const result = await McpManagerGateway.prototype.installWorkspaceBuiltins.call(gateway, { wsPath: fixture.wsRoot, ids: ['exa', 'tavily'] })
    assert.match(result.note, /tavily/)
    assert.match(result.note, /exa/)
    const parsed = JSON.parse(await readFile(configPath(fixture.wsRoot), 'utf8'))
    assert.deepEqual(Object.keys(parsed.mcpServers), ['exa', 'tavily'])
  } finally {
    await fixture.cleanup()
  }
})