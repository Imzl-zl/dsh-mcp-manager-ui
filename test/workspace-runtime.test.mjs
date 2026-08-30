import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { installAgentRuntime } from '../lib/workspace-runtime.js'

// 模拟 cordis `ctx.effect()` 的返回语义：立即同步执行 factory、把它返回的 disposer 交给一个
// 幂等 wrapper（cordis 用 runner.epoch 保证同一 effect 只 dispose 一次），wrapper 透传 disposer
// 的返回值（异步 disposer 的 teardown promise 会被 Fiber._unload await）。
// 早先的替身返回的是空函数、且 sink 为空时连 factory 都不执行，会掩盖两类真实缺陷：
// 「HMR 撤回走的是不是官方 disposer」与「teardown 有没有被交回宿主」。
function makeEffect(sinks) {
  return (factory) => {
    const disposer = factory()
    let done = false
    const wrapper = () => {
      if (done) return undefined
      done = true
      return typeof disposer === 'function' ? disposer() : undefined
    }
    for (const sink of sinks) if (sink) sink.push(wrapper)
    return wrapper
  }
}
// 作用域已销毁的 ctx：cordis 的 effect() 开头就 assertActive()，我们照抄这条语义。
function makeInactiveEffect() {
  return () => { throw new Error('INACTIVE_EFFECT') }
}

// deferTools 默认 true = 生产时序：真实 mcp-client 的 apply 在 cordis 的微任务里才跑，工具要等
// connect + tools/list 才注册，所以 setup 当场看到的一定是空集，投射完全依赖后续 tools/change。
// 需要「工具已就绪」的用例显式调用 await fixture.connectAll()。
async function createRuntimeFixture({ deferTools = true } = {}) {
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
  const warns = []
  // 模拟宿主 ToolRuntime 的“按作用域”工具表：scopeKey -> [{name, ...}]。
  // 共享连接把工具注册进它的作用域层，会话侧按 scopeKey 读取并投射进 own 层。
  const scopedTools = new Map() // scopeKey -> Map<name, def>
  const agentOwnTools = new Map() // agent -> Map<name, def>
  const agentCtx = {
    agent: { id: 'a1', session: { header: { cwd: wsRoot } } },
    plugin(plugin, config) {
      // 会话不再直接挂 mcp-client；保留以便断言“没有走旧的每会话挂载路径”。
      mounts.push([plugin, config])
      const fiber = Promise.resolve()
      fiber.catch = () => fiber
      return fiber
    },
    tools: {
      restrict(filter) { restrictCalls.push(filter); return () => {}; },
      register(def) {
        let own = agentOwnTools.get(agentCtx.agent)
        if (!own) { own = new Map(); agentOwnTools.set(agentCtx.agent, own) }
        own.set(def.name, def)
        return () => { own.delete(def.name) }
      },
    },
    effect: makeEffect([effects]),
  }
  agentCtx.agent.ctx = agentCtx
  const agentsService = {
    create(options) { return { setup: options.setup }; },
    resume(options) { return { setup: options.setup }; },
  }
  // 共享连接的 createScope 替身：建一个 scopeKey 的工具表，plugin() 时按 config.serverName
  // 注册两个工具（模拟 mcp-client 连接就绪后注册 mcp__<server>__*）。
  const createdScopes = []
  let connectionCount = 0            // 建立了几条底层连接（共享的关键指标）
  const sharedClientCalls = []       // 底层连接收到的调用（含 session 标记），验证多路复用不串
  const publishTargets = new Map()   // scopeKey -> serverName（用于 deferTools 时延后注册）
  const logExporters = []            // ensureLogCapture 挂上来的 exporter（模拟 cordis LoggerService）
  const publish = (scopeKey, srv) => {
    let table = scopedTools.get(scopeKey)
    if (!table) { table = new Map(); scopedTools.set(scopeKey, table) }
    const mkDef = (raw) => ({
      name: `mcp__${srv}__${raw}`,
      output: { schema: {}, render: () => [] },
      // 代理执行 = 转发到这条共享连接；按 JSON-RPC 语义各调用独立异步返回。
      execute: async (args) => {
        const id = sharedClientCalls.length
        sharedClientCalls.push({ id, tool: `${srv}.${raw}`, args })
        await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 8)))
        return { content: [{ type: 'text', text: `${raw}:${args?.echo ?? ''}` }] }
      },
    })
    table.set(`mcp__${srv}__x`, mkDef('x'))
    table.set(`mcp__${srv}__y`, mkDef('y'))
  }
  const scopeModule = {
    createScope(_ctx, scopeKey) {
      scopedTools.set(scopeKey, new Map())
      // fiber 的形状与 cordis `ctx.plugin()` 的返回值对齐：thenable（await 它等到启动结束）
      // 且带一个状态代号（0=waiting 未激活、2=ACTIVE、3=failed），面板的行状态直接读它。
      const scopedCtx = {
        plugin(plugin, config) {
          mounts.push([plugin, config])
          connectionCount += 1                       // 每 (ws,server) 只应 +1
          publishTargets.set(scopeKey, config.serverName)
          if (!deferTools) publish(scopeKey, config.serverName)
          const fiber = Promise.resolve()
          fiber.catch = () => fiber
          fiber.state = 2
          return fiber
        },
      }
      const scope = {
        key: scopeKey, ctx: scopedCtx, disposed: false,
        // 模拟真实 quiesceFiber 的异步 teardown：serverName 在 teardown 完成后才归还。
        dispose() { this.disposed = true; scopedTools.delete(scopeKey); return new Promise((resolve) => setTimeout(() => { connectionCount -= 1; resolve() }, 5)) },
      }
      createdScopes.push(scope)
      return scope
    },
  }
  const ctx = {
    loader: {
      entries: () => [
        { options: { name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'github' } } },
        { options: { name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'exa' } } },
      ],
      import: async (name) => {
        if (name === '@deepseek-ai/dsh-scope') return scopeModule
        assert.equal(name, '@deepseek-ai/dsh-mcp-client')
        return { apply: () => {}, inject: [], name: 'mcp-client', Config: undefined }
      },
    },
    // 全局工具（用于 exclude/restrict 展开）在无 scope 时返回；带 scopeKey 时返回该共享连接注册的工具。
    tools: {
      schemas: (scope) => {
        if (scope !== undefined && scopedTools.has(scope)) return [...scopedTools.get(scope).values()].map((d) => ({ name: d.name }))
        return [{ name: 'mcp__github__a' }, { name: 'mcp__exa__b' }]
      },
      get: (name, scope) => (scope !== undefined ? scopedTools.get(scope)?.get(name) : undefined),
    },
    get(name) { if (name === 'agents') return agentsService; if (name === 'tools') return ctx.tools; return undefined; },
    on(event, handler) { handlers[event] = handler; return () => {} },
    effect: makeEffect([effects]),
    logger: {
      warn: (message) => warns.push(message), error: () => {}, info: () => {},
      // mcp-client 不暴露连接事件，面板靠 ctx.logger.exporter 订阅它的日志判定连接失败。
      buffer: [],
      exporter: (exp) => { logExporters.push(exp); return () => { const at = logExporters.indexOf(exp); if (at >= 0) logExporters.splice(at, 1) } },
    },
  }
  const sessionDisposers = []
  const fixture = {
    wsRoot, agentCtx, agentsService, ctx, restrictCalls, mounts, effects, handlers, warns, scopedTools, agentOwnTools, createdScopes,
    sessionDisposers,
    get connectionCount() { return connectionCount },
    sharedClientCalls,
    // 让连接“就绪”：注册工具并广播 tools/change，等价于真实 mcp-client connect + tools/list 完成。
    publishTools(scope) {
      publish(scope.key, publishTargets.get(scope.key))
      return handlers['tools/change']?.()
    },
    // 让当前所有共享连接就绪一次（生产主路径：setup 之后才有工具）。
    async connectAll() {
      for (const scope of createdScopes) {
        if (scope.disposed) continue
        publish(scope.key, publishTargets.get(scope.key))
      }
      await handlers['tools/change']?.()
    },
    ownToolNames(session) { return [...(agentOwnTools.get(session.agent) ?? new Map()).keys()].sort() },
    // 模拟 mcp-client 写一条日志（正文带 mcp-client(<serverName>)，与官方 label 一致；真实
    // cordis 的 message.name 是 hyphenate(fiber.name) = 'mcp-client'，不含括号）。
    emitMcpLog(type, text) {
      const record = { type, name: 'mcp-client', args: [text], ts: Date.now() }
      for (const exp of [...logExporters]) exp.export(record)
      return record
    },
    // 会话替身留下的 disposer 一律在收尾时跑掉：否则模块级的会话记录会在同文件的用例之间累积，
    // 把「会话销毁没清理」这类缺陷盖住。
    async cleanup() {
      for (const dispose of sessionDisposers.splice(0)) { try { await dispose() } catch { /* noop */ } }
      await rm(wsRoot, { recursive: true, force: true })
    },
  }
  return fixture
}


