// 详情页签：把「头与页签固定、只有正文滚」这件事钉住。
//
// 为什么需要单独一组用例：这两个详情组件（MCP 的 ServerDetail、技能的 SkillDetail）
// 此前是**一根长条**——head、操作按钮、正文卡片全在同一个 overflow-y:auto 的容器里，
// 卡片一多就「滚动一下按钮就没了」。改成页签之后有三条容易静默退化的性质：
//
//   1. 三个页签的内容**全部渲染**，只用 class 关掉非当前的。
//      这是别处既有断言（「详情必须画出技能正文」「详情必须画出真实根目录」）的前提：
//      如果改成只渲染当前页，那些断言会在默认页上看不到正文而变红——或者更糟，
//      被改成只断言当前页，于是「正文到底渲没渲染」再也没人管。
//   2. 硬错误（server.lastError）不进页签。它是「为什么这行是红的」的直接答案，
//      藏到一次点击后面等于把诊断成本转嫁给最需要它的人。
//   3. 切换条目要回到第一页：上一台的页签选择对新的一台没有意义。
//
// 页面结构的断言用类名定位，行为断言用假 React 的 __render（它会消化 setter 触发的重渲染）。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const clientSource = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
const exportMarker = 'exports.inject = inject;'
const instrumentedClient = clientSource.replace(
  exportMarker,
  `${exportMarker}\nexports.__panes = { ServerDetail, ServerDetailPane, SkillDetail, SkillDetailPane };`,
)
assert.notEqual(instrumentedClient, clientSource, 'client test export marker must stay current')

/** 假 React：与 skills-client.test.mjs 同一手法（useState 跨重渲染保留，setter 置脏）。 */
function loadInternals() {
  const stores = new Map()
  let current = null
  const react = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) {
      const rest = props ?? {}
      return {
        type,
        props: children.length === 0 ? rest : { ...rest, children: children.length === 1 ? children[0] : children },
        children,
      }
    },
    useCallback: (callback) => callback,
    useEffect(fn) { react.__effects.push(fn) },
    useMemo: (factory) => factory(),
    useRef: (value) => ({ current: value }),
    useState(initial) {
      const store = current
      const index = store.cursor
      store.cursor += 1
      if (index >= store.values.length) store.values[index] = typeof initial === 'function' ? initial() : initial
      const set = (next) => {
        const value = typeof next === 'function' ? next(store.values[index]) : next
        if (value !== store.values[index]) { store.values[index] = value; store.dirty = true }
      }
      return [store.values[index], set]
    },
    __effects: [],
    __render(Component, props) {
      let store = stores.get(Component)
      if (store === undefined) { store = { values: [], cursor: 0, dirty: false }; stores.set(Component, store) }
      let tree
      let guard = 0
      const previous = current
      current = store
      try {
        do {
          store.dirty = false
          store.cursor = 0
          tree = Component(props)
          guard += 1
        } while (store.dirty && guard < 50)
      } finally {
        current = previous
      }
      return tree
    },
  }
  let client
  vm.runInNewContext(instrumentedClient, {
    console,
    document: { querySelector: () => null, createElement: () => ({ dataset: {} }) },
    navigator: {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setInterval,
    setTimeout,
    clearInterval,
    clearTimeout,
    window: { __ModuleLoader__: { load(definition) { client = definition.factory(() => react) } } },
  })
  return {
    ...client.__panes,
    __render: react.__render,
    __drainEffects() { for (const effect of react.__effects.splice(0)) effect() },
  }
}

/** 收集满足谓词的节点。 */
function collectAll(tree, predicate, out = []) {
  if (tree === null || tree === undefined || typeof tree !== 'object') return out
  if (Array.isArray(tree)) { for (const child of tree) collectAll(child, predicate, out); return out }
  if (predicate(tree)) out.push(tree)
  for (const child of tree.children ?? []) collectAll(child, predicate, out)
  return out
}

const classOf = (node) => String(node?.props?.className ?? '')
const hasClass = (node, cls) => classOf(node).split(/\s+/).includes(cls)
const byClass = (tree, cls) => collectAll(tree, (node) => hasClass(node, cls))
const textOf = (node, out = []) => {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out }
  if (Array.isArray(node)) { for (const child of node) textOf(child, out); return out }
  for (const value of Object.values(node.props ?? {})) {
    if (typeof value === 'string' || typeof value === 'number') out.push(String(value))
  }
  for (const child of node.children ?? []) textOf(child, out)
  return out
}
/** 只取**子节点里的文字**，不含 props 值。
 *  textOf 会把 className/role/type 这类 props 也收进来（对「显示了什么」够用），
 *  但页签文案要逐字比对，混进 `button`/`tab` 就没法比。 */
