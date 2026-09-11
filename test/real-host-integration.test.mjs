import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as scope from '@deepseek-ai/dsh-scope'
import {
  installAgentRuntime,
  projectConnectionsView,
  workspaceMountErrorsView,
  workspaceScopeErrorsView,
  workspaceToolSchemas,
} from '../lib/workspace-runtime.js'

// 这一组用例打的是**真实官方包**（真 cordis / dsh-tools / dsh-scope / dsh-mcp-client + 真 stdio
// MCP 子进程），而不是替身：其余测试文件验证的是本插件内部自洽，只有这里能证明「共享作用域 +
// 工具投射 + monkey-patch setup」这套架构在官方契约上真的成立。
// 替身测不出的东西恰好是这里的地基：tools.schemas(scope) 按对象同一性查层、agentCtx 必须能
// 解析到 tools（dsh-agent-loop 的 AgentLoop.inject 含 tools）、mcp-client 的 serverName 注册表
// 按 scopeOf(ctx) 判重。
const TEST_TIMEOUT_MS = 60_000
const WAIT_MS = 20_000
const SCOPE_MODULE = '@deepseek-ai/dsh-scope'

// 最小 MCP stdio 服务：握手 + tools/list + tools/call，退出时落一个哨兵文件，
// 用来断言会话销毁后没有留下孤儿子进程。
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

/**
 * 起一个真实宿主：真 Loader + 真 ToolRuntime + 真 scope，用最小替身只顶替 `agents`（官方契约是
 * `create/resume(options)`，由宿主调用 `options.setup(agentCtx, agent)`，agentCtx 是 loop scope ctx）。
 * @param wsRoot - 项目目录（含 .dsh/mcp.json）。
 * @returns 宿主句柄：ctx、tools、创建会话、以及清理。
 */
async function createRealHost(wsRoot, { scopeModuleUrl } = {}) {
  const ctx = new Context()
  ctx.baseUrl = new URL('../', import.meta.url).href
  await ctx.plugin(Loader)
  const warnings = []
  // 插件的作用域故障记账会先 warn 一次：日志也是可观测面的一部分，用例要能断言它不刷屏。
  ctx.logger.exporter({ colors: 0, levels: { default: 3 }, export: (message) => { warnings.push(message.args.map(String).join(' ')) } })
  if (scopeModuleUrl) {
    // 制造真实的「两份 @deepseek-ai/dsh-scope 模块实例」：同一个文件用不同 URL 加载，
    // scope 标签（模块内的 Symbol）因此互不相认。这是作用域身份失效的唯一根因，
    // 也是本插件必须能检测并如实报告的那种故障。
    // （在 Node 24 上 loader.internal 为 undefined，所以只能改 loader.import 本身。）
    const loader = ctx.loader
    const originalImport = loader.import.bind(loader)
    loader.import = (name, ...rest) => (name === SCOPE_MODULE
      ? import(scopeModuleUrl)
      : originalImport(name, ...rest))
  }
  // ToolRuntime 声明 static inject = ['systemPrompt']；这里只顶替它，让 fiber 能激活（mode 默认 native）。
  ctx.provide('systemPrompt', { tools: () => {}, section: () => {}, getSectionOrder: () => 0 })
  await ctx.plugin(ToolRuntime)
  const tools = ctx.get('tools')
  if (!tools) throw new Error('ToolRuntime 未激活')

  const agentScopes = []
  const agents = {
    async create(options) {
      const created = {}
      const ready = new Promise((resolve) => { created.resolve = resolve })
      // 生产形状：agent scope 建在注入了 tools 的 fiber 下（dsh-agent-loop 的 AgentLoop.inject 同样含 tools），
      // agentCtx.tools 因此可解析——插件直接读 agentCtx.tools 就是这个前提。
      ctx.inject(['tools'], (toolCtx) => {
        created.key = { agent: agentScopes.length }
        created.scope = scope.createScope(toolCtx, created.key)
        agentScopes.push(created.scope)
        created.resolve(created.scope)
      })
      await ready
      const agent = { session: { header: { cwd: wsRoot } } }
      const commit = await options.setup(created.scope.ctx, agent)
      commit?.commit?.()
      return { key: created.key, scope: created.scope }
    },
    async resume(options) { return this.create(options) },
  }
  ctx.provide('agents', agents)
  installAgentRuntime(ctx)

  return {
    ctx,
    tools,
    agents,
    async createAgent() { return ctx.get('agents').create({}) },
    warnings() { return warnings.slice() },
    async cleanup() {
      for (const agentScope of agentScopes) await agentScope.dispose()
      await ctx.fiber.dispose()
    },
  }
}

