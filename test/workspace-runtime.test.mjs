import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { installAgentRuntime } from '../lib/workspace-runtime.js'

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
    loader: {
      entries: () => [
        { options: { name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'github' } } },
        { options: { name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'exa' } } },
      ],
      // 宿主按 profile 基点解析插件模块；这里给一个可挂载的替身，让成功路径真正被覆盖。
      import: async (name) => {
        assert.equal(name, '@deepseek-ai/dsh-mcp-client')
        return { apply: () => {}, inject: [], name: 'mcp-client', Config: undefined }
      },
    },
    tools: { schemas: () => [{ name: 'mcp__github__a' }, { name: 'mcp__exa__b' }] },
    get(name) { if (name === 'agents') return agentsService; return undefined; },
    on(event, handler) { handlers[event] = handler; return () => {}; },
    effect(fn) { effects.push(fn); return () => {}; },
    logger: { warn: () => {}, error: () => {}, info: () => {} },
  }
  return { wsRoot, agentCtx, agentsService, ctx, restrictCalls, mounts, effects, handlers, cleanup: () => rm(wsRoot, { recursive: true, force: true }) }
}

test('agent runtime decorator composes create/resume and applies workspace scope', async () => {
  const { installAgentRuntime: install } = await import('../lib/workspace-runtime.js')
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
  const { installAgentRuntime: install } = await import('../lib/workspace-runtime.js')
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
  const { installAgentRuntime: install } = await import('../lib/workspace-runtime.js')
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
  const { installAgentRuntime: install } = await import('../lib/workspace-runtime.js')
  const fixture = await createRuntimeFixture()
  try {
    // 全局同时存在 my 与 my__server：mcp__my__server__x 的归属在两者间歧义
    // （可能是 my 的 raw tool server__x，也可能是 my__server 的 x）。
    fixture.ctx.loader = {
      entries: () => [
        { options: { name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'my' } } },
        { options: { name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'my__server' } } },
      ],
      import: async () => ({ apply: () => {}, inject: [], name: 'mcp-client', Config: undefined }),
    }
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
  const { installAgentRuntime: install, workspaceMountErrorsView } = await import('../lib/workspace-runtime.js')
  const fixture = await createRuntimeFixture()
  try {
    await writeFile(join(fixture.wsRoot, '.dsh', 'mcp.json'), JSON.stringify({
      mcpServers: { db: { command: 'psql', failOnStartupError: true } },
      exclude: [],
    }, null, 2))
    // 显式制造解析失败，而不是依赖「宿主包碰巧不在 node_modules 里」这种偶然。
    fixture.ctx.loader.import = async () => { throw new Error('模拟：宿主未提供 mcp-client') }
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

test('workspace MCPs resolve through the host loader rather than the plugin own path', async () => {
  // 插件自己 import 时，Node 以插件真实路径为基点解析，在 link / pnpm 安装下找不到
  // dsh 自带的 mcp-client（全局 MCP 走 loader 所以一直正常，只有项目 MCP 会挂）。
  const { installAgentRuntime: install, workspaceMountErrorsView } = await import('../lib/workspace-runtime.js')
  const fixture = await createRuntimeFixture()
  try {
    const resolved = []
    fixture.ctx.loader.import = async (name) => {
      resolved.push(name)
      return { apply: () => {}, inject: [], name: 'mcp-client', Config: undefined }
    }
    install(fixture.ctx)
    const created = await fixture.agentsService.create({ setup: undefined })
    await created.setup(fixture.agentCtx)

    assert.deepEqual(resolved, ['@deepseek-ai/dsh-mcp-client'])
    assert.equal(fixture.mounts.length, 1, '项目 MCP 应通过宿主解析的模块真正挂载')
    assert.equal(workspaceMountErrorsView(fixture.wsRoot).length, 0)
  } finally {
    await fixture.cleanup()
  }
})

test('agent runtime cleanup restores original methods', async () => {
  const { installAgentRuntime: install } = await import('../lib/workspace-runtime.js')
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
// 复刻 cordis 的 traceable 语义：ctx.get() 每次返回新的 Proxy（createTraceable 无缓存），
// 且函数属性读出来还会再包一层 shadow method，因此不能靠 ctx.get() 的返回值身份判重。
function traceableProxy(target) {
  return new Proxy(target, {
    get(t, prop, receiver) {
      if (prop === Symbol.for('cordis.original')) return t
      const value = Reflect.get(t, prop, receiver)
      if (typeof value === 'function') return new Proxy(value, { apply: (fn, _thisArg, args) => Reflect.apply(fn, t, args) })
      return value
    },
    set(t, prop, value) { return Reflect.set(t, prop, value) },
  })
}

test('repeated install does not stack decorators when ctx.get returns a fresh proxy', async () => {
  const { installAgentRuntime: install } = await import('../lib/workspace-runtime.js')
  const fixture = await createRuntimeFixture()
  try {
    const ctx = { ...fixture.ctx, get(name) { return name === 'agents' ? traceableProxy(fixture.agentsService) : undefined } }
    // 面板每 5s 轮询两个 RPC，每个 RPC 都会 ensureAgentRuntime；包装链必须恒为 1 层，
    // 否则 agents.create 的调用深度会随运行时长无限增长直至爆栈。
    for (let i = 0; i < 20; i += 1) install(ctx)
    const created = await fixture.agentsService.create({ setup: undefined })
    await created.setup(fixture.agentCtx)
    assert.equal(fixture.mounts.length, 1, '重复安装不得叠加装饰器')
  } finally {
    await fixture.cleanup()
  }
})

// exclude 变更后必须对运行中的会话重算并调用 restrict，不依赖 tools/change
// （改屏蔽不动全局工具集，那个事件不会触发）。两个方向都已在真实宿主验证即时生效。
test('exclude change recomputes restrict for live agents without a tools/change event', async () => {
  const { installAgentRuntime: install } = await import('../lib/workspace-runtime.js')
  const { McpManagerGateway } = await import('../lib/index.js')
  const fixture = await createRuntimeFixture()
  try {
    install(fixture.ctx)
    const created = await fixture.agentsService.create({ setup: undefined })
    await created.setup(fixture.agentCtx)
    assert.deepEqual(fixture.restrictCalls.at(-1).deny, ['mcp__github__a'])

    await McpManagerGateway.prototype.setWorkspaceExclude.call({ ctx: fixture.ctx }, {
      wsPath: fixture.wsRoot, serverName: 'exa', hidden: true,
    })

    assert.deepEqual(fixture.restrictCalls.at(-1).deny, ['mcp__exa__b', 'mcp__github__a'], '屏蔽后应立即对运行中的会话生效')
  } finally {
    await fixture.cleanup()
  }
})

test('failed restrict is retried instead of being recorded as applied', async () => {
  const { installAgentRuntime: install } = await import('../lib/workspace-runtime.js')
  const fixture = await createRuntimeFixture()
  try {
    // 第一次 restrict 抛错：此时不得把 restrictKey 记为已生效，否则同一 deny 再也不会重试。
    let attempts = 0
    fixture.agentCtx.tools.restrict = (filter) => {
      attempts += 1
      if (attempts === 1) throw new Error('boom')
      fixture.restrictCalls.push(filter)
      return () => {}
    }
    install(fixture.ctx)
    const created = await fixture.agentsService.create({ setup: undefined })
    await created.setup(fixture.agentCtx)
    assert.equal(attempts, 1)
    assert.deepEqual(fixture.restrictCalls, [], '首次调用抛错，不应记录为已应用')

    await fixture.handlers['tools/change']()
    assert.equal(attempts, 2, '同一 deny 必须重试')
    assert.deepEqual(fixture.restrictCalls.at(-1).deny, ['mcp__github__a'])
  } finally {
    await fixture.cleanup()
  }
})

test('agent runtime install waits for the agents service via ctx.inject', async () => {
  const { installAgentRuntimeWhenReady } = await import('../lib/workspace-runtime.js')
  const fixture = await createRuntimeFixture()
  try {
    const injected = []
    // agents 尚未就绪的 ctx：安装必须被推迟给 ctx.inject，而不是当场失败或反复重试。
    const pending = { ...fixture.ctx, get: () => undefined, inject: (deps, cb) => { injected.push([deps, cb]) } }
    installAgentRuntimeWhenReady(pending)
    assert.equal(injected.length, 1)
    assert.deepEqual(injected[0][0], ['agents'])

    const originalCreate = fixture.agentsService.create
    injected[0][1](fixture.ctx)
    assert.notEqual(fixture.agentsService.create, originalCreate, 'agents 就绪后才装饰')
  } finally {
    await fixture.cleanup()
  }
})

test('workspace RPCs do not install the agent runtime', async () => {
  const { McpManagerGateway } = await import('../lib/index.js')
  const fixture = await createRuntimeFixture()
  try {
    const originalCreate = fixture.agentsService.create
    await McpManagerGateway.prototype.listWorkspaces.call({ ctx: fixture.ctx })
    assert.equal(fixture.agentsService.create, originalCreate, 'RPC 不应承担装配职责')
  } finally {
    await fixture.cleanup()
  }
})

test('restrict failures become observable instead of dying in a swallowed catch', async () => {
  const { installAgentRuntime: install, workspaceRestrictErrorView, liveWorkspaceAgentCount } = await import('../lib/workspace-runtime.js')
  const fixture = await createRuntimeFixture()
  try {
    fixture.agentCtx.tools.restrict = () => { throw new Error('scope gone') }
    install(fixture.ctx)
    const created = await fixture.agentsService.create({ setup: undefined })
    await created.setup(fixture.agentCtx)

    // 运行中的会话数是用户判断「这次切换能否影响当前会话」的依据，也是诊断入口。
    assert.equal(liveWorkspaceAgentCount(fixture.wsRoot), 1)
    const failure = workspaceRestrictErrorView(fixture.wsRoot)
    assert.match(failure?.error ?? '', /scope gone/)
    assert.deepEqual(failure.deny, ['mcp__github__a'])
  } finally {
    await fixture.cleanup()
  }
})

test('a later successful restrict clears the recorded failure', async () => {
  const { installAgentRuntime: install, workspaceRestrictErrorView } = await import('../lib/workspace-runtime.js')
  const fixture = await createRuntimeFixture()
  try {
    let fail = true
    fixture.agentCtx.tools.restrict = (filter) => {
      if (fail) throw new Error('transient')
      fixture.restrictCalls.push(filter)
      return () => {}
    }
    install(fixture.ctx)
    const created = await fixture.agentsService.create({ setup: undefined })
    await created.setup(fixture.agentCtx)
    assert.ok(workspaceRestrictErrorView(fixture.wsRoot))

    fail = false
    await fixture.handlers['tools/change']()
    assert.equal(workspaceRestrictErrorView(fixture.wsRoot), null, '成功后必须清除，避免陈旧告警长期挂在面板上')
  } finally {
    await fixture.cleanup()
  }
})