// 构造一个会话替身：tools.register 写入该会话的 own 层；effect(fn) 按 cordis 语义立即执行 fn，
// 返回幂等 disposer。session.dispose() 依序跑掉本会话所有 effect 的 disposer 并等待它们的
// teardown promise —— 等价于 cordis 销毁 agent scope 时做的事。
function makeSession(fixture, id, effectSink = null) {
  const own = []
  let active = true
  const session = {
    agent: { id, session: { header: { cwd: fixture.wsRoot } } },
    plugin: () => { throw new Error('会话不应直接挂 mcp-client') },
    tools: {
      restrict: () => () => {},
      register(def) { const table = fixture.agentOwnTools.get(session.agent) ?? new Map(); table.set(def.name, def); fixture.agentOwnTools.set(session.agent, table); return () => table.delete(def.name) },
    },
    // cordis 的 effect() 开头就 assertActive()：作用域销毁后再登记生命周期会直接抛。
    // 这正是本模块赖以判定「会话已在建连期间结束」的官方面，必须在替身里如实建模。
    effect(factory) {
      if (!active) throw new Error('INACTIVE_EFFECT')
      return makeEffect([own, effectSink])(factory)
    },
    async dispose() { active = false; await Promise.all(own.splice(0).map((fn) => fn())) },
  }
  session.agent.ctx = session
  fixture.sessionDisposers.push(() => session.dispose())
  return session
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
    const scopeMod = {
      createScope(_ctx, scopeKey) {
        const scopedCtx = { plugin: (plugin, config) => { fixture.mounts.push([plugin, config]); const f = Promise.resolve(); f.catch = () => f; return f } }
        return { ctx: scopedCtx, dispose() {} }
      },
    }
    fixture.ctx.loader.import = async (name) => {
      resolved.push(name)
      if (name === '@deepseek-ai/dsh-scope') return scopeMod
      return { apply: () => {}, inject: [], name: 'mcp-client', Config: undefined }
    }
    install(fixture.ctx)
    const created = await fixture.agentsService.create({ setup: undefined })
    await created.setup(fixture.agentCtx)

    // 共享连接需要两个宿主模块：dsh-scope（造隔离作用域）与 mcp-client（真正连接）。
    assert.deepEqual([...resolved].sort(), ['@deepseek-ai/dsh-mcp-client', '@deepseek-ai/dsh-scope'])
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

// exclude 变更后重算 deny 并写入会话作用域，不依赖 tools/change（改屏蔽不动全局工具集，
// 那个事件不会触发）。断言的是「重算并调用 restrict」——会话的工具清单在首轮请求时定型，
// 已开始的对话不受影响。
test('exclude change recomputes deny and calls restrict without a tools/change event', async () => {
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

    assert.deepEqual(fixture.restrictCalls.at(-1).deny, ['mcp__exa__b', 'mcp__github__a'], '写入后应重算 deny 并调用 restrict')
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

// ── 共享连接：同项目多会话不再撞 serverName，且各会话都拿到工具 ──
test('shared project connection: two sessions of one project reuse ONE mcp-client instance', async () => {
  const { installAgentRuntime: install, workspaceMountErrorsView } = await import('../lib/workspace-runtime.js')
  const fixture = await createRuntimeFixture()
  try {
    install(fixture.ctx)
    const A = makeSession(fixture, 'A')
    const B = makeSession(fixture, 'B')
    await (await fixture.agentsService.create({ setup: undefined })).setup(A)
    await (await fixture.agentsService.resume({ setup: undefined })).setup(B)

    // 只挂了一份官方 mcp-client（一个共享作用域、一条底层连接），serverName 只登记一次。
    assert.equal(fixture.createdScopes.length, 1, '每 (项目, serverName) 只应建一个共享作用域')
    assert.equal(fixture.connectionCount, 1, '两个会话必须共用一条连接')
    assert.deepEqual(workspaceMountErrorsView(fixture.wsRoot), [], '共享连接下不应再有 serverName 冲突')
    // 生产时序：setup 当场还没有工具，要等 connect + tools/list 完成后的 tools/change。
    assert.deepEqual(fixture.ownToolNames(A), [], 'setup 当场共享连接尚未注册工具')
    await fixture.connectAll()
    assert.deepEqual(fixture.ownToolNames(A), ['mcp__db__x', 'mcp__db__y'])
    assert.deepEqual(fixture.ownToolNames(B), ['mcp__db__x', 'mcp__db__y'])
  } finally {
    await fixture.cleanup()
  }
})

// ── 引用计数：先关的会话只撤自己的投射，末个会话关掉才释放连接 ──
test('shared project connection: releasing one session keeps the other working, last one disposes', async () => {
  const { installAgentRuntime: install } = await import('../lib/workspace-runtime.js')
  const fixture = await createRuntimeFixture()
  try {
    install(fixture.ctx)
    const A = makeSession(fixture, 'A')
    const B = makeSession(fixture, 'B')
    await (await fixture.agentsService.create({ setup: undefined })).setup(A)
    await (await fixture.agentsService.resume({ setup: undefined })).setup(B)
    await fixture.connectAll()

    assert.equal(fixture.createdScopes.length, 1)
    assert.equal(fixture.createdScopes[0].disposed, false)

    // 关掉会话 A（cordis 销毁 agent scope → 跑本会话所有 effect 的 disposer）。
    await A.dispose()
    assert.equal(fixture.createdScopes[0].disposed, false, '还有会话在用，连接不得断开')
    assert.deepEqual(fixture.ownToolNames(B), ['mcp__db__x', 'mcp__db__y'])
    assert.deepEqual(fixture.ownToolNames(A), [], 'A 的投射已撤回')

    // 末个会话关掉后，引用计数归零，连接被释放（serverName 归还）。
    await B.dispose()
    assert.equal(fixture.createdScopes[0].disposed, true, '末个会话关掉后必须释放连接')
    assert.equal(fixture.connectionCount, 0)
  } finally {
    await fixture.cleanup()
  }
})

// ── 同项目两会话「交叉并发实际调用」项目 MCP，验证一份连接 + 不串扰 ──
test('shared project connection: two sessions call the project MCP concurrently without crosstalk', async () => {
  const { installAgentRuntime: install, workspaceMountErrorsView } = await import('../lib/workspace-runtime.js')
  const fixture = await createRuntimeFixture()
  try {
    install(fixture.ctx)
    const A = makeSession(fixture, 'A')
    const B = makeSession(fixture, 'B')
    await (await fixture.agentsService.create({ setup: undefined })).setup(A)
    await (await fixture.agentsService.resume({ setup: undefined })).setup(B)
    await fixture.connectAll()

    assert.equal(fixture.connectionCount, 1, '两个并发会话必须共用一条连接')
    assert.deepEqual(workspaceMountErrorsView(fixture.wsRoot), [])

    const toolA = fixture.agentOwnTools.get(A.agent).get('mcp__db__x')
    const toolB = fixture.agentOwnTools.get(B.agent).get('mcp__db__x')
    assert.ok(toolA && toolB, '两个会话各自 own 层都应拿到 mcp__db__x')

    // 交叉并发：A、B 各发 25 个带唯一 echo 的调用，全部经同一条连接多路复用。
    const jobs = []
    for (let i = 0; i < 25; i += 1) {
      jobs.push(toolA.execute({ echo: `A${i}` }).then((r) => ['A' + i, r.content[0].text]))
      jobs.push(toolB.execute({ echo: `B${i}` }).then((r) => ['B' + i, r.content[0].text]))
    }
    const out = await Promise.all(jobs)
    const crossed = out.filter(([tag, text]) => text !== `x:${tag}`)
    assert.deepEqual(crossed, [], '并发交叉调用出现串扰: ' + JSON.stringify(crossed))
    assert.equal(fixture.sharedClientCalls.length, 50)
    assert.equal(fixture.connectionCount, 1)
  } finally {
    await fixture.cleanup()
  }
})

// ── 并发 setup 竞态：check→await→set 未串行化会让两个会话各建一份连接、触发 serverName 冲突 ──
test('shared project connection: concurrent setup of two sessions builds ONE connection (setup race serialized)', async () => {
  const { installAgentRuntime: install, workspaceMountErrorsView, readWorkspaceConfigCached } = await import('../lib/workspace-runtime.js')
  const fixture = await createRuntimeFixture()
  try {
    // 预填配置缓存：让两个 setup 跳过文件读取、同步进入 acquire。再把 mcp-client 的模块
    // 加载换成受控 barrier：不 resolve 前两个 acquire 都停在 await 处——否则 fs.stat 时序
    // 会让第一个 setup 先全链路跑完，第二个变成顺序复用，测不出竞态。
    install(fixture.ctx)
    await readWorkspaceConfigCached(fixture.ctx, fixture.wsRoot)
    const originalImport = fixture.ctx.loader.import
    const mcpBarrier = []
    fixture.ctx.loader.import = (name) => name === '@deepseek-ai/dsh-scope' ? originalImport(name) : new Promise((resolve) => mcpBarrier.push(resolve))
    const A = makeSession(fixture, 'A')
    const B = makeSession(fixture, 'B')
    const created = await fixture.agentsService.create({ setup: undefined })
    const resumed = await fixture.agentsService.resume({ setup: undefined })
    // dsh 启动恢复多会话的真实形态：并发 setup，不等待第一个完成。
    const pa = created.setup(A)
    const pb = resumed.setup(B)
    const deadline = Date.now() + 2000
    while (mcpBarrier.length < 1 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 1))
    assert.ok(mcpBarrier.length >= 1, '至少一个 acquire 发起 mcp-client 模块加载，实际 ' + mcpBarrier.length)
    for (const resolve of mcpBarrier) resolve({ apply: () => {}, inject: [], name: 'mcp-client', Config: undefined })
    await Promise.all([pa, pb])
    assert.equal(fixture.mounts.length, 1, '并发 setup 必须只挂一份 mcp-client')
    assert.equal(fixture.connectionCount, 1, '并发 setup 必须只建一条连接')
    assert.deepEqual(workspaceMountErrorsView(fixture.wsRoot), [], '并发 setup 不得触发 serverName 冲突')
    await fixture.connectAll()
    assert.deepEqual(fixture.ownToolNames(A), ['mcp__db__x', 'mcp__db__y'])
    assert.deepEqual(fixture.ownToolNames(B), ['mcp__db__x', 'mcp__db__y'])
  } finally {
    await fixture.cleanup()
  }
})

// ── 释放→重建竞态：teardown 是异步的，立即重开必须等旧连接归还 serverName ──
test('shared project connection: immediate re-acquire after last release waits for teardown (no async serverName window)', async () => {
  const { installAgentRuntime: install, workspaceMountErrorsView } = await import('../lib/workspace-runtime.js')
  const fixture = await createRuntimeFixture()
  try {
    install(fixture.ctx)
    const A = makeSession(fixture, 'A')
    await (await fixture.agentsService.create({ setup: undefined })).setup(A)
    assert.equal(fixture.connectionCount, 1)
    // 末会话关闭：mock 的 teardown 延迟 5ms（模拟 quiesceFiber），此刻连接尚未销毁。
    const teardown = A.dispose()
    assert.equal(fixture.connectionCount, 1, 'teardown 完成前连接仍在释放中')
    // 立刻重开会话：必须等待旧连接 teardown 完成再新建，不能撞 serverName。
    const B = makeSession(fixture, 'B')
    await (await fixture.agentsService.resume({ setup: undefined })).setup(B)
    await teardown
    assert.equal(fixture.connectionCount, 1, '释放窗口内重建不得产生第二条连接')
    assert.equal(fixture.createdScopes.length, 2, '旧连接销毁后才允许新建第二个作用域')
    assert.deepEqual(workspaceMountErrorsView(fixture.wsRoot), [])
    await fixture.connectAll()
    assert.deepEqual(fixture.ownToolNames(B), ['mcp__db__x', 'mcp__db__y'])
  } finally {
    await fixture.cleanup()
  }
})

// ── HMR/卸载：cleanup 必须走每个 slot 自己的 cordis disposer 撤回投射并释放连接；
//    之后会话正常销毁不得重复释放（负计数/重复 dispose）。 ──
test('shared project connection: plugin cleanup retracts projections through the official disposer (HMR safety)', async () => {
  const { installAgentRuntime: install } = await import('../lib/workspace-runtime.js')
  const fixture = await createRuntimeFixture()
  try {
    const cleanup = install(fixture.ctx)
    const A = makeSession(fixture, 'A')
    const B = makeSession(fixture, 'B')
    await (await fixture.agentsService.create({ setup: undefined })).setup(A)
    await (await fixture.agentsService.resume({ setup: undefined })).setup(B)
    await fixture.connectAll()
    assert.equal(fixture.createdScopes.length, 1)
    assert.equal(fixture.ownToolNames(A).length, 2)
    assert.equal(fixture.ownToolNames(B).length, 2)
    // 模拟插件 HMR 重载：卸载旧实例（installAgentRuntime 返回的 cleanup 即 ctx.effect 的清理体）。
    await cleanup()
    assert.deepEqual(fixture.ownToolNames(A), [], 'HMR 后运行中会话的工具投射必须撤回')
    assert.deepEqual(fixture.ownToolNames(B), [])
    assert.equal(fixture.createdScopes[0].disposed, true, 'HMR 后共享连接必须释放')
    assert.equal(fixture.connectionCount, 0)
    // 会话之后正常销毁：slot 的 disposer 已被 cleanup 跑过，必须幂等（不重复释放、不负计数）。
    await A.dispose()
    await B.dispose()
    assert.equal(fixture.connectionCount, 0, '重复释放不得把计数压到负数或再次 dispose 连接')
  } finally {
    await fixture.cleanup()
  }
})

// ── 多 app root：一个 root 的 tools/change 与释放不得影响另一个 root 的投射/连接 ──
test('shared project connection: separate app roots never interfere', async () => {
  const { installAgentRuntime: install } = await import('../lib/workspace-runtime.js')
  const f1 = await createRuntimeFixture()
  const f2 = await createRuntimeFixture()
  try {
    install(f1.ctx)
    install(f2.ctx)
    const A = makeSession(f1, 'A')
    const B = makeSession(f2, 'B')
    await (await f1.agentsService.create({ setup: undefined })).setup(A)
    await (await f2.agentsService.create({ setup: undefined })).setup(B)
    await f1.connectAll()
    await f2.connectAll()
    assert.equal(f1.connectionCount, 1)
    assert.equal(f2.connectionCount, 1)
    assert.equal(f1.ownToolNames(A).length, 2)
    assert.equal(f2.ownToolNames(B).length, 2)
    // 关掉 app1 的会话：app2 的连接与投射完全不受影响。
    await A.dispose()
    assert.equal(f1.connectionCount, 0)
    assert.equal(f2.connectionCount, 1, '另一个 app root 的连接不得被牵连')
    assert.equal(f2.ownToolNames(B).length, 2)
  } finally {
    await f1.cleanup()
    await f2.cleanup()
  }
})

// ── 会话在建连期间被销毁：dsh-agent-loop 的 setupAndPublish 用 raceAbort 抛弃 setup 但不取消它。
//    所有权凭 cordis 的 assertActive 判定：作用域已销毁时 agentCtx.effect() 直接抛，引用当场归还。 ──
test('shared project connection: a session disposed mid-connect returns its reference (no leaked connection)', async () => {
  const { installAgentRuntime: install, readWorkspaceConfigCached, workspaceConnectionStatus } = await import('../lib/workspace-runtime.js')
  const fixture = await createRuntimeFixture()
  try {
    install(fixture.ctx)
    await readWorkspaceConfigCached(fixture.ctx, fixture.wsRoot)
    const originalImport = fixture.ctx.loader.import
    let releaseImport
    fixture.ctx.loader.import = (name) => (name === '@deepseek-ai/dsh-scope'
      ? originalImport(name)
      : new Promise((resolve) => { releaseImport = () => resolve({ apply: () => {}, inject: [], name: 'mcp-client', Config: undefined }) }))
    const A = makeSession(fixture, 'A')
    const pending = (await fixture.agentsService.create({ setup: undefined })).setup(A)
    const deadline = Date.now() + 2000
    while (!releaseImport && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 1))
    assert.ok(releaseImport, 'setup 必须已停在共享连接的模块加载上')
    // 会话此刻销毁（宿主已经在跑 prepared.dispose()），被抛弃的 setup 稍后才续跑。
    await A.dispose()
    releaseImport()
    await pending
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(fixture.connectionCount, 0, '会话已销毁，setup 续跑时建出的连接必须当场归还')
    assert.deepEqual(workspaceConnectionStatus(fixture.ctx, fixture.wsRoot, { name: 'db' }), { mounted: false, schemas: [], refs: 0, configStale: false, fiberState: undefined, duplicateOwners: [] })
    assert.equal(fixture.ownToolNames(A).length, 0, '已销毁的会话不应留下工具投射')
    assert.ok(fixture.warns.some((line) => line.includes('已归还共享连接引用')), JSON.stringify(fixture.warns))
  } finally {
    await fixture.cleanup()
  }
})

// ── 插件在建连期间被 HMR 卸载：generation 令牌（而不是会话记录）负责这条判定，引用同样归还。 ──
test('shared project connection: a plugin unloaded mid-connect returns the reference (generation token)', async () => {
  const { installAgentRuntime: install, readWorkspaceConfigCached } = await import('../lib/workspace-runtime.js')
  const fixture = await createRuntimeFixture()
  try {
    const cleanup = install(fixture.ctx)
    await readWorkspaceConfigCached(fixture.ctx, fixture.wsRoot)
    const originalImport = fixture.ctx.loader.import
    let releaseImport
    fixture.ctx.loader.import = (name) => (name === '@deepseek-ai/dsh-scope'
      ? originalImport(name)
      : new Promise((resolve) => { releaseImport = () => resolve({ apply: () => {}, inject: [], name: 'mcp-client', Config: undefined }) }))
    const A = makeSession(fixture, 'A')
    const pending = (await fixture.agentsService.create({ setup: undefined })).setup(A)
    const deadline = Date.now() + 2000
    while (!releaseImport && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 1))
    assert.ok(releaseImport, 'setup 必须已停在共享连接的模块加载上')
    // 会话仍然活着（effect 不会抛），但本代装饰器已经卸载：不能接管，否则谁都不会释放它。
    await cleanup()
    releaseImport()
    await pending
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(fixture.connectionCount, 0, '插件已卸载，飞行中的 setup 建出的连接必须当场归还')
    assert.equal(fixture.ownToolNames(A).length, 0)
    assert.ok(fixture.warns.some((line) => line.includes('插件已卸载')), JSON.stringify(fixture.warns))
  } finally {
    await fixture.cleanup()
  }
})

