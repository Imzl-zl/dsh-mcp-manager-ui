import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

// ═══ 为什么需要这组用例 ════════════════════════════════════════════════════════
//
// 真机缺陷（用户报告）：「页签按钮还是中文」——切到 English 后，详情页签、排序菜单、
// 入口菜单、作用域标签仍是中文，而其它文案都正常。
//
// 根因不是漏翻，而是**求值时机**：这些文案住在一批**模块级常量表**里
// （ABILITY_TABS / SKILL_MODES / SORT_LABELS / ENTRY_LABELS / SCOPE_LABELS /
// SCOPE_LABEL_DETAILS）。写成 `label: t('技能')` 时，t() 在 **bundle 加载那一刻**就求值了，
// 而 active 语言要等 apply() 读到 locale 服务（并订阅后续切换）才知道。
// 于是这些表把语言**冻在加载时**，之后无论怎么切都不变——恰好是"页签还是中文"。
//
// 契约（这组用例钉的就是它）：**常量表只许存中文原文，t() 必须发生在渲染路径上**。
// 只钉行为不够——行为用例渲染不起来这些组件（测试替身的 hooks 是空实现），
// 所以这里两条腿走路：能跑的跑真行为，跑不了的钉源码形状。

const clientSource = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
const exportMarker = 'exports.inject = inject;'
// 注意：这里**不能**把表名直接摊进对象字面量——要经由 apply 之外的作用域闭包拿。
// 这些常量都在模块作用域，而 localeActive/localeT 是模块级的 let，所以注入
// 「读表 + 改语言」的函数即可（写成箭头函数，求值发生在调用时而非加载时）。
const testSurface = [
  'ABILITY_TABS',
  'SKILL_MODES',
  'SORT_LABELS',
  'ENTRY_LABELS',
  'SCOPE_LABELS',
  'SCOPE_LABEL_DETAILS',
  'EN_DICT',
  't',
  'preservedView',
  'PRESERVED_VALUE_LABEL',
  'fromFormValue',
  'contentLocale',
].join(', ')
const instrumented = clientSource.replace(
  exportMarker,
  `${exportMarker}\nexports.__i18n = {
  ${testSurface},
  setLocaleActiveForTest: (value) => { localeActive = value },
  setLocaleTForTest: (value) => { localeT = value },
};`,
)

assert.notEqual(instrumented, clientSource, 'client test export marker must stay current')

function loadI18n() {
  const react = {
    Fragment: Symbol('Fragment'),
    createElement() {},
    useCallback: (fn) => fn,
    useEffect() {},
    useMemo: (fn) => fn(),
    useRef: (value) => ({ current: value }),
    useState: (value) => [value, () => {}],
  }
  let client
  const context = {
    console,
    document: { addEventListener() {}, removeEventListener() {} },
    navigator: {},
    setInterval,
    setTimeout,
    clearInterval,
    clearTimeout,
    window: {
      isSecureContext: false,
      __ModuleLoader__: {
        load(definition) {
          client = definition.factory((name) => {
            assert.equal(name, 'react')
            return react
          })
        },
      },
    },
  }
  vm.runInNewContext(instrumented, context)
  return client.__i18n
}

test('the locale tables hold Chinese source text, not a frozen translation', () => {
  const i18n = loadI18n()

  // 每一张表的取值都必须是**中文原文**（= EN_DICT 的键），而不是某种语言的译文。
  // 只要有人在建表时写回 t(...)，这里就会看到英文（因为加载时 localeActive 是 null，
  // 而 null 时 t() 返回中文……所以这里真正的判据是下面那条行为用例；
  // 这条负责钉住"表里的值确实是词典键"这个不变量）。
  const tableValues = [
    ...Object.values(i18n.SCOPE_LABELS),
    ...Object.values(i18n.SORT_LABELS),
    ...Object.values(i18n.ENTRY_LABELS),
    ...i18n.ABILITY_TABS.map((tab) => tab.label),
    ...i18n.SKILL_MODES.map((mode) => mode.label),
  ]
  for (const value of tableValues) {
    assert.equal(typeof value, 'string', `表里的标签必须是字符串：${String(value)}`)
  }
  // 「技能」「已安装」「发现市场」这三个是页签/模式层的可见文案，必须在词典里。
  for (const key of ['技能', '已安装', '发现市场']) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(i18n.EN_DICT, key),
      `词典缺少页签文案：${key}`,
    )
  }
})