test('real host: tools landing in the global layer are reported as a scope failure, not as a connection failure', { timeout: TEST_TIMEOUT_MS }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-mcp-real-host-leak-'))
  const wsRoot = join(root, 'workspace')
  const server = join(root, 'fixture-server.mjs')
  await mkdir(join(wsRoot, '.dsh'), { recursive: true })
  await writeFile(server, FIXTURE_SERVER)
  await writeFile(join(wsRoot, '.dsh', 'mcp.json'), JSON.stringify({
    mcpServers: { fixture: { command: process.execPath, args: [server, join(root, 'unused-sentinel')] } },
  }, null, 2))

  // 第二份 dsh-scope：插件建出的作用域带的是这份实例的 Symbol，真实 dsh-tools / mcp-client
  // 用的仍是第一份，于是 mcp-client 把工具注册进了全局层。
  const scopeEntry = createRequire(import.meta.url).resolve('@deepseek-ai/dsh-scope')
  const host = await createRealHost(wsRoot, { scopeModuleUrl: `${pathToFileURL(scopeEntry).href}?second-instance` })
  const { summarizeWorkspaceRow } = await import('../lib/index.js')
  try {
    await host.createAgent()

    // 故障确实发生了：工具出现在全局视图里（泄漏），共享作用域层里没有。
    const leaked = await waitFor(() => {
      const names = host.tools.schemas().map((schema) => schema.name)
      return names.includes('mcp__fixture__echo') ? names : undefined
    })
    assert.ok(leaked, '两份 dsh-scope 实例必须真的导致工具落到全局层（否则这条用例没测到东西）')

    // 面板必须报「作用域故障」并给出可判定的原因，而不是让用户去查 MCP 配置。
    const row = summarizeWorkspaceRow(host.ctx, wsRoot, { name: 'fixture', transport: 'stdio' }, undefined)
    assert.equal(row.scopeFailed, true)
    assert.equal(row.status, 'failed')
    assert.match(row.lastError, /两份模块实例/)
    assert.notEqual(row.mountFailed, true)

    const scopeErrors = workspaceScopeErrorsView(wsRoot)
    assert.equal(scopeErrors.length, 1)
    assert.equal(scopeErrors[0].serverName, 'fixture')
    // 同一故障不得在轮询里反复刷日志
    const warnings = host.warnings()
    assert.equal(warnings.filter((line) => line.includes('作用域工具视图不可用')).length, 1, JSON.stringify(warnings))
    summarizeWorkspaceRow(host.ctx, wsRoot, { name: 'fixture', transport: 'stdio' }, undefined)
    assert.equal(host.warnings().filter((line) => line.includes('作用域工具视图不可用')).length, 1)
  } finally {
    await host.cleanup()
    await rm(root, { recursive: true, force: true })
  }
})

test('real host: one shared mcp-client per project, tools projected into each session, nothing leaked globally', { timeout: TEST_TIMEOUT_MS }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-mcp-real-host-'))
  const wsRoot = join(root, 'workspace')
  const sentinel = join(root, 'server-exited')
  const server = join(root, 'fixture-server.mjs')
  await mkdir(join(wsRoot, '.dsh'), { recursive: true })
  await writeFile(server, FIXTURE_SERVER)
  await writeFile(join(wsRoot, '.dsh', 'mcp.json'), JSON.stringify({
    mcpServers: { fixture: { command: process.execPath, args: [server, sentinel] } },
  }, null, 2))

  const host = await createRealHost(wsRoot)
  try {
    // 同一项目开两个会话：这是「共享一份连接、不撞 serverName」的核心主张。
    const first = await host.createAgent()
    const second = await host.createAgent()

    const projected = await waitFor(() => {
      const names = host.tools.schemas(first.key).map((schema) => schema.name)
      return names.includes('mcp__fixture__echo') ? names : undefined
    })
    assert.ok(projected, '项目 MCP 的工具必须投射进会话自己的层')

    // 第二个会话看到同一份工具集（共享连接的投射是幂等的、按会话各一份）
    assert.ok(host.tools.schemas(second.key).some((schema) => schema.name === 'mcp__fixture__echo'),
      '同一项目的第二个会话也必须拿到工具')

    // 隔离：全局视图看不到项目工具（泄漏到全局层正是作用域身份失效的症状）
    assert.deepEqual(
      host.tools.schemas().filter((schema) => schema.name.startsWith('mcp__fixture__')) .map((schema) => schema.name),
      [],
      '项目工具不得出现在全局视图里',
    )

    // 进程级事实：只应有一条共享连接，两个会话持有它
    const connections = await projectConnectionsView(host.ctx)
    assert.equal(connections.length, 1, '同一项目两个会话只应有一条共享连接')
    assert.equal(connections[0].serverName, 'fixture')
    assert.equal(connections[0].sessions, 2)
    assert.equal(connections[0].refs, 2)
    assert.equal(connections[0].state, 'ready')
    assert.equal(connections[0].fiberState, 2, 'fiber 应为 ACTIVE（连接与首轮 tools/list 已结束）')
    assert.equal(connections[0].toolCount, 1)
    assert.equal(connections[0].scopeError, '', '作用域视图必须可读，且工具必须在共享作用域层里')

    // 面板与挂载诊断：既没有挂载失败，也没有作用域故障
    assert.deepEqual(workspaceMountErrorsView(wsRoot), [])
    assert.deepEqual(workspaceScopeErrorsView(wsRoot), [])
    assert.deepEqual(workspaceToolSchemas(host.ctx, 'fixture', wsRoot).map((schema) => schema.name), ['mcp__fixture__echo'])

    // 两个会话各调一次：共享连接上的调用必须分别成立（多路复用不串线）
    for (const session of [first, second]) {
      const definition = host.tools.get('mcp__fixture__echo', session.key)
      assert.equal(typeof definition?.execute, 'function', '投射出来的定义必须可执行')
      const result = await definition.execute({ text: 'hi' }, { signal: new AbortController().signal })
      assert.deepEqual(result, { content: [{ type: 'text', text: 'echo:hi' }] })
    }

    // 会话全部结束 -> 共享连接释放 -> stdio 子进程退出（不留孤儿）
    await first.scope.dispose()
    await second.scope.dispose()
    const exited = await waitFor(() => existsSync(sentinel))
    assert.ok(exited, '最后一个会话结束后，共享连接的 stdio 子进程必须退出')

    const afterRelease = await projectConnectionsView(host.ctx)
    assert.equal(afterRelease.length, 0, '引用归零后共享连接必须从诊断视图消失')
  } finally {
    await host.cleanup()
    await rm(root, { recursive: true, force: true })
  }
})