// ── 生产主路径：真实 mcp-client 在 setup 当场还没注册任何工具（apply 在 cordis 的微任务里跑，
//    工具要等 connect + tools/list），投射完全依赖后续的 tools/change。 ──
test('shared project connection: tools registered after connect reach every live session via tools/change', async () => {
  const { installAgentRuntime: install } = await import('../lib/workspace-runtime.js')
  const fixture = await createRuntimeFixture()
  try {
    install(fixture.ctx)
    const A = makeSession(fixture, 'A')
    const B = makeSession(fixture, 'B')
    await (await fixture.agentsService.create({ setup: undefined })).setup(A)
    await (await fixture.agentsService.resume({ setup: undefined })).setup(B)
    assert.equal(fixture.connectionCount, 1)
    assert.deepEqual(fixture.ownToolNames(A), [], 'setup 当场共享连接尚未注册工具')
    assert.deepEqual(fixture.ownToolNames(B), [])
    // 连接就绪 → mcp-client 注册工具 → tools/change。
    await fixture.publishTools(fixture.createdScopes[0])
    assert.deepEqual(fixture.ownToolNames(A), ['mcp__db__x', 'mcp__db__y'], '就绪后必须补投射进每个存活会话')
    assert.deepEqual(fixture.ownToolNames(B), ['mcp__db__x', 'mcp__db__y'])
  } finally {
    await fixture.cleanup()
  }
})

