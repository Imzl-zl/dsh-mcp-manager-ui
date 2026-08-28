import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { installAgentRuntime } from '../lib/index.js'

async function createRuntimeFixture() {
  const wsRoot = await mkdtemp(join(tmpdir(), 'dsh-mcp-rt-'))
  await mkdir(join(wsRoot, '.dsh'), { recursive: true })
  await writeFile(join(wsRoot, '.dsh', 'mcp.json'), JSON.stringify({
    mcpServers: {
      db: { command: 'psql', env: { KEY: '${KEY}' } },
    },
    exclude: ['github'],
  }, null, 2))
  const restrictCalls = []
  const mounts = []
  const effects = []
  const handlers = {}
  const agentCtx = {
    agent: { id: 'a1', session: { header: { cwd: wsRoot } } },
    plugin(plugin, config) {
      mounts.push([plugin, config])
      const fiber = Promise.resolve()
      fiber.catch = () => fiber
      return fiber
    },
    tools: {
      restrict(filter) { restrictCalls.push(filter); return () => {}; },
    },
  }
  agentCtx.agent.ctx = agentCtx
  const agentsService = {
    create(options) { return { setup: options.setup }; },
    resume(options) { return { setup: options.setup }; },
  }
  const ctx = {
    loader: { entries: () => [
      { options: { name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'github' } } },
      { options: { name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'exa' } } },
    ] },
    tools: { schemas: () => [{ name: 'mcp__github__a' }, { name: 'mcp__exa__b' }] },
    get(name) { if (name === 'agents') return agentsService; return undefined; },
    on(event, handler) { handlers[event] = handler; return () => {}; },
    effect(fn) { effects.push(fn); return () => {}; },
    logger: { warn: () => {}, error: () => {}, info: () => {} },
  }
  return { wsRoot, agentCtx, agentsService, ctx, restrictCalls, mounts, effects, handlers, cleanup: () => rm(wsRoot, { recursive: true, force: true }) }
}

test('agent runtime decorator composes create/resume and applies workspace scope', async () => {
  const { installAgentRuntime: install } = await import('../lib/index.js')
  const fixture = await createRuntimeFixture()
  try {
    install(fixture.ctx)
    const created = await fixture.agentsService.create({ setup: undefined })
    const resumed = await fixture.agentsService.resume({ setup: undefined })

    // 包装后 setup 是 compose 版本；调用它模拟真实 agent setup。
    await created.setup(fixture.agentCtx)
    await resumed.setup(fixture.agentCtx)

    // 项目配置中的服务器被尝试挂载（本测试环境无 @deepseek-ai/dsh-mcp-client，挂载被容错跳过）。
    assert.ok(fixture.mounts.length === 0 || fixture.mounts[0][1].serverName === 'db')
    // exclude['github'] 展开为当前全局工具名 mcp__github__a 并应用 restrict。
    assert.ok(fixture.restrictCalls.length >= 1)
    const deny = fixture.restrictCalls.at(-1).deny
    assert.deepEqual(deny, ['mcp__github__a'])
    // agent 创建不被 mcp 模块加载失败阻断。
    assert.equal(typeof created.setup, 'function')
  } finally {
    await fixture.cleanup()
  }
})

test('agent runtime skips disabled servers and handles missing config', async () => {
  const { installAgentRuntime: install } = await import('../lib/index.js')
  const fixture = await createRuntimeFixture()
  const empty = await mkdtemp(join(tmpdir(), 'dsh-mcp-rt-'))
  try {
    await writeFile(join(fixture.wsRoot, '.dsh', 'mcp.json'), JSON.stringify({
      mcpServers: { off: { command: 'node', disabled: true } },
    }, null, 2))
    install(fixture.ctx)
    const created = await fixture.agentsService.create({ setup: undefined })
    await created.setup(fixture.agentCtx)
    // disabled 服务器不挂载。
    assert.equal(fixture.mounts.length, 0)

    // 无 .dsh/mcp.json 的目录：setup 正常返回，无 restrict、无挂载。
    const plainCtx = { ...fixture.ctx, tools: { schemas: () => [] } }
    const agents = {
      create(options) { return { setup: options.setup }; },
      resume(options) { return { setup: options.setup }; },
    }
    const plainCtx2 = { ...plainCtx, get(name) { if (name === 'agents') return agents; return undefined; } }
    install(plainCtx2)
    const plainAgent = { agent: { session: { header: { cwd: empty } } }, plugin: () => { throw new Error('must not mount') }, tools: { restrict: () => { throw new Error('must not restrict') } } }
    const created2 = await agents.create({ setup: undefined })
    await created2.setup(plainAgent)
    assert.equal(fixture.mounts.length, 0)
  } finally {
    await fixture.cleanup()
    await rm(empty, { recursive: true, force: true })
  }
})

