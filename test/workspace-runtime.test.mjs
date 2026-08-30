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
    effect(fn) { effects.push(fn); return () => {}; },
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
  const scopeModule = {
    createScope(_ctx, scopeKey) {
      scopedTools.set(scopeKey, new Map())
      const scopedCtx = {
        plugin(plugin, config) {
          mounts.push([plugin, config])
          connectionCount += 1                       // 每 (ws,server) 只应 +1
          const table = scopedTools.get(scopeKey)
          const srv = config.serverName
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
          const fiber = Promise.resolve()
          fiber.catch = () => fiber
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
    on(event, handler) { handlers[event] = handler; return () => {}; },
    effect(fn) { effects.push(fn); return () => {}; },
    logger: { warn: () => {}, error: () => {}, info: () => {} },
  }
  return { wsRoot, agentCtx, agentsService, ctx, restrictCalls, mounts, effects, handlers, scopedTools, agentOwnTools, createdScopes, get connectionCount() { return connectionCount }, sharedClientCalls, cleanup: () => rm(wsRoot, { recursive: true, force: true }) }
}


// 构造一个会话替身：tools.register 写入该会话的 own 层；effect(fn) 立即执行 fn 并
// 把返回的 disposer 收集进 effectSink（模拟 agent 作用域的清理 effect）。
function makeSession(fixture, id, effectSink = null) {
  const session = {
    agent: { id, session: { header: { cwd: fixture.wsRoot } } },
    plugin: () => { throw new Error('会话不应直接挂 mcp-client') },
    tools: {
      restrict: () => () => {},
      register(def) { const own = fixture.agentOwnTools.get(session.agent) ?? new Map(); own.set(def.name, def); fixture.agentOwnTools.set(session.agent, own); return () => own.delete(def.name) },
    },
    effect(fn) { if (effectSink) effectSink.push(fn()); return () => {} },
  }
  session.agent.ctx = session
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
    // 同一项目的第二个会话：旧实现会在这里撞 serverName，新实现应复用同一份连接。
    const sessionB = {
      agent: { id: 'a2', session: { header: { cwd: fixture.wsRoot } } },
      plugin: () => { throw new Error('会话不应直接挂 mcp-client') },
      tools: {
        restrict: () => () => {},
        register(def) { const own = fixture.agentOwnTools.get(sessionB.agent) ?? new Map(); own.set(def.name, def); fixture.agentOwnTools.set(sessionB.agent, own); return () => own.delete(def.name) },
      },
      effect(fn) { fixture.effects.push(fn); return () => {} },
    }
    sessionB.agent.ctx = sessionB

    const created = await fixture.agentsService.create({ setup: undefined })
    await created.setup(fixture.agentCtx)
    const resumed = await fixture.agentsService.resume({ setup: undefined })
    await resumed.setup(sessionB)

    // ① 全进程只挂了一份 mcp-client（serverName 只登记一次）
    assert.equal(fixture.mounts.length, 1, '两个会话必须共用一份 mcp-client 实例')
    assert.equal(fixture.mounts[0][1].serverName, 'db')
    // ② 两个会话各自 own 层都拿到了该 server 的工具
    const toolsA = [...(fixture.agentOwnTools.get(fixture.agentCtx.agent) ?? new Map()).keys()].sort()
    const toolsB = [...(fixture.agentOwnTools.get(sessionB.agent) ?? new Map()).keys()].sort()
    assert.deepEqual(toolsA, ['mcp__db__x', 'mcp__db__y'])
    assert.deepEqual(toolsB, ['mcp__db__x', 'mcp__db__y'])
    // ③ 没有任何挂载错误（旧实现此处是 "serverName already in use"）
    assert.deepEqual(workspaceMountErrorsView(fixture.wsRoot), [])
  } finally {
    await fixture.cleanup()
  }
})