// ── 会话销毁 / 插件卸载都必须能被宿主 await 到连接真正关闭，否则关停会早于 MCP 子进程退出 ──
test('shared project connection: teardown is awaitable by the host (session dispose and plugin unload)', async () => {
  const { installAgentRuntime: install } = await import('../lib/workspace-runtime.js')
  const bySession = await createRuntimeFixture()
  try {
    install(bySession.ctx)
    const A = makeSession(bySession, 'A')
    await (await bySession.agentsService.create({ setup: undefined })).setup(A)
    assert.equal(bySession.connectionCount, 1)
    await A.dispose()
    assert.equal(bySession.connectionCount, 0, '会话作用域的 disposer 必须返回 teardown promise')
  } finally {
    await bySession.cleanup()
  }
  const byUnload = await createRuntimeFixture()
  try {
    const cleanup = install(byUnload.ctx)
    await (await byUnload.agentsService.create({ setup: undefined })).setup(makeSession(byUnload, 'A'))
    assert.equal(byUnload.connectionCount, 1)
    await cleanup()
    assert.equal(byUnload.connectionCount, 0, '插件卸载的 cleanup 必须返回 teardown promise')
  } finally {
    await byUnload.cleanup()
  }
})

// ── 配置粘性：运行中连接沿用首会话配置，如实告知（configStale），全部会话结束后才换新配置 ──
test('shared project connection: config changes are reported as stale, then applied once all sessions end', async () => {
  const { installAgentRuntime: install, workspaceConnectionStatus, readWorkspaceConfigCached } = await import('../lib/workspace-runtime.js')
  const fixture = await createRuntimeFixture()
  try {
    install(fixture.ctx)
    await (await fixture.agentsService.create({ setup: undefined })).setup(makeSession(fixture, 'A'))
    assert.equal(fixture.mounts.at(-1)[1].command, 'psql')
    // 用户改了 .dsh/mcp.json（长度不同，必然绕过 mtime+size 短路）。
    await writeFile(join(fixture.wsRoot, '.dsh', 'mcp.json'), JSON.stringify({
      mcpServers: { db: { command: 'psql-next-generation', env: { KEY: '${KEY}' } } },
      exclude: ['github'],
    }, null, 2))
    const changed = await readWorkspaceConfigCached(fixture.ctx, fixture.wsRoot)
    const stale = workspaceConnectionStatus(fixture.ctx, fixture.wsRoot, changed.servers[0])
    assert.equal(stale.configStale, true, '面板必须能看到「配置已变化但仍在复用旧连接」')
    assert.equal(stale.refs, 1)
    // 旧会话还在时新开会话：复用旧连接 + 明确告知，不静默、也不在运行中替换连接。
    await (await fixture.agentsService.resume({ setup: undefined })).setup(makeSession(fixture, 'B'))
    assert.equal(fixture.connectionCount, 1, '旧会话在跑时不得另建连接')
    assert.equal(fixture.mounts.length, 1)
    assert.ok(fixture.warns.some((line) => line.includes('配置已变化')), '复用旧配置必须留下日志，' + JSON.stringify(fixture.warns))
    assert.equal(workspaceConnectionStatus(fixture.ctx, fixture.wsRoot, changed.servers[0]).refs, 2)
  } finally {
    await fixture.cleanup()
  }
})

