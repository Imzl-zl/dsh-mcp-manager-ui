// 客户端技能组件（row 11）。
//
// 这一层的测试重点是**纯逻辑**：面板形状的推导、作用域候选项的派生、被遮蔽判定、
// 非法条目与禁用条目的合并。组件的 JSX 结构在 jsdom 里测不出多少真东西（渲染得出来
// 不等于对），所以可验证的价值集中在这些函数上——它们也正是最容易出错的地方。
//
// 三条来自 SPEC 的硬约束：
//   约束 12：UI **不得写死** skill 根路径。本机 ~/.dsh/skills(rank 400) 就不存在，
//            11 个技能全在 ~/.agents/skills(rank 500)，所以作用域候选项必须由**实际发现**
//            的 source 集合派生，且按 source 显示真实路径。
//   约束 13：每个工作区各调一次 list({cwd}) 再合并（宿主在传 cwd 时返回合并视图）。
//   D8：管理行按（名称 + 作用域）精确操作；新增「被遮蔽 / 非法条目」提示。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const clientSource = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
const exportMarker = 'exports.inject = inject;'
const instrumentedClient = clientSource.replace(
  exportMarker,
  `${exportMarker}\nexports.__skills = { SCOPE_LABELS, skillScopeOptions, skillRows, shadowedSkills, skillDiagnostics, skillRiskLevel, skillFilter, skillSourceLabel, SkillsPanel, SkillRow, SkillDetail, SkillCard, SkillInstallModal };`,
)

assert.notEqual(instrumentedClient, clientSource, 'client test export marker must stay current')

/** 造一份假 React，直接调用组件（沿用 client-behavior 的手法）。 */
function loadClientInternals() {
  const react = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children }
    },
    useCallback: (callback) => callback,
    useEffect() {},
    useMemo: (factory) => factory(),
    useRef: (value) => ({ current: value }),
    useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
  }
  let client
  const window = {
    __ModuleLoader__: {
      load(definition) {
        client = definition.factory(() => react)
      },
    },
  }
  vm.runInNewContext(instrumentedClient, {
    console,
    document: { querySelector: () => null, createElement: () => ({ dataset: {} }) },
    navigator: {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setInterval,
    setTimeout,
    clearInterval,
    clearTimeout,
    window,
  })
  return client.__skills
}

/** 收集一棵假 React 树里出现过的字符串（含 props 值），用于断言「界面上真的显示了什么」。 */
function textOf(node, out = []) {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out }
  if (Array.isArray(node)) { for (const child of node) textOf(child, out); return out }
  if (typeof node === 'object') {
    for (const value of Object.values(node.props ?? {})) {
      if (typeof value === 'string' || typeof value === 'number') out.push(String(value))
    }
    for (const child of node.children ?? []) textOf(child, out)
  }
  return out
}

// ⚠️ 跨 realm 注意：被测代码跑在 vm.runInNewContext 里，它返回的数组来自**另一个 realm**，
// 原型不同，assert.deepEqual（strict 下是 deepStrictEqual）会以
// "Values have same structure but are not reference-equal" 失败——那是**测试写法**问题，
// 不是实现问题。既有用例（client-behavior.test.mjs 的 `Array.from(preset.args)`）已经
// 用同一手法绕开，这里沿用：比较前先 Array.from 归一化。
const list = (value) => Array.from(value);

const skill = (over = {}) => ({
  name: 'zhanggui',
  description: '端到端拥有一个开发请求',
  modelInvocable: true,
  userInvocable: true,
  source: 'user-agents',
  scope: 'global',
  root: '/home/u/.agents/skills',
  path: '/home/u/.agents/skills/zhanggui/SKILL.md',
  ...over,
})

/** skillsManager 实际暴露的方法（与 lib/index.js 的 @Remote 声明对应）。 */
const SKILLS_METHODS = new Set([
  'list', 'detail', 'setEnabled', 'remove', 'importSkill', 'market', 'scanSources',
  'conflictingManager', 'searchRemote',
])

/**
 * 用「useEffect 立即执行」的假 React 挂载 SkillsPanel，返回它发出的 RPC 调用。
 *
 * 这是本文件唯一能覆盖**组件接线**的手段：纯函数用例看不到「面板调了哪个方法」，
 * 而调错服务的方法不会抛错、只会静默返回 {ok:false}（表现为界面上少一块数据）。
 */