test('shared project connection: releasing one session keeps the other working, last one disposes', async () => {
  const { installAgentRuntime: install } = await import('../lib/workspace-runtime.js')
  const fixture = await createRuntimeFixture()
  try {
    install(fixture.ctx)
    const disposersA = []
    const disposersB = []
    const mkSession = (id, sink) => {
      const s = {
        agent: { id, session: { header: { cwd: fixture.wsRoot } } },
        plugin: () => { throw new Error('nope') },
        tools: { restrict: () => () => {}, register: (def) => { const own = fixture.agentOwnTools.get(s.agent) ?? new Map(); own.set(def.name, def); fixture.agentOwnTools.set(s.agent, own); return () => own.delete(def.name) } },
        effect(fn) { sink.push(fn()); return () => {} },
      }
      s.agent.ctx = s
      return s
    }
    const A = mkSession('A', disposersA)
    const B = mkSession('B', disposersB)
    const created = await fixture.agentsService.create({ setup: undefined })
    await created.setup(A)
    const resumed = await fixture.agentsService.resume({ setup: undefined })
    await resumed.setup(B)

    assert.equal(fixture.createdScopes.length, 1)
    assert.equal(fixture.createdScopes[0].disposed, false)

    // 关掉会话 A（触发 agent scope 的清理 effect）：连接仍在，B 的工具不受影响。
    disposersA.forEach((fn) => fn?.())
    assert.equal(fixture.createdScopes[0].disposed, false, '还有会话在用，连接不得断开')
    assert.deepEqual([...(fixture.agentOwnTools.get(B.agent) ?? new Map()).keys()].sort(), ['mcp__db__x', 'mcp__db__y'])
    assert.equal((fixture.agentOwnTools.get(A.agent) ?? new Map()).size, 0, 'A 的投射已撤回')

    // 末个会话关掉后，引用计数归零，连接被释放（serverName 归还）。
    disposersB.forEach((fn) => fn?.())
    assert.equal(fixture.createdScopes[0].disposed, true, '末个会话关掉后必须释放连接')
  } finally {
    await fixture.cleanup()
  }
})

// ── test 3：同项目两会话「交叉并发实际调用」项目 MCP，验证一份连接 + 不串扰 ──
test('shared project connection: two sessions call the project MCP concurrently without crosstalk', async () => {
  const { installAgentRuntime: install, workspaceMountErrorsView } = await import('../lib/workspace-runtime.js')
  const fixture = await createRuntimeFixture()
  try {
    install(fixture.ctx)
    const mkSession = (id) => {
      const s = {
        agent: { id, session: { header: { cwd: fixture.wsRoot } } },
        plugin: () => { throw new Error('会话不应直接挂 mcp-client') },
        tools: {
          restrict: () => () => {},
          register(def) { const own = fixture.agentOwnTools.get(s.agent) ?? new Map(); own.set(def.name, def); fixture.agentOwnTools.set(s.agent, own); return () => own.delete(def.name) },
        },
        effect(fn) { fixture.effects.push(fn); return () => {} },
      }
      s.agent.ctx = s
      return s
    }
    const A = mkSession('A'); const B = mkSession('B')
    await (await fixture.agentsService.create({ setup: undefined })).setup(A)
    await (await fixture.agentsService.resume({ setup: undefined })).setup(B)

    // 前提：两个会话，一条底层连接。
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
    // 每个调用必须拿回自己的 echo（x:A0 / x:B7 ...），不得串到别的会话的载荷。
    const crossed = out.filter(([tag, text]) => text !== `x:${tag}`)
    assert.deepEqual(crossed, [], '并发交叉调用出现串扰: ' + JSON.stringify(crossed))
    // 底层连接确实收到了全部 50 个调用（复用而非各起一份）。
    assert.equal(fixture.sharedClientCalls.length, 50)
    // 全程仍只有一条连接。
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
    // 两个 setup 先经过配置缓存 stat（异步），再停在 mcp-client 模块加载的 barrier 上。
    // 新实现下只有第一个 acquire 真正发起建连（并发者复用同一 pending cell，不再 import）。
    const deadline = Date.now() + 2000
    while (mcpBarrier.length < 1 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 1))
    assert.ok(mcpBarrier.length >= 1, '至少一个 acquire 发起 mcp-client 模块加载，实际 ' + mcpBarrier.length)
    // 同时放行：两个 acquire 一起续跑——若无串行化，它们会各建一份连接（撞 serverName）。
    for (const resolve of mcpBarrier) resolve({ apply: () => {}, inject: [], name: 'mcp-client', Config: undefined })
    await Promise.all([pa, pb])
    assert.equal(fixture.mounts.length, 1, '并发 setup 必须只挂一份 mcp-client')
    assert.equal(fixture.connectionCount, 1, '并发 setup 必须只建一条连接')
    assert.deepEqual(workspaceMountErrorsView(fixture.wsRoot), [], '并发 setup 不得触发 serverName 冲突')
    assert.deepEqual([...(fixture.agentOwnTools.get(A.agent) ?? new Map()).keys()].sort(), ['mcp__db__x', 'mcp__db__y'])
    assert.deepEqual([...(fixture.agentOwnTools.get(B.agent) ?? new Map()).keys()].sort(), ['mcp__db__x', 'mcp__db__y'])
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
    const disposers = []
    const A = makeSession(fixture, 'A', disposers)
    await (await fixture.agentsService.create({ setup: undefined })).setup(A)
    assert.equal(fixture.connectionCount, 1)
    // 末会话关闭：mock 的 teardown 延迟 5ms（模拟 quiesceFiber），此刻连接尚未销毁。
    disposers.forEach((fn) => fn?.())
    assert.equal(fixture.connectionCount, 1, 'teardown 完成前连接仍在释放中')
    // 立刻重开会话：必须等待旧连接 teardown 完成再新建，不能撞 serverName。
    const B = makeSession(fixture, 'B')
    await (await fixture.agentsService.resume({ setup: undefined })).setup(B)
    assert.equal(fixture.connectionCount, 1, '释放窗口内重建不得产生第二条连接')
    assert.deepEqual(workspaceMountErrorsView(fixture.wsRoot), [])
    assert.deepEqual([...(fixture.agentOwnTools.get(B.agent) ?? new Map()).keys()].sort(), ['mcp__db__x', 'mcp__db__y'])
  } finally {
    await fixture.cleanup()
  }
})