const childText = (node, out = []) => {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out }
  if (Array.isArray(node)) { for (const child of node) childText(child, out); return out }
  for (const child of node.children ?? []) childText(child, out)
  return out
}

const server = (over = {}) => ({
  serverName: 'chrome-devtools', transport: 'stdio', enabled: true, status: 'connected',
  managed: true, scope: 'global', toolCount: 2, refs: 0, env: {}, headers: {}, ...over,
})
const tools = [{ name: 'a', description: '工具 A' }, { name: 'b', description: '工具 B' }]
const serverProps = (over = {}) => ({
  server: server(), tools, onToggle() {}, onReconnect() {}, onEdit() {}, onRemove() {},
  busy: false, onReveal() {}, revealed: {}, onCopy() {}, excluded: false, onToggleExclude() {}, ...over,
})

const skillRow = (over = {}) => ({
  name: 'zhanggui', description: '端到端统筹', source: 'user-agents', scope: 'global',
  root: '/home/u/.agents/skills', enabled: true, writable: true,
  modelInvocable: true, userInvocable: true, ...over,
})
const skillProps = (over = {}) => ({
  row: skillRow(), shadowedBy: null, body: { status: 'ok', text: '正文内容' },
  busy: false, onRetry() {}, onToggle() {}, onRemove() {}, ...over,
})

test('MCP 详情：三个页签的内容都渲染，只有当前页参与布局', () => {
  const { ServerDetail } = loadInternals()
  const tree = ServerDetail(serverProps())

  const panes = byClass(tree, 'dsh-mcp-d-body')[0].children.filter((node) => node && typeof node === 'object')
  assert.equal(panes.length, 3, '正文区应当有三个页签容器')
  const off = panes.filter((node) => hasClass(node, 'dsh-mcp-pane-off'))
  assert.equal(off.length, 2, '默认页之外的两页必须被关掉，否则正文里会出现空洞')
  assert.ok(hasClass(panes[0], 'dsh-mcp-card') && !hasClass(panes[0], 'dsh-mcp-pane-off'), '默认页是概览（连接信息）')

  const text = textOf(tree).join(' | ')
  // ToolRow 是组件、不会被展开，所以断言落在它所在卡片的标题上——那已足够证明
  // 「被关掉的那一页照样渲染了内容」。
  assert.match(text, /工具（2）/, '非当前页的内容也必须渲染——只渲染当前页会让「详情画出工具」这类断言失去意义')
  assert.match(text, /未检测到配置层冲突/, '诊断页为空时要有中性说明，而不是留一片空白')
})

test('MCP 详情：页签行给出名称与计数，且只有当前页高亮', () => {
  const { ServerDetail } = loadInternals()
  const tree = ServerDetail(serverProps({ tab: 'tools' }))
  const tabs = byClass(tree, 'dsh-mcp-tab')
  assert.equal(tabs.length, 3, '页签行应当有三个页签')
  assert.deepEqual(tabs.map((node) => childText(node).join('')), ['概览', '工具2', '诊断'], '计数要跟着真实数据走')
  assert.ok(!hasClass(tabs[0], 'sel') && hasClass(tabs[1], 'sel') && !hasClass(tabs[2], 'sel'), '选中态只能有一个')
  assert.equal(tabs[1].props['aria-selected'], true, '选中态不能只靠颜色表达')
})

test('MCP 详情：硬错误不进页签，换页也看得见', () => {
  const { ServerDetail } = loadInternals()
  const tree = ServerDetail(serverProps({ tab: 'tools', server: server({ lastError: 'ECONNREFUSED 127.0.0.1:5432' }) }))

  const logs = byClass(tree, 'dsh-mcp-log')
  assert.equal(logs.length, 1, '应当只有一条硬错误块')
  assert.match(textOf(logs[0]).join(''), /ECONNREFUSED/, '错误原文要照说')
  // 关键性质：它不在任何被关掉的页签里——否则「切到工具页就看不到失败原因」。
  const body = byClass(tree, 'dsh-mcp-d-body')[0]
  assert.ok(!collectAll(body, (node) => node === logs[0]).length, '硬错误必须留在页签之上，不能被收进正文区')
})

