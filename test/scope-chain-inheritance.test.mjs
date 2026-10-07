import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as scope from '@deepseek-ai/dsh-scope'

// 平台契约：**作用域链上的工具继承**，以及它为什么**不能**被本插件用上。
//
// 背景：本插件把项目 MCP 的工具逐会话投射进会话自己的层（agentCtx.tools.register）。一个看起来
// 更优雅的替代方案是「项目作用域持有工具、会话绑定到它、靠链继承」，那样新增/删除 server 不必
// 逐会话同步。这一组用例就是为那个方案做的验证，结论分两半：
//
//   成立的一半（用例 1 / 2 / 3；真官方包：真 cordis / Loader / dsh-tools / dsh-scope /
//   dsh-mcp-client + 真 stdio 子进程）：
//     1. 会话绑定到项目作用域后能看到项目层的工具，别的项目与全局视图都看不到；
//     2. 会话**已经存在之后**再往项目作用域注册/撤销工具，立刻对活会话生效，不必重建会话；
//     3. 会话**先绑定**、项目作用域**后建立**（=「先开会话、后写配置」）时，后建的层同样立刻被
//        继承；真实 mcp-client 挂在项目作用域上时同样成立，销毁该作用域会注销工具并收掉子进程。
//
//   不成立的一半（用例 4，决定性）：
//     agent 的父链是**单槽位**的（`bindScopeParent` 对已绑定的键抛 `already bound`），而这个槽位
//     在真实会话里被 **agent preset 注册表**占用（packages/preset/agent-preset-registry/src/index.ts
//     的 join(): `bindScopeParent(key, generation.key)`；会话头里的 `agentPreset` 就是它）。
//     那条 preset standing key 又按 preset revision 共享（`activate()` 一个 definition 只铸一个
//     key，多个 agent 挂在同一个 generation 上），所以也不能把项目绑到它上面 —— 那会让所有用同一
//     preset 的 agent（跨项目）一起继承这个项目的工具。
//     ⇒ 对带 preset 的普通会话（本应用默认），第三方插件**没有**可用槽位把项目作用域插进链上；
//       逐会话投射不是设计疏忽，而是这条约束下的唯一选择。
//
// 这组用例因此也是「该方案已评估并否决」的证据留档：将来若宿主支持多父链，或提供官方的
// 「把常驻作用域附着到某个 agent」的挂载点，第 4 个用例应当变成失败 —— 那才是重新评估的信号。
const TEST_TIMEOUT_MS = 60_000
const WAIT_MS = 20_000
const MCP_NAME = '@deepseek-ai/dsh-mcp-client'

// 最小 MCP stdio 服务：握手 + tools/list + tools/call，退出时落哨兵文件，
// 用来断言项目作用域销毁后没有留下孤儿子进程。
const FIXTURE_SERVER = `
import { writeFileSync } from 'node:fs'
const sentinel = process.argv[2]
process.stdin.setEncoding('utf8')
let buf = ''
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n')
process.stdin.on('end', () => process.exit(0))
process.on('exit', () => { try { writeFileSync(sentinel, 'bye') } catch {} })
process.stdin.on('data', (chunk) => {
  buf += chunk
  let index
  while ((index = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, index)
    buf = buf.slice(index + 1)
    if (!line.trim()) continue
    const message = JSON.parse(line)
    if (message.method === 'initialize') {
      send({ jsonrpc: '2.0', id: message.id, result: {
        protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'fixture', version: '1.0.0' },
      } })
    } else if (message.method === 'tools/list') {
      send({ jsonrpc: '2.0', id: message.id, result: { tools: [{
        name: 'echo',
        description: 'Echo the given text back.',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      }] } })
    } else if (message.method === 'tools/call') {
      send({ jsonrpc: '2.0', id: message.id, result: {
        content: [{ type: 'text', text: 'echo:' + String(message.params.arguments?.text ?? '') }],
      } })
    } else if (message.id !== undefined) {
      send({ jsonrpc: '2.0', id: message.id, result: {} })
    }
  }
})
`

async function waitFor(predicate, timeoutMs = WAIT_MS) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await predicate()
    if (value) return value
    if (Date.now() > deadline) return undefined
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