test('switching the active locale flips every table-driven label', () => {
  const i18n = loadI18n()

  const render = (key) => i18n.t(key)

  // ① 中文（或没有 locale 服务）：原样中文
  i18n.setLocaleTForTest(null)
  i18n.setLocaleActiveForTest(null)
  assert.equal(render('技能'), '技能')
  assert.equal(render('已安装'), '已安装')

  // ② English：这些**表里的**文案必须跟着变
  i18n.setLocaleActiveForTest('en')
  assert.equal(render(i18n.ABILITY_TABS.find((tab) => tab.id === 'skills').label), 'Skills')
  assert.equal(render(i18n.SKILL_MODES.find((mode) => mode.id === 'manage').label), 'Installed')
  assert.equal(render(i18n.SKILL_MODES.find((mode) => mode.id === 'market').label), 'Market')
  assert.equal(render(i18n.SORT_LABELS.name), 'By name')
  assert.equal(render(i18n.SORT_LABELS.status), 'By status')
  assert.equal(render(i18n.SORT_LABELS.default), 'Default order')
  assert.equal(render(i18n.ENTRY_LABELS.fab), 'Floating button only')
  assert.equal(render(i18n.ENTRY_LABELS.sidebar), 'Sidebar entry only')
  assert.equal(render(i18n.ENTRY_LABELS.both), 'Floating button + sidebar entry')
  assert.equal(render(i18n.SCOPE_LABELS.custom), 'Custom directory')
  assert.equal(render(i18n.SCOPE_LABELS.bundled), 'Built-in (read-only)')
  assert.equal(render(i18n.SCOPE_LABELS['project-agents']), 'Project · .agents/skills')

  // ③ 再切回中文：必须回到中文（语言是**每次渲染读的**，不是一次性求值的）
  i18n.setLocaleActiveForTest('zh')
  assert.equal(render('技能'), '技能')
  assert.equal(render(i18n.SKILL_MODES.find((mode) => mode.id === 'market').label), '发现市场')
})

test('every label a table can produce is covered by the dictionary', () => {
  // 表里的值若不在词典里，界面就会漏出中文（t() 原样返回键）。
  // 例外是**刻意的**：路径片段与专有名词（'.dsh/skills'、'MCP'）本来就该原样显示。
  const i18n = loadI18n()
  const intentional = new Set(['.dsh/skills', '.agents/skills', 'MCP'])

  const reachable = [
    ...Object.values(i18n.SCOPE_LABELS),
    ...Object.values(i18n.SCOPE_LABEL_DETAILS),
    ...Object.values(i18n.SORT_LABELS),
    ...Object.values(i18n.ENTRY_LABELS),
    ...i18n.ABILITY_TABS.map((tab) => tab.label),
    ...i18n.SKILL_MODES.map((mode) => mode.label),
  ]

  const uncovered = reachable.filter(
    (key) => !Object.prototype.hasOwnProperty.call(i18n.EN_DICT, key) && !intentional.has(key),
  )
  assert.deepEqual(uncovered, [], '表里的这些文案没有英文，英文界面下会显示中文')
})

test('the shared segment control translates labels at render time', () => {
  // ⚠️ 这条是**行为缺陷的精确闸门**，别删。
  //
  // 真机缺陷的成因不是「表里写了 t()」——表里写不写 t() 都不致命：
  // 加载时 localeActive 是 null，t() 返回中文原文，渲染时再过一次 t() 照样能翻。
  // 致命的是**渲染路径上根本没有 t()**：seg() 直接渲染 item.label，于是表里是什么就画什么。
  // 所以判据必须钉在 seg 的渲染点上。
  const segStart = clientSource.indexOf('const seg = (items, active, onSelect, label)')
  assert.ok(segStart > 0, '找不到 seg() 的定义')
  const segBody = clientSource.slice(segStart, clientSource.indexOf('ABILITY_TABS.map', segStart))

  assert.match(
    segBody,
    /t\(item\.label\)/,
    'seg() 必须把 item.label 过 t()：能力层与模式层都靠这一个渲染点，'
      + '直接画 item.label 会让页签在任何语言下都停在表里的原文（真机缺陷）。',
  )
  assert.doesNotMatch(
    segBody,
    /^\s*item\.label,\s*$/m,
    'seg() 不得直接渲染未翻译的 item.label',
  )
})