// ── 面板必须能枚举项目 MCP 的工具：它们注册在共享作用域层里，toolInventory 走的全局视图看不到。
//    而且必须按 (wsPath, serverName) 精确定位：手工编辑 .dsh/mcp.json 能造出两个项目同名。 ──
test('shared project connection: the panel enumerates project MCP tools by (wsPath, serverName)', async () => {
  const { installAgentRuntime: install } = await import('../lib/workspace-runtime.js')
  const { McpManagerGateway } = await import('../lib/index.js')
  const fixture = await createRuntimeFixture()
  try {
    install(fixture.ctx)
    const gateway = { ctx: fixture.ctx }
    const listTools = (payload) => McpManagerGateway.prototype.tools.call(gateway, payload)
    assert.deepEqual((await listTools({ name: 'db', wsPath: fixture.wsRoot })).tools, [], '尚无会话持有连接时应为空')
    await (await fixture.agentsService.create({ setup: undefined })).setup(makeSession(fixture, 'A'))
    await fixture.connectAll()
    const listed = await listTools({ name: 'db', wsPath: fixture.wsRoot })
    assert.deepEqual(listed.tools.map((t) => t.name).sort(), ['mcp__db__x', 'mcp__db__y'])
    assert.equal(listed.ambiguous, false)
    // 另一个项目问同名 server：不能把本项目的工具列给它。
    assert.deepEqual((await listTools({ name: 'db', wsPath: fixture.wsRoot + '-other' })).tools, [], '跨项目同名不得串工具')
    // 全局 MCP 仍走原来的 toolInventory 通路（只传名字）。
    assert.deepEqual((await listTools({ name: 'github' })).tools.map((t) => t.name), ['mcp__github__a'])
  } finally {
    await fixture.cleanup()
  }
})