test('tools/change reconciles workspace restrict when global tools change', async () => {
  const { installAgentRuntime: install } = await import('../lib/index.js')
  const fixture = await createRuntimeFixture()
  try {
    install(fixture.ctx)
    const created = await fixture.agentsService.create({ setup: undefined })
    await created.setup(fixture.agentCtx)
    const before = fixture.restrictCalls.length

    // 全局工具集变化（新增 github 工具），reconcile 重新应用 restrict（key 变化）。
    fixture.ctx.tools.schemas = () => [{ name: 'mcp__github__a' }, { name: 'mcp__github__b' }, { name: 'mcp__exa__c' }]
    await fixture.handlers['tools/change']()
    assert.ok(fixture.restrictCalls.length > before)
    assert.deepEqual(fixture.restrictCalls.at(-1).deny, ['mcp__github__a', 'mcp__github__b'])

    // 无变化的 change 不重复 restrict（restrictKey 相同）。
    const stable = fixture.restrictCalls.length
    await fixture.handlers['tools/change']()
    assert.equal(fixture.restrictCalls.length, stable)
  } finally {
    await fixture.cleanup()
  }
})

test('exclude owner disambiguation never denies ambiguous names (double underscore safe)', async () => {
  const { installAgentRuntime: install } = await import('../lib/index.js')
  const fixture = await createRuntimeFixture()
  try {
    // 全局同时存在 my 与 my__server：mcp__my__server__x 的归属在两者间歧义
    // （可能是 my 的 raw tool server__x，也可能是 my__server 的 x）。
    fixture.ctx.loader = { entries: () => [
      { options: { name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'my' } } },
      { options: { name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'my__server' } } },
    ] }
    fixture.ctx.tools.schemas = () => [{ name: 'mcp__my__server__x' }]
    await writeFile(join(fixture.wsRoot, '.dsh', 'mcp.json'), JSON.stringify({
      mcpServers: { db: { command: 'psql' } },
      exclude: ['my__server'],
    }, null, 2))
    install(fixture.ctx)
    const created = await fixture.agentsService.create({ setup: undefined })
    await created.setup(fixture.agentCtx)
    // 旧逻辑会把 mcp__my__server__x 计入 deny（误伤 my）；新逻辑归属歧义时保守不拒。
    assert.equal(fixture.restrictCalls.length, 0)
  } finally {
    await fixture.cleanup()
  }
})

test('mount failures are recorded for observability instead of silently dropped', async () => {
  const { installAgentRuntime: install, workspaceMountErrorsView } = await import('../lib/index.js')
  const fixture = await createRuntimeFixture()
  try {
    await writeFile(join(fixture.wsRoot, '.dsh', 'mcp.json'), JSON.stringify({
      mcpServers: { db: { command: 'psql', failOnStartupError: true } },
      exclude: [],
    }, null, 2))
    install(fixture.ctx)
    const created = await fixture.agentsService.create({ setup: undefined })
    // setup 不被挂载失败阻断（compose 不 drive），失败被记录而非静默吞掉。
    await created.setup(fixture.agentCtx)
    const records = workspaceMountErrorsView(fixture.wsRoot)
    assert.equal(records.length, 1)
    assert.equal(records[0].serverName, 'db')
    assert.ok(records[0].error.length > 0)
  } finally {
    await fixture.cleanup()
  }
})

test('agent runtime cleanup restores original methods', async () => {
  const { installAgentRuntime: install } = await import('../lib/index.js')
  const fixture = await createRuntimeFixture()
  try {
    const originalCreate = fixture.agentsService.create
    const cleanup = install(fixture.ctx)
    assert.notEqual(fixture.agentsService.create, originalCreate)
    cleanup()
    assert.equal(fixture.agentsService.create, originalCreate)
    // 二次清理幂等。
    cleanup()
    assert.equal(fixture.agentsService.create, originalCreate)
  } finally {
    await fixture.cleanup()
  }
})