test('no translation is evaluated at module scope', () => {
  // 形状闸：模块级（顶格 const/let/var 初始化）不得出现 t(...)。
  // 渲染路径上的 t() 都在函数体里（缩进），所以「顶格且紧跟在 = 后」是可靠的判据。
  // 例外仅有 PRESERVED_VALUE_LABEL —— 它是**哨兵数据**而非文案，刻意保持中文原文，
  // 见 lib/client.js 里那段注释（它靠 === 比较并要还原成 REDACTED_VALUE 送回宿主）。
  const offenders = []
  clientSource.split('\n').forEach((line, index) => {
    if (!/^(?:const|let|var)\s/.test(line)) return            // 只看顶格声明
    if (!/\bt\(/.test(line)) return                            // 只看含 t( 的
    if (/PRESERVED_VALUE_LABEL/.test(line)) return             // 哨兵是数据，允许
    if (/=>/.test(line)) return                                // 箭头函数体，求值在调用时
    offenders.push(`${index + 1}: ${line.trim().slice(0, 110)}`)
  })
  assert.deepEqual(
    offenders,
    [],
    '模块级不得求值 t()：那会把语言锁死在 bundle 加载那一刻（页签/菜单停在中文的成因）。'
      + '请改成「表里存中文原文，在渲染处 t(item.label)」。',
  )
})

test('the preserved-value sentinel stays language-independent but renders translated', () => {
  const i18n = loadI18n()
  const sentinel = i18n.PRESERVED_VALUE_LABEL

  // 哨兵本身恒为中文原文：它是**数据**（要 `===` 比较、要还原成 REDACTED_VALUE 送回宿主），
  // 一旦随语言变化，英文界面下编辑一次表单就会把它当作用户手输的字面量写进配置。
  assert.equal(sentinel, '••••••（保留原值）')

  // 但**显示**形态要跟语言走。
  i18n.setLocaleActiveForTest('en')
  assert.equal(i18n.preservedView(), '•••••• (keep existing value)')
  // 并且两种形态都要能还原（用户碰过字段后 state 里可能是显示形态）。
  assert.equal(i18n.fromFormValue(sentinel), '__DSH_MCP_REDACTED__')
  assert.equal(i18n.fromFormValue(i18n.preservedView()), '__DSH_MCP_REDACTED__')
  // 真实用户输入不能被误判成哨兵。
  assert.equal(i18n.fromFormValue('sk-live-abc'), 'sk-live-abc')

  i18n.setLocaleActiveForTest('zh')
  assert.equal(i18n.preservedView(), '••••••（保留原值）')
})

test('market copy stays Chinese by default and only follows an explicit "en"', async () => {
  // 市场条目的文案来自上游的**两份字段**（description 是发布方原文、description_zh 是平台中文版）。
  // 约束（用户明确要求）：**中文默认不能变**。所以：
  //   · 不传 locale（老面板 / 中文界面）→ 与改前逐字节一致，仍优先 _zh；
  //   · 传 'en' → 才取发布方原文；
  //   · 缺字段时双向回落，绝不给出空文案。
  const { normalizeHubSkill, hubSkillDetail } = await import('../lib/skillhub.js')

  const both = { slug: 'x', name: 'N', description: 'English text', description_zh: '中文文本' }
  assert.equal(normalizeHubSkill(both).summary, '中文文本', '默认必须是中文（改前行为）')
  assert.equal(normalizeHubSkill(both, 'zh').summary, '中文文本')
  assert.equal(normalizeHubSkill(both, 'en').summary, 'English text')
  assert.equal(normalizeHubSkill(both, 'en-US').summary, 'English text', '带地区的 en 也算英文')

  // 只有中文（发布方本来就用中文写）：英文侧回落，不能变空
  assert.equal(normalizeHubSkill({ slug: 'y', description_zh: '只有中文' }, 'en').summary, '只有中文')
  // 只有原文：中文侧回落（改前就是靠 `||` 回落的，行为不变）
  assert.equal(normalizeHubSkill({ slug: 'z', description: 'only english' }).summary, 'only english')

  // 详情走同一条规则（summary / summary_zh）。
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ skill: { summary: 'English summary', summary_zh: '中文摘要' } }),
  })
  assert.equal((await hubSkillDetail('s', { fetch: fakeFetch })).summary, '中文摘要', '详情默认也是中文')
  assert.equal((await hubSkillDetail('s', { fetch: fakeFetch, locale: 'en' })).summary, 'English summary')
})

test('the client only sends a locale when it is English', () => {
  // 送给宿主的字段必须**只在英文时才出现**：缺省即中文优先，所以中文路径连字段都不带，
  // 这样「中文默认不变」在 wire 上就是显然的，而不是靠宿主那边的默认值兜。
  const i18n = loadI18n()
  assert.equal(typeof i18n.contentLocale, 'function', 'client 需要暴露 contentLocale()')

  i18n.setLocaleActiveForTest(null)
  assert.equal(i18n.contentLocale(), undefined, '没有 locale 服务 → 不带字段')
  i18n.setLocaleActiveForTest('zh')
  assert.equal(i18n.contentLocale(), undefined, '中文 → 不带字段')
  i18n.setLocaleActiveForTest('en')
  assert.equal(i18n.contentLocale(), 'en')
  i18n.setLocaleActiveForTest('en-GB')
  assert.equal(i18n.contentLocale(), 'en')
})