// ── 项目行状态与全局走同一个判定函数（deriveMcpPhase）：连接态取自 cordis fiber 的状态代号，
//    而不是猜 mcp-client 的日志文案。重连耗尽（fiber ACTIVE + 零工具）必须读成失败，不是恒显连接中。 ──
test('shared project connection: the row status comes from deriveMcpPhase over the fiber state, not log guessing', async () => {
  const { installAgentRuntime: install, readWorkspaceConfigCached } = await import('../lib/workspace-runtime.js')
  const { summarizeWorkspaceRow } = await import('../lib/index.js')
  const fixture = await createRuntimeFixture()
  try {
    install(fixture.ctx)
    const server = (await readWorkspaceConfigCached(fixture.ctx, fixture.wsRoot)).servers[0]
    // 尚无会话持有连接：没有 fiber，与全局「条目未加载」同义。
    const idle = summarizeWorkspaceRow(fixture.ctx, fixture.wsRoot, server, undefined)
    assert.equal(idle.status, 'stopped')
    assert.equal(idle.refs, 0)

    await (await fixture.agentsService.create({ setup: undefined })).setup(makeSession(fixture, 'A'))
    // fiber ACTIVE（mcp-client 的 apply 等到首次连接与 tools/list 结束才 ACTIVE）且零工具：终态失败。
    // 这条判定不需要任何日志——文案只用来填 lastError。
    const failed = summarizeWorkspaceRow(fixture.ctx, fixture.wsRoot, server, undefined)
    assert.equal(failed.status, 'failed', 'ACTIVE + 零工具就是不可用的终态，不该显示连接中')
    assert.match(failed.lastError, /未注册任何工具/)
    assert.notEqual(failed.mountFailed, true, '这是连接失败，不是挂载失败')
    // 有 mcp-client 日志时，用它替换 lastError 的文案（原因更具体），状态判定不变。
    fixture.emitMcpLog('error', 'mcp-client(db): giving up after 10 consecutive failed reconnect attempts — tools unregistered')
    const withLog = summarizeWorkspaceRow(fixture.ctx, fixture.wsRoot, server, undefined)
    assert.equal(withLog.status, 'failed')
    assert.match(withLog.lastError, /giving up/)
    // 工具就绪后：已连接。
    await fixture.connectAll()
    const connected = summarizeWorkspaceRow(fixture.ctx, fixture.wsRoot, server, undefined)
    assert.equal(connected.status, 'connected')
    assert.equal(connected.toolCount, 2)
    assert.equal(connected.lastError, null)
    assert.equal(connected.refs, 1)
    // 挂载失败是另一条通路：标记与文案都不同，面板不会把两者混成一句。
    const mountFailedRow = summarizeWorkspaceRow(fixture.ctx, fixture.wsRoot, server, 'command 求值为空')
    assert.equal(mountFailedRow.mountFailed, true)
    assert.match(mountFailedRow.lastError, /求值为空/)
    // 禁用的行与全局一致读成 disabled（而不是「连接中」那种误导性的加载态）。
    const disabled = summarizeWorkspaceRow(fixture.ctx, fixture.wsRoot, { ...server, disabled: true }, undefined)
    assert.equal(disabled.status, 'disabled')
  } finally {
    await fixture.cleanup()
  }
})