/** 起一个真实宿主：真 Loader + 真 ToolRuntime + 真 scope；systemPrompt 用最小替身顶替。 */
async function createHost() {
  const ctx = new Context()
  ctx.baseUrl = new URL('../', import.meta.url).href
  await ctx.plugin(Loader)
  ctx.provide('systemPrompt', { tools: () => {}, section: () => {}, getSectionOrder: () => 0 })
  await ctx.plugin(ToolRuntime)
  const tools = ctx.get('tools')
  if (!tools) throw new Error('ToolRuntime 未激活')
  return { ctx, tools }
}

function fixtureTool(name) {
  return {
    name,
    description: `fixture ${name}`,
    parameters: { type: 'object', properties: {} },
    output: {
      schema: {
        type: 'object',
        properties: { content: { type: 'array', items: {} } },
        required: ['content'],
        additionalProperties: false,
      },
      render: () => [{ type: 'text', text: 'ok' }],
    },
    async execute() { return { content: [] } },
  }
}

/**
 * 在**注入了 tools 的 context** 下铸一个作用域。scope ctx 继承的是铸它的那个 context 的依赖
 * API，所以从根 ctx 铸出来的 scope 读 `ctx.tools` 会被 cordis 服务守卫拒绝
 * （`cannot get property "tools" without inject`）——真实宿主里 agent scope 铸在
 * dsh-agent-loop 那个注入了 tools 的 fiber 下，插件自己的共享作用域则铸在自己的 ctx 下。
 * @param ctx - 宿主 context。
 * @param key - 作用域键。
 * @returns scope 句柄。
 */
async function mintScope(ctx, key) {
  return await new Promise((resolve) => {
    ctx.inject(['tools'], (toolCtx) => { resolve(scope.createScope(toolCtx, key)) })
  })
}

/**
 * 造一个「会话」：agent scope 的键是一个对象（真实宿主里就是 agent 对象本身），
 * 先把它绑到项目作用域上，再铸出 scope。
 * @param ctx - 宿主 context。
 * @param parentKey - 项目作用域键（可以还不存在对应的层）。
 * @returns 会话的 scope 键与 scope 句柄。
 */
async function openSession(ctx, parentKey) {
  const agentKey = { agent: parentKey }
  scope.bindScopeParent(agentKey, parentKey)
  return { key: agentKey, scope: await mintScope(ctx, agentKey) }
}

const names = (tools, key) => tools.schemas(key).map((schema) => schema.name).sort()