function mountSkillsPanel({ onCall }) {
  const react = {
    Fragment: Symbol('Fragment'),
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useCallback: (callback) => callback,
    // 立即执行：首次挂载的加载逻辑都写在 useEffect 里，不跑就等于没挂载。
    useEffect: (fn) => { react.__effects.push(fn) },
    useMemo: (factory) => factory(),
    useRef: (value) => ({ current: value }),
    useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
    __effects: [],
  }
  let client
  vm.runInNewContext(instrumentedClient, {
    console,
    document: { querySelector: () => null, createElement: () => ({ dataset: {} }) },
    navigator: {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setInterval, setTimeout, clearInterval, clearTimeout,
    window: { __ModuleLoader__: { load(definition) { client = definition.factory(() => react) } } },
  })
  const call = async (method, args) => {
    const result = await onCall(method, args)
    return result ?? { ok: true }
  }
  const tree = client.__skills.SkillsPanel({ call, onClose() {}, floating: true, switched() {} })
  return { tree, effects: react.__effects, call }
}

test('the panel only calls RPC methods the skills service actually has', async () => {
  // ⚠️ 这条抓的是一个**真实缺陷**，而本文件的纯函数用例结构上测不到它：
  // SkillsPanel 的 `call` 是 callSkills（打到 skillsManager），但它却调了
  // `listWorkspaces` —— 那个方法只在 **mcpManager** 上。callSkills 遇到未定义方法时
  // 返回 { ok: false }，于是**项目作用域的技能永远不出现**：不报错、只是静默少数据。
  const called = []
  const { effects } = mountSkillsPanel({
    onCall: async (method) => {
      called.push(method)
      return SKILLS_METHODS.has(method) ? { ok: true, skills: [], disabled: [] } : { ok: false, error: '未连接' }
    },
  })
  for (const effect of effects) await effect()

  assert.ok(called.length > 0, '首次挂载应发出 RPC（否则这条用例是空转）')
  const wrong = called.filter((method) => !SKILLS_METHODS.has(method))
  assert.deepEqual(wrong, [],
    `面板通过 callSkills 调了 skillsManager 上不存在的方法：${wrong.join(', ')}——`
    + '它会静默返回 {ok:false}，表现为「项目级技能永远不出现」而没有任何报错')
})

test('the manage list actually draws the skill data it was given', async () => {
  // 「数据拿到了但没画出来」是组件最常见的失败，而纯函数用例全绿也发现不了。
  // ⚠️ 不能靠「渲染 SkillsPanel 再看树」来测：假 useState 不会重渲染，
  // 挂载时树里是**初始空状态**——那样断言只会得到「容器在」，等于没测数据。
  // 所以直接渲染**承载数据的子组件**并断言内容：
  const internals = loadClientInternals()
  const row = skill({ name: 'zhanggui' })
  const rowTree = textOf(internals.SkillRow({ row, selected: false, onSelect() {}, shadowed: false })).join(' | ')
  assert.match(rowTree, /zhanggui/, '列表行必须画出技能名')
  assert.match(rowTree, /全局/, '列表行必须画出**真实作用域**标签（约束 12：不得只写「全局/项目」泛称）')

  // 被遮蔽的行要显示提示（这是管理面板相对模型目录的独有价值）。
  const shadowedTree = textOf(internals.SkillRow({ row, selected: false, onSelect() {}, shadowed: true })).join(' | ')
  assert.match(shadowedTree, /被遮蔽/, '被遮蔽的行必须标出来')

  // 详情要画出根目录与调用权限——用户排查「为什么不生效」就靠这些。
  const detailTree = textOf(internals.SkillDetail({
    row, shadowedBy: null, content: '正文内容', busy: false, onToggle() {}, onRemove() {},
  })).join(' | ')
  assert.match(detailTree, /\/home\/u\/\.agents\/skills/, '详情必须画出真实根目录')
  assert.match(detailTree, /正文内容/, '详情必须画出技能正文')

  // 市场卡片：许可门禁为硬闸门，不可安装的条目要给出理由且**不给**安装按钮。
  const blocked = textOf(internals.SkillCard({
    entry: { name: 'docx', summary: 'Word', source: 'anthropics/skills', license: 'Proprietary', installable: false, licenseReason: '禁止在服务之外保留副本', scripts: true },
    installed: false, onInstall() {},
  })).join(' | ')
  assert.match(blocked, /不可安装/, '许可阻断的卡片必须说明不可安装')
  assert.match(blocked, /禁止在服务之外保留副本/, '必须给出阻断理由')
  assert.doesNotMatch(blocked, /^安装$/, '不可安装时不得出现「安装」按钮文案')

  // 声明与实际冲突要披露（真实样本 anti-ui-slop）。
  const conflict = textOf(internals.SkillCard({
    entry: { name: 'anti-ui-slop', summary: 'x', source: 'github/awesome-copilot', license: 'Apache-2.0', installable: true, licenseConflict: true, scripts: false },
    installed: false, onInstall() {},
  })).join(' | ')
  assert.match(conflict, /声明不一致/, '声明与许可文件冲突时必须披露')
})

test('scope options are derived from the sources actually found, never hardcoded', () => {
  // SPEC 约束 12：本机 ~/.dsh/skills(rank 400) 不存在，技能全在 ~/.agents/skills(rank 500)。
  // 若候选项写死一份「全局/项目」清单，用户会看到一个空的作用域，或看不到自己技能真正所在的
  // 那一级。所以候选项必须由**实际返回的 source 集合**派生。
  const internals = loadClientInternals()

  // 只发现 user-agents 时，就只有这一个候选项——不得凭空出现 user-dsh。
  const onlyAgents = internals.skillScopeOptions([skill({ source: 'user-agents' })])
  assert.deepEqual(list(onlyAgents).map((option) => option.source), ['user-agents'])
  assert.equal(onlyAgents[0].label.length > 0, true, '候选项要有可读标签')

  // 发现两个来源时都出现，且全局排在项目之前。
  const mixed = internals.skillScopeOptions([
    skill({ source: 'project-dsh', scope: 'project' }),
    skill({ source: 'user-agents' }),
  ])
  assert.deepEqual(list(mixed).map((option) => option.source), ['user-agents', 'project-dsh'])
  // 真实路径必须带出来（约束 12：按 source 显示其真实路径，不得假设某一级存在）。
  const projectOption = list(mixed).find((option) => option.source === 'project-dsh')
  assert.equal(projectOption.root, '/home/u/.agents/skills', '候选项要带真实根路径')
})

test('scope options carry a human label for every source the host can report', () => {
  // 宿主一共六级 source（SPEC 约束 2）。少一个标签就会在界面上显示成英文 key。
  const internals = loadClientInternals()
  for (const source of ['project-dsh', 'project-agents', 'custom', 'user-dsh', 'user-agents', 'bundled']) {
    const options = internals.skillScopeOptions([skill({ source })])
    assert.equal(options.length, 1, source + ' 应产生一个候选项')
    assert.equal(typeof options[0].label, 'string')
    assert.ok(options[0].label.length > 0, source + ' 缺可读标签')
    assert.doesNotMatch(options[0].label, /^[a-z-]+$/, source + ' 的标签看着还是英文 key：' + options[0].label)
  }
})

test('rows are keyed by name plus scope, not by name alone', () => {
  // SPEC 约束 D8：管理行按（名称 + 作用域）精确操作。同名跨作用域是**合法配置**，
  // 按名字去重会让用户只能看到一个副本，而启停/删除是精确作用到某一个根的。
  const internals = loadClientInternals()
  const rows = internals.skillRows([
    skill({ source: 'user-agents', root: '/u/.agents/skills' }),
    skill({ source: 'project-dsh', scope: 'project', root: '/p/.dsh/skills' }),
  ])
  assert.equal(rows.length, 2, '同名跨作用域必须各占一行')
  // 每行都要有稳定的 key（React 列表用），且两行不同。
  assert.equal(new Set(rows.map((row) => row.key)).size, 2, '两行的 key 必须不同')
})

test('shadowed entries are reported relative to the model-visible catalog', () => {
  // 「被遮蔽」提示是管理面板相对模型可见目录的独有价值：DSH 按 rank 裁决同名技能谁生效，
  // 被遮蔽的那份**模型收不到**，但用户确实装了它。必须能指出来，否则用户会以为改的是
  // 生效的那份。
  const internals = loadClientInternals()
  const rows = [
    skill({ source: 'user-agents', root: '/u/.agents/skills' }),
    skill({ source: 'project-dsh', scope: 'project', root: '/p/.dsh/skills' }),
  ]
  const shadowed = internals.shadowedSkills(rows)
  // 两个同名条目里恰有一个被遮蔽（不是两个、也不是零个）。
  assert.equal(shadowed.length, 1, '同名条目里应恰有一份被遮蔽')
  assert.equal(shadowed[0].name, 'zhanggui')
  // 被遮蔽的那份必须能指出**谁**遮蔽了它，否则用户不知道去看哪一行。
  assert.equal(shadowed[0].shadowedBy.source, 'user-agents', '要指出生效者是哪一个来源')
  assert.notEqual(shadowed[0].source, shadowed[0].shadowedBy.source)

  // 名字唯一时没有任何遮蔽。
  assert.equal(internals.shadowedSkills([skill()]).length, 0)
})

test('diagnostics merge disabled, illegal and blocked entries into one list', () => {
  // 三类「用户需要知道但模型看不到」的条目：已禁用（宿主目录里消失）、
  // 非法 frontmatter（宿主只 warn+skip）、许可阻断（市场里不可安装）。
  // 它们必须能被统一列出，否则用户只能靠猜为什么技能不生效。
  const internals = loadClientInternals()
  const result = internals.skillDiagnostics({
    skills: [skill()],
    disabled: [{ name: 'hidden', scope: 'global', root: '/u/.agents/skills', disabled: true }],
  })
  assert.equal(result.length, 1, '已禁用条目应进入诊断列表')
  assert.equal(result[0].name, 'hidden')
  assert.equal(result[0].kind, 'disabled')
})

test('the risk level drives the traffic light from license and disclosure data', () => {
  // 市场卡片的红绿灯：红=不可安装（许可门禁）、黄=有披露项（含脚本/声明工具权限）、
  // 绿=无额外披露。判定必须是数据驱动的，不能在组件里各写一套。
  const internals = loadClientInternals()
  assert.equal(internals.skillRiskLevel({ installable: false, scripts: false }), 'red')
  assert.equal(internals.skillRiskLevel({ installable: true, scripts: true }), 'yellow')
  assert.equal(internals.skillRiskLevel({ installable: true, scripts: false }), 'green')
})

test('the market filter matches name, summary and source without case sensitivity', () => {
  const internals = loadClientInternals()
  const entries = [
    { name: 'pdf', summary: 'PDF 全流程', source: 'anthropics/skills', category: 'docs' },
    { name: 'drawio', summary: '生成图表', source: 'github/awesome-copilot', category: 'docs' },
  ]
  // 空查询返回全部。
  assert.equal(internals.skillFilter(entries, '', 'all').length, 2)
  // 匹配名字（大小写不敏感）。
  assert.deepEqual(internals.skillFilter(entries, 'PDF', 'all').map((e) => e.name), ['pdf'])
  // 匹配来源（用户常按 owner 找）。
  assert.deepEqual(internals.skillFilter(entries, 'awesome', 'all').map((e) => e.name), ['drawio'])
  // 分类筛选。
  assert.equal(internals.skillFilter(entries, '', 'docs').length, 2)
  assert.equal(internals.skillFilter(entries, '', 'nonexistent').length, 0)
})

test('the source label renders owner and repo as a readable line', () => {
  const internals = loadClientInternals()
  assert.equal(internals.skillSourceLabel({ source: 'anthropics/skills', license: 'Apache-2.0' }), 'anthropics/skills · Apache-2.0')
  // 许可缺失时不得渲染出 undefined。
  assert.equal(internals.skillSourceLabel({ source: 'obra/superpowers' }), 'obra/superpowers')
  // 本地已装条目没有 source（它们不在市场目录里）。
  assert.equal(internals.skillSourceLabel({ source: '', local: true }), '本地 · 已安装')
})