// ── 跨项目同名 serverName（手工编辑绕过保存校验）：模型可见工具必须 fail-closed（第二个项目
//    拿不到工具），且面板要把「和谁撞了」说清楚，而不是只抛一句 mcp-client 的原始错误。 ──
test('shared project connection: a duplicate serverName across projects is fail-closed and reported', async () => {
  const { installAgentRuntime: install, readWorkspaceConfigCached } = await import('../lib/workspace-runtime.js')
  const { summarizeWorkspaceRow } = await import('../lib/index.js')
  const fixture = await createRuntimeFixture()
  const other = await mkdtemp(join(tmpdir(), 'dsh-mcp-dup-'))
  try {
    await mkdir(join(other, '.dsh'), { recursive: true })
    await writeFile(join(other, '.dsh', 'mcp.json'), JSON.stringify({ mcpServers: { db: { command: 'psql' } } }))
    install(fixture.ctx)
    const A = makeSession(fixture, 'A')
    const B = makeSession(fixture, 'B')
    B.agent.session.header.cwd = other
    await (await fixture.agentsService.create({ setup: undefined })).setup(A)
    await (await fixture.agentsService.resume({ setup: undefined })).setup(B)
    await fixture.connectAll()
    // 两个项目各有自己的共享作用域，各自的工具只进各自会话的 own 层。
    assert.equal(fixture.createdScopes.length, 2)
    assert.deepEqual(fixture.ownToolNames(A), ['mcp__db__x', 'mcp__db__y'])
    assert.deepEqual(fixture.ownToolNames(B), ['mcp__db__x', 'mcp__db__y'])
    const server = (await readWorkspaceConfigCached(fixture.ctx, fixture.wsRoot)).servers[0]
    const row = summarizeWorkspaceRow(fixture.ctx, fixture.wsRoot, server, undefined)
    assert.deepEqual(row.duplicateOwners, [other], '同名占用必须可观测')
    assert.match(row.lastError, /同时被以下项目使用/)
  } finally {
    await rm(other, { recursive: true, force: true })
    await fixture.cleanup()
  }
})

// ── 单个工具注册失败不能被同一轮里后一个工具的成功抹掉（否则面板一切正常而会话缺工具）。 ──
test('shared project connection: one tool failing to register is not erased by a sibling success', async () => {
  const { installAgentRuntime: install, workspaceMountErrorsView } = await import('../lib/workspace-runtime.js')
  const fixture = await createRuntimeFixture()
  try {
    install(fixture.ctx)
    const A = makeSession(fixture, 'A')
    const original = A.tools.register.bind(A.tools)
    A.tools.register = (def) => {
      if (def.name === 'mcp__db__x') throw new Error('tool name collision')
      return original(def)
    }
    await (await fixture.agentsService.create({ setup: undefined })).setup(A)
    await fixture.connectAll()
    assert.deepEqual(fixture.ownToolNames(A), ['mcp__db__y'], '成功的那个仍应注册')
    assert.deepEqual(workspaceMountErrorsView(fixture.wsRoot), [{ serverName: 'db', error: 'tool name collision' }], '失败必须留在可观测记录里')
  } finally {
    await fixture.cleanup()
  }
})