// ── HMR/卸载：cleanup 必须撤回运行中会话的投射并释放共享连接，否则留下僵尸工具 ──
test('shared project connection: plugin cleanup retracts projections from live sessions (HMR safety)', async () => {
  const { installAgentRuntime: install } = await import('../lib/workspace-runtime.js')
  const fixture = await createRuntimeFixture()
  try {
    const cleanup = install(fixture.ctx)
    const A = makeSession(fixture, 'A')
    const B = makeSession(fixture, 'B')
    await (await fixture.agentsService.create({ setup: undefined })).setup(A)
    await (await fixture.agentsService.resume({ setup: undefined })).setup(B)
    assert.equal(fixture.createdScopes.length, 1)
    assert.equal((fixture.agentOwnTools.get(A.agent) ?? new Map()).size, 2)
    assert.equal((fixture.agentOwnTools.get(B.agent) ?? new Map()).size, 2)
    // 模拟插件 HMR 重载：卸载旧实例（installAgentRuntime 返回的 cleanup 即 ctx.effect 的清理体）。
    cleanup()
    assert.equal((fixture.agentOwnTools.get(A.agent) ?? new Map()).size, 0, 'HMR 后运行中会话的工具投射必须撤回')
    assert.equal((fixture.agentOwnTools.get(B.agent) ?? new Map()).size, 0)
    assert.equal(fixture.createdScopes[0].disposed, true, 'HMR 后共享连接必须释放')
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
    await (await f2.agentsService.resume({ setup: undefined })).setup(B)
    assert.equal(f1.connectionCount, 1)
    assert.equal(f2.connectionCount, 1, '两个 app root 各自只建一条连接')
    assert.equal((f2.agentOwnTools.get(B.agent) ?? new Map()).size, 2)
    // f1 的宿主工具集变化：tools/change 只应重算 f1 的投射，不得误撤 f2 的。
    f1.handlers['tools/change']()
    await new Promise((resolve) => setTimeout(resolve, 5))
    assert.equal((f2.agentOwnTools.get(B.agent) ?? new Map()).size, 2, 'f1 的 tools/change 不得撤掉 f2 的投射')
    assert.equal((f1.agentOwnTools.get(A.agent) ?? new Map()).size, 2)
  } finally {
    await f1.cleanup()
    await f2.cleanup()
  }
})