test('scope chain: a session inherits its project scope tools, and later registrations arrive without recreating the session', { timeout: TEST_TIMEOUT_MS }, async () => {
  const { ctx, tools } = await createHost()
  const projectKey = { dshMcpProject: 'C:/ws/a' }
  const otherProjectKey = { dshMcpProject: 'C:/ws/b' }
  // 全局层的一份 + 项目层同名的一份（scoped 遮蔽 global），用来验证 restriction 的作用面。
  const disposeGlobal = tools.register(fixtureTool('global_shared'))
  const project = await mintScope(ctx, projectKey)
  const disposeFirst = project.ctx.tools.register(fixtureTool('proj_a'))
  const disposeShadow = project.ctx.tools.register(fixtureTool('global_shared'))

  const session = await openSession(ctx, projectKey)
  const peer = await openSession(ctx, projectKey)
  const other = await openSession(ctx, otherProjectKey)
  const orphan = await openSession(ctx, { dshMcpProject: 'C:/ws/c' })

  assert.deepEqual(names(tools, session.key), ['global_shared', 'proj_a'], '会话必须继承项目层的工具，同时也看到继承来的全局工具')
  assert.deepEqual(names(tools, peer.key), ['global_shared', 'proj_a'], '同项目的第二个会话看到同一份')
  assert.deepEqual(names(tools, other.key), ['global_shared'], '别的项目只看到全局那份')
  assert.deepEqual(names(tools, orphan.key), ['global_shared'], '没有对应层的项目作用域只看到全局那份')
  assert.deepEqual(names(tools), ['global_shared'], '项目工具不得出现在全局视图里')

  // 会话已经存在之后再注册：这是「新增 server 对活会话立即生效」的最小形态。
  const disposeLate = project.ctx.tools.register(fixtureTool('proj_b'))
  assert.deepEqual(names(tools, session.key), ['global_shared', 'proj_a', 'proj_b'], '后注册的工具必须立刻对活会话可见')
  assert.deepEqual(names(tools, other.key), ['global_shared'], '后注册不得越过项目边界')

  disposeLate()
  assert.deepEqual(names(tools, session.key), ['global_shared', 'proj_a'], '撤销注册必须立刻从活会话消失')

  // restrict 只能点名**继承来的**名字（全局层与祖先层），碰不到自己层：
  // 项目层自己的 proj_a 因此不能被项目作用域点名（它用自己的层持有工具）。
  assert.throws(() => project.ctx.tools.restrict({ deny: ['proj_a'] }), /unknown global tool/,
    '项目作用域不得点名自己层里的工具（restrict 只作用于继承面）')

  // 点名全局同名工具：全局那份与项目层遮蔽的那份一起被遮掉，且只影响本项目。
  const liftProject = project.ctx.tools.restrict({ deny: ['global_shared'] })
  assert.deepEqual(names(tools, session.key), ['proj_a'], '项目层的 restriction 必须遮罩继承来的同名工具')
  assert.deepEqual(names(tools, other.key), ['global_shared'], '别的项目不受本项目 restriction 影响')
  liftProject()
  assert.deepEqual(names(tools, session.key), ['global_shared', 'proj_a'], '撤销 restriction 后工具必须回来')

  // 反向成立：会话自己可以点名项目层的工具（对它是继承来的），而且只影响这个会话。
  const liftSession = session.scope.ctx.tools.restrict({ deny: ['proj_a'] })
  assert.deepEqual(names(tools, session.key), ['global_shared'], '会话层点名项目工具必须生效')
  assert.deepEqual(names(tools, peer.key), ['global_shared', 'proj_a'], '同项目的另一个会话不受影响')
  liftSession()
  assert.deepEqual(names(tools, session.key), ['global_shared', 'proj_a'])

  // 项目作用域销毁：项目层的两份都消失，只剩全局那份（仍然活着的会话立刻反映）。
  await project.dispose()
  assert.deepEqual(names(tools, session.key), ['global_shared'])
  assert.deepEqual(names(tools, peer.key), ['global_shared'])

  disposeGlobal()
  disposeFirst()
  disposeShadow()
  for (const agent of [session, peer, other, orphan]) await agent.scope.dispose()
  await ctx.fiber.dispose()
})

test('scope chain: a session bound before its project scope exists picks the layer up when it appears later', { timeout: TEST_TIMEOUT_MS }, async () => {
  const { ctx, tools } = await createHost()
  const projectKey = { dshMcpProject: 'C:/ws/late' }

  // 会话先开：此刻配置里还没有任何 server，项目作用域也还不存在。
  const session = await openSession(ctx, projectKey)
  assert.deepEqual(names(tools, session.key), [], '项目作用域还不存在时会话看不到任何项目工具')

  // 「先开会话、后写配置」：现在才建项目作用域并挂上工具。
  const project = await mintScope(ctx, projectKey)
  const disposeTool = project.ctx.tools.register(fixtureTool('late_added'))
  assert.deepEqual(names(tools, session.key), ['late_added'], '配置在会话之后写入时，活会话必须立刻拿到工具')

  disposeTool()
  // 项目作用域销毁（= 该项目没有活会话了 / 被回收）：工具必须从活会话视图里消失。
  assert.deepEqual(names(tools, session.key), [], '撤销后立刻消失')

  const disposeAgain = project.ctx.tools.register(fixtureTool('late_added'))
  await project.dispose()
  assert.deepEqual(names(tools, session.key), [], '项目作用域销毁后，仍然活着的会话不得再看到它的工具')
  assert.equal(typeof disposeAgain, 'function')

  await session.scope.dispose()
  await ctx.fiber.dispose()
})

