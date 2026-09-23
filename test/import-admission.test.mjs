import assert from 'node:assert/strict'
import test from 'node:test'
import { canonicalizeExpression, envNamesIn, isTotalExpression, makeEnvExpression, parseExpression } from '../lib/env-expression.js'
import { admitImportedServers } from '../lib/import-admission.js'

test('the expression grammar has one producer and one acceptance test', () => {
  // 产出面：只产出「总值」形式（裸引用在变量缺失时求值为 undefined，会让宿主起不来）。
  assert.equal(makeEnvExpression('TOKEN'), '!!js (process.env.TOKEN ?? "")')
  assert.equal(makeEnvExpression('TOKEN', 'fallback'), '!!js (process.env.TOKEN ?? "fallback")')
  assert.equal(makeEnvExpression('TOKEN', ''), '!!js (process.env.TOKEN ?? "")')
  assert.equal(isTotalExpression(makeEnvExpression('TOKEN')), true)

  // 接受面：裸引用仍然"是受限表达式"，但**不是**总值——这正是归一化要处理的那一格。
  assert.deepEqual(parseExpression('!!js process.env.TOKEN'), [{ kind: 'env', name: 'TOKEN' }])
  assert.equal(isTotalExpression('!!js process.env.TOKEN'), false)
  assert.equal(isTotalExpression('!!js (process.env.TOKEN ?? "")'), true)

  // 归一化：规范形式一律带 `?? ""`，且对已是规范形式的值幂等。
  assert.equal(canonicalizeExpression('!!js process.env.TOKEN'), '!!js (process.env.TOKEN ?? "")')
  assert.equal(canonicalizeExpression('!!js "a" + process.env.X + "b"'), '!!js "a" + (process.env.X ?? "") + "b"')
  assert.equal(canonicalizeExpression('!!js "a" + (process.env.X ?? "")'), '!!js "a" + (process.env.X ?? "")')
  assert.equal(canonicalizeExpression('!!js "C:\\\\tools\\\\" + process.env.X'), '!!js "C:\\\\tools\\\\" + (process.env.X ?? "")')

  // 非受限语法在两侧同时为假，不再存在"接受面比产出面宽"的直通。
  for (const bad of ['!!js globalThis.exit()', '!!js ', '!!js `x`', 'process.env.X', 'npx', '']) {
    assert.equal(parseExpression(bad), null, bad)
    assert.equal(canonicalizeExpression(bad), null, bad)
  }
})

test('referenced env names come from the grammar, not from a regex over the text', () => {
  // 字符串字面量里的 `process.env.X` 是文案：正则扫全文会把它算成缺值变量，界面多一条假提示。
  assert.deepEqual(envNamesIn('!!js "see process.env.AGENT_HOME please " + (process.env.YYY ?? "")'), ['YYY'])
  assert.deepEqual(envNamesIn('!!js process.env.A + (process.env.B ?? "b") + process.env.A'), ['A', 'B'])
  assert.deepEqual(envNamesIn('npx'), [])
  assert.deepEqual(envNamesIn('!!js not an expression'), [])
})

test('admission canonicalizes every expression cell without touching the input', () => {
  const input = {
    servers: [{
      name: 'a',
      transport: 'stdio',
      command: '!!js process.env.CMD',
      args: ['x', '!!js process.env.A'],
      env: { K: '!!js process.env.K' },
      cwd: '!!js (process.env.CWD ?? "")',
    }],
    warnings: ['来源级提示'],
  }
  const once = admitImportedServers(input)
  assert.deepEqual(once.servers[0], {
    name: 'a',
    transport: 'stdio',
    command: '!!js (process.env.CMD ?? "")',
    args: ['x', '!!js (process.env.A ?? "")'],
    env: { K: '!!js (process.env.K ?? "")' },
    cwd: '!!js (process.env.CWD ?? "")',
  })
  assert.deepEqual(once.warnings, ['来源级提示'])
  // 幂等：预览与写盘各准入一次，结果必须一样。
  assert.deepEqual(admitImportedServers(once), once)
  // 入参不得被改写。
  assert.equal(input.servers[0].command, '!!js process.env.CMD')
})

test('admission leaves literal values and unknown fields alone', () => {
  const servers = [{
    name: 'x',
    transport: 'streamable-http',
    url: 'https://x.test/mcp',
    headers: { A: 'Bearer literal-token' },
    args: undefined,
    disabled: true,
  }]
  assert.deepEqual(admitImportedServers({ servers }).servers, servers)
})

test('admission walks the whole spec, so no expression-bearing field can be forgotten', () => {
  // 不维护"哪些字段可能带表达式"的清单：以后 expressionValue 支持新字段时，清单会静默过期。
  const admitted = admitImportedServers({
    servers: [{
      name: 'a',
      transport: 'stdio',
      command: '!!js process.env.CMD',
      args: ['!!js process.env.A'],
      env: { K: '!!js process.env.K' },
      cwd: '!!js process.env.CWD',
      reconnect: { enabled: true },
    }],
  })
  const [server] = admitted.servers
  assert.equal(server.command, '!!js (process.env.CMD ?? "")')
  assert.equal(server.args[0], '!!js (process.env.A ?? "")')
  assert.equal(server.env.K, '!!js (process.env.K ?? "")')
  assert.equal(server.cwd, '!!js (process.env.CWD ?? "")')
  assert.deepEqual(server.reconnect, { enabled: true })
})

test('admission fails closed on an unparseable !!js value instead of passing it through', () => {
  const bad = { servers: [{ name: 'a', transport: 'streamable-http', url: 'https://x.test/mcp', headers: { Authorization: '!!js globalThis.exit()' } }] }
  assert.throws(() => admitImportedServers(bad), /headers\.Authorization 含不受支持的 !!js 表达式/)
  // 报文不回显值本身（它可能来自用户主目录里的配置）。
  assert.throws(() => admitImportedServers(bad), (error) => !String(error.message).includes('globalThis'))
})

test('admission keeps the first of a duplicate name, reports the rest, and never yields two of a kind', () => {
  // 同作用域重名会让宿主的 mcp-client 在插件加载时直接抛（整棵树起不来），项目层则会被
  // mcpServers 的对象键静默覆盖。所以写盘前必须去重——但**不能因此让整批失败**：
  // 用户勾了 3 条、其中 1 条重名，只跳过那 1 条才是合理体验。
  const result = admitImportedServers({
    servers: [
      { name: 'a', transport: 'stdio', command: 'first' },
      { name: 'a', transport: 'stdio', command: 'second' },
      { name: 'b', transport: 'stdio', command: 'node' },
    ],
  })
  assert.deepEqual(result.servers.map((server) => server.name), ['a', 'b'], '保留先出现的那条')
  assert.equal(result.servers[0].command, 'first')
  assert.deepEqual(result.skipped, ['a'])
  assert.ok(result.warnings.some((warning) => warning.includes('已跳过：a')))

  // 幂等：把结果再准入一次，条目与提示都不变，也不再重复报警。
  // `skipped` 是"这次导入被跳过过哪些名字"的累计记录（预览与写盘各准入一次），所以它保留。
  const again = admitImportedServers(result)
  assert.deepEqual(again.servers, result.servers)
  assert.deepEqual(again.warnings, result.warnings)
  assert.deepEqual(again.skipped, ['a'])
  // 空集合与非导入输入不炸。
  assert.deepEqual(admitImportedServers({ servers: [] }).servers, [])
  assert.deepEqual(admitImportedServers({}).skipped, [])
})