// ── 键约定入口：appRoot 只接受真 ctx，传错会当场抛而不是把状态写进一个随手造的键里。 ──
test('shared project connection: the key convention entry rejects a non-context argument', async () => {
  const { workspaceToolSchemas } = await import('../lib/workspace-runtime.js')
  assert.throws(() => workspaceToolSchemas(undefined, 'db'), /cordis context/)
  assert.throws(() => workspaceToolSchemas('not-a-ctx', 'db'), /cordis context/)
})

// ── 装配失败必须回滚：ctx.effect 缺失/抛出时不能留下一个被死插件永久改写的 agents 服务。 ──
test('agent runtime install rolls back instead of leaving the host service patched', async () => {
  const { installAgentRuntime: install } = await import('../lib/workspace-runtime.js')
  const fixture = await createRuntimeFixture()
  try {
    const pristineCreate = fixture.agentsService.create
    const pristineResume = fixture.agentsService.resume
    const noEffect = { ...fixture.ctx, effect: undefined }
    assert.throws(() => install(noEffect), /effect\(\)/, '没有生命周期归属就不该装')
    assert.equal(fixture.agentsService.create, pristineCreate, '装配失败不得留下改写过的方法')
    assert.equal(fixture.agentsService.resume, pristineResume)
    // 事后仍可正常安装（判重表没有被失败的那次污染）。
    const cleanup = install(fixture.ctx)
    assert.notEqual(fixture.agentsService.create, pristineCreate)
    await cleanup()
    assert.equal(fixture.agentsService.create, pristineCreate, 'cleanup 必须还原')
  } finally {
    await fixture.cleanup()
  }
})

// ── 只读诊断视图：面板每行只看得见自己那一格，看不到「本进程共有几条共享连接、refs 有没有
//    卡住不归零」。这条视图要如实给出 refs 与 sessions 两个独立事实（相等=健康），并覆盖
//    ready / disposing 两种 cell 状态；它必须全程只读，不得改动引用计数。 ──
test('shared project connection: the read-only diagnostics view reports refs and sessions per connection', async () => {
  const { installAgentRuntime: install, projectConnectionsView } = await import('../lib/workspace-runtime.js')
  const fixture = await createRuntimeFixture()
  try {
    install(fixture.ctx)
    const A = makeSession(fixture, 'A')
    const B = makeSession(fixture, 'B')
    await (await fixture.agentsService.create({ setup: undefined })).setup(A)
    await (await fixture.agentsService.resume({ setup: undefined })).setup(B)
    await fixture.connectAll()

    const rows = await projectConnectionsView(fixture.ctx)
    assert.equal(rows.length, 1, '同项目两个会话只应有一条共享连接')
    assert.deepEqual(rows[0], {
      wsPath: fixture.wsRoot,
      serverName: 'db',
      sessions: 2,
      duplicateOwners: [],
      state: 'ready',
      refs: 2,
      toolCount: 2,
      // fiber 的状态代号原样带出（2 = ACTIVE），面板/排障可以直接喂给 deriveMcpPhase。
      fiberState: 2,
      configStale: false,
      configError: '',
    })
    // 只读：问一次诊断不得动引用计数，否则这个接口自己就会把连接锁死或提前释放。
    assert.equal((await projectConnectionsView(fixture.ctx))[0].refs, 2)
    assert.equal(fixture.connectionCount, 1)

    await A.dispose()
    const afterOne = await projectConnectionsView(fixture.ctx)
    assert.equal(afterOne[0].refs, 1, '一个会话结束后引用应减一')
    assert.equal(afterOne[0].sessions, 1, 'refs 与 sessions 必须同步下降（不相等即为漏引用）')

    await B.dispose()
    assert.deepEqual(await projectConnectionsView(fixture.ctx), [], '最后一个会话结束后不留占位')
    assert.equal(fixture.connectionCount, 0)
  } finally {
    await fixture.cleanup()
  }
})

// ── 建连中（还没有 entry）也必须出现在视图里：卡在建连上恰恰是最需要排障的形态，
//    过滤掉等于看不见。此时没有连接态可读，configStale 给 null 而不是伪造 false。 ──
test('shared project connection: a connection still being established is visible as connecting', async () => {
  const { installAgentRuntime: install, projectConnectionsView } = await import('../lib/workspace-runtime.js')
  const fixture = await createRuntimeFixture()
  try {
    install(fixture.ctx)
    const originalImport = fixture.ctx.loader.import
    let releaseImport
    fixture.ctx.loader.import = (name) => (name === '@deepseek-ai/dsh-scope'
      ? originalImport(name)
      : new Promise((resolve) => { releaseImport = () => resolve({ apply: () => {}, inject: [], name: 'mcp-client', Config: undefined }) }))
    const A = makeSession(fixture, 'A')
    const pending = (await fixture.agentsService.create({ setup: undefined })).setup(A)
    const deadline = Date.now() + 2000
    while (!releaseImport && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 1))
    assert.ok(releaseImport, 'setup 必须已停在共享连接的模块加载上')

    const rows = await projectConnectionsView(fixture.ctx)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].state, 'connecting')
    assert.equal(rows[0].refs, 0)
    assert.equal(rows[0].sessions, 0)
    assert.equal(rows[0].configStale, null)
    assert.equal(rows[0].serverName, 'db')

    releaseImport()
    await pending
  } finally {
    await fixture.cleanup()
  }
})