test('MCP 详情：宿主组件把页签点得动，换台 server 回到概览', () => {
  const internals = loadInternals()
  const { ServerDetailPane, ServerDetail } = internals
  // __render 只跑一层：拿到的还是 { type: ServerDetail, props } 这个组件节点，
  // 要再看它渲染出的元素，得再展开一层。
  const pane = (props) => internals.__render(ServerDetail, internals.__render(ServerDetailPane, props).props)
  const tabAt = (node, label) => byClass(node, 'dsh-mcp-tab').find((tab) => childText(tab).join('').startsWith(label))
  let tree = pane(serverProps())
  assert.ok(!hasClass(byClass(tree, 'dsh-mcp-card')[0], 'dsh-mcp-pane-off'), '初始落在概览')

  internals.__render(ServerDetailPane, serverProps()).props.onTab('tools')
  tree = pane(serverProps())
  assert.ok(hasClass(tabAt(tree, '工具'), 'sel'), '点了「工具」就该切过去')

  // 换一台 server：页签回到概览。⚠️ 假 React 不做 deps 比对，effect 要手动 drain 一次。
  const other = serverProps({ server: server({ serverName: 'firecrawl' }) })
  internals.__drainEffects()
  internals.__render(ServerDetailPane, other)
  internals.__drainEffects()
  tree = pane(other)
  assert.ok(hasClass(tabAt(tree, '概览'), 'sel'), '换条目后必须回到第一页')
})

test('技能详情：与 MCP 详情共用同一套头部原语，正文与根路径照样渲染', () => {
  const { SkillDetail } = loadInternals()
  const tree = SkillDetail(skillProps())
  for (const cls of ['dsh-mcp-detail', 'dsh-mcp-d-head', 'dsh-mcp-d-title', 'dsh-mcp-d-name', 'dsh-mcp-d-meta', 'dsh-mcp-d-actions', 'dsh-mcp-d-body'])
    assert.equal(byClass(tree, cls).length, 1, `技能详情必须复用 ${cls}，否则切换能力层时按钮会换位置`)

  const panes = byClass(tree, 'dsh-mcp-d-body')[0].children.filter((node) => node && typeof node === 'object')
  assert.equal(panes.filter((node) => hasClass(node, 'dsh-mcp-pane-off')).length, 2, '默认只开一页')
  const text = textOf(tree).join(' | ')
  assert.match(text, /\/home\/u\/\.agents\/skills/, '根路径要在概览页里渲染出来')
  assert.match(text, /正文内容/, '正文要在正文页里渲染出来——分页不能把它们藏掉')
})

test('技能详情：被遮蔽时诊断页有内容、计数为 1；正常时是中性说明', () => {
  const { SkillDetail } = loadInternals()
  const tabAt = (node, label) => byClass(node, 'dsh-mcp-tab').find((tab) => childText(tab).join('').startsWith(label))
  const tree = SkillDetail(skillProps({ shadowedBy: skillRow({ source: 'project-agents', scope: 'project' }) }))
  assert.equal(childText(tabAt(tree, '诊断')).join(''), '诊断1', '有遮蔽时诊断页要带计数，否则没人会去点它')
  assert.match(textOf(tree).join(' | '), /同名遮蔽/)

  const clean = SkillDetail(skillProps())
  assert.equal(childText(tabAt(clean, '诊断')).join(''), '诊断')
  // 不能断言「文本里没有『同名遮蔽』」——中性说明本身写的就是「未检测到跨作用域同名遮蔽」。
  // 要断言的是那个告警框没有渲染出来。
  assert.equal(byClass(clean, 'dsh-skills-risk').length, 0, '没遮蔽时不该摆一个空的告警框')
  assert.equal(byClass(clean, 'dsh-mcp-d-note').length, 1, '没遮蔽时给一句中性说明')
})

test('技能详情：只读技能的两个动作都禁用，并给出原因', () => {
  const { SkillDetail } = loadInternals()
  const tree = SkillDetail(skillProps({ row: skillRow({ writable: false }) }))
  const actions = byClass(tree, 'dsh-mcp-d-actions')[0]
  assert.match(textOf(tree).join(' | '), /内置只读/, '只读要在头部标出来')
  for (const button of collectAll(actions, (node) => node.type === 'button' || node.type?.name === 'Btn'))
    assert.equal(button.props.disabled, true, '内置技能只读：停用 / 删除都必须禁用')
})

test('技能详情：宿主组件把页签点得动，换一行回到概览', () => {
  const internals = loadInternals()
  const { SkillDetailPane, SkillDetail } = internals
  const pane = (props) => internals.__render(SkillDetail, internals.__render(SkillDetailPane, props).props)
  const tabAt = (node, label) => byClass(node, 'dsh-mcp-tab').find((tab) => childText(tab).join('').startsWith(label))
  assert.ok(!hasClass(byClass(pane(skillProps()), 'dsh-mcp-card')[0], 'dsh-mcp-pane-off'), '初始落在概览')

  internals.__render(SkillDetailPane, skillProps()).props.onTab('text')
  assert.ok(hasClass(tabAt(pane(skillProps()), '技能正文'), 'sel'), '点了「技能正文」就该切过去')

  const other = skillProps({ row: skillRow({ name: 'decision-notes' }) })
  internals.__drainEffects()
  internals.__render(SkillDetailPane, other)
  internals.__drainEffects()
  assert.ok(hasClass(tabAt(pane(other), '概览'), 'sel'), '换一行后必须回到第一页')
})