test('scope chain: the agent parent slot is single-owner, so a preset-style standing scope blocks a third-party insert', { timeout: TEST_TIMEOUT_MS }, async () => {
  const { ctx, tools } = await createHost()
  // agent-preset-registry 就是这么做的：把 agent 的父链指到 preset 的 standing key
  // （packages/preset/agent-preset-registry/src/index.ts 的 join(): bindScopeParent(key, generation.key)）。
  const presetStandingKey = { preset: 'standard' }
  const projectKey = { dshMcpProject: 'C:/ws/x' }
  const project = await mintScope(ctx, projectKey)
  const disposeProjectTool = project.ctx.tools.register(fixtureTool('proj_tool'))

  const agentKey = {}
  scope.bindScopeParent(agentKey, presetStandingKey)
  const session = { key: agentKey, scope: await mintScope(ctx, agentKey) }

  assert.deepEqual(names(tools, agentKey), [], 'agent 的链上只有 preset 层，项目工具进不去')

  // 插件随后想把项目作用域插进同一条链：宿主明确拒绝 —— 父链是单槽位的。
  assert.throws(() => scope.bindScopeParent(agentKey, projectKey), /already bound/,
    'agent 的父链只有一个槽位，被 preset 占用后第三方插件无法再插入')

  // 对照：preset 自己往那条链上注册是生效的（链本身没问题，槽位的归属才是限制）。
  const preset = await mintScope(ctx, presetStandingKey)
  const disposePresetTool = preset.ctx.tools.register(fixtureTool('preset_tool'))
  assert.deepEqual(names(tools, agentKey), ['preset_tool'], 'preset 层的工具确实沿链继承')

  // 而且那条 standing key 是按 preset revision 共享的：绑它到项目会让所有用同一 preset
  // 的 agent（跨项目）一起继承这个项目的工具，所以这条路不能走。
  disposePresetTool()
  disposeProjectTool()
  await session.scope.dispose()
  await preset.dispose()
  await project.dispose()
  await ctx.fiber.dispose()
})

test('scope chain: a real mcp-client mounted on a project scope serves bound sessions, and disposing that scope unregisters its tools', { timeout: TEST_TIMEOUT_MS }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-scope-chain-mcp-'))
  const sentinel = join(root, 'server-exited')
  const server = join(root, 'fixture-server.mjs')
  await writeFile(server, FIXTURE_SERVER)

  const { ctx, tools } = await createHost()
  try {
    const projectKey = { dshMcpProject: root }
    // 会话先开（此刻项目作用域还没有、配置也还没读）
    const session = await openSession(ctx, projectKey)

    // 现在才把官方 mcp-client 挂到项目作用域上（等价于「配置后写 + 直接对齐」）
    const mcpClient = await ctx.loader.import(MCP_NAME)
    const project = await mintScope(ctx, projectKey)
    project.ctx.plugin(
      { apply: mcpClient.apply, inject: mcpClient.inject, name: mcpClient.name, Config: mcpClient.Config },
      { transport: 'stdio', serverName: 'fixture', command: process.execPath, args: [server, sentinel] },
    )

    const visible = await waitFor(() => {
      const current = names(tools, session.key)
      return current.includes('mcp__fixture__echo') ? current : undefined
    })
    assert.ok(visible, '真实 mcp-client 挂到项目作用域后，先开的会话必须继承它的工具')
    assert.deepEqual(
      names(tools).filter((name) => name.startsWith('mcp__fixture__')),
      [],
      '项目层的工具不得泄漏到全局视图',
    )

    const definition = tools.get('mcp__fixture__echo', session.key)
    assert.equal(typeof definition?.execute, 'function', '继承来的定义必须可执行')
    const result = await definition.execute({ text: 'hi' }, { signal: new AbortController().signal })
    assert.deepEqual(result, { content: [{ type: 'text', text: 'echo:hi' }] })

    await project.dispose()
    assert.deepEqual(names(tools, session.key), [], '项目作用域销毁后工具必须从会话视图消失')
    assert.ok(await waitFor(() => existsSync(sentinel)), '项目作用域销毁后 stdio 子进程必须退出（不留孤儿）')

    await session.scope.dispose()
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
