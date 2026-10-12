// 生成**离线 UI 预览页**，用来真看面板布局（挤压 / 变形 / 换行 / 对齐 / 窄屏 / 深浅色）。
//
// 为什么不看真机：当前跑着的 desktop profile 装的是旧包（dsh-mcp-manager-ui@1.5.0），
// 里面没有技能面 —— 改了也看不到。
//
// 三样都是**真东西**（不手搓）：
//   ① 宿主主题：deepseek-harness 的 ui-theme/src/styles/*.css —— 令牌是真值
//   ② 插件样式：scripts/theme-spec.mjs 的 extractPanelCss 从 lib/client.js 抽
//   ③ 组件 DOM：用**与 test/skills-client.test.mjs 逐字相同**的假 React + __ModuleLoader__
//      装载真 client.js，再把真组件渲染成 HTML。
//      ⚠️ 手写标记只能证明"我以为组件长这样"，会与组件漂移——第一版就是这么写的，
//      结果连场景数据都写错了（B 场景标题说「仅手动」而徽章却是「用户不可调用」）。
//
// 用法：node .tasks/_uipreview.mjs  然后浏览器打开 .tasks/_uipreview.html
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import vm from 'node:vm'
import { extractPanelCss } from '../scripts/theme-spec.mjs'

const HOST = 'D:/sudy/github/deepseek-harness/packages/client/ui-theme/src/styles'
const root = process.cwd()

// ── ①② 样式 ───────────────────────────────────────────────────────────────
const clientSource = await readFile(join(root, 'lib/client.js'), 'utf8')
const panelCss = extractPanelCss(clientSource)
let hostCss = ''
for (const f of ['base.css', 'design-platform.css', 'corner-shape.css', 'brand-font.css']) {
  hostCss += `\n/* ===== host: ${f} ===== */\n` + await readFile(join(HOST, f), 'utf8')
}

// ── ③ 真组件 → 真树（装载手法与 skills-client.test.mjs 一致）────────────────
const exportMarker = 'exports.inject = inject;'
const instrumented = clientSource.replace(
  exportMarker,
  `${exportMarker}\nexports.__p = { SkillDetail, SkillRow, SkillGroupHeader, Badge, Toggle, Btn, actionBar };`,
)
if (instrumented === clientSource) throw new Error('导出锚点失效：lib/client.js 里找不到 ' + exportMarker)

/** 与测试同源的最小假 React。 */
const stores = new Map()
let current = null
const react = {
  Fragment: Symbol('Fragment'),
  createElement(type, props, ...children) {
    const rest = props ?? {}
    const withChildren = children.length === 0 ? rest : { ...rest, children: children.length === 1 ? children[0] : children }
    return { type, props: withChildren, children }
  },
  useCallback: (cb) => cb,
  useEffect(fn) { react.__effects.push(fn) },
  useMemo: (f) => f(),
  useRef: (v) => ({ current: v }),
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
      do { store.dirty = false; store.cursor = 0; tree = Component(props); guard += 1 } while (store.dirty && guard < 50)
    } finally { current = previous }
    return tree
  },
}
let client
const fakeWindow = {
  __ModuleLoader__: { load(definition) { client = definition.factory(() => react) } },
}
vm.runInNewContext(instrumented, {
  console,
  document: { querySelector: () => null, createElement: () => ({ dataset: {} }) },
  navigator: {},
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  confirm: () => true,
  setInterval, setTimeout, clearInterval, clearTimeout, window: fakeWindow,
})
const P = client.__p

// ── 树 → HTML（类名与属性原样带过去，好让真样式生效）────────────────────────
const VOID = new Set(['input', 'br', 'hr', 'img'])
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const DROP = new Set(['key', 'onClick', 'onKeyDown', 'onSelect', 'onChange', 'onFocus', 'onRetry', 'onRemove', 'onToggle', 'onModelInvocable', 'onUserInvocable', 'onSort', 'onRefresh', 'onToggleCollapse'])

/**
 * React 的 DOM 属性名 → HTML 属性名。
 *
 * ⚠️ 有两个坑都出自"随手转一下"：
 *   ① 不转：组件写 `strokeWidth: 1.6`，透传得到小写的 `strokewidth` —— SVG 不认，
 *      stroke-width 退回默认 1，**图标看起来比真机细**（实测 computed 就是 1px）。
 *   ② 一律转 kebab：`viewBox` 会变成 `view-box` —— SVG 也不认，视口失效，
 *      于是 path 画在坐标系外，**图标整个空白**（实测「⋯」按钮就是个空框）。
 *      这正是 React 自己维护一张属性名映射表的原因。
 * 所以这里照 React 的做法：**特例表优先**，其余只把"确实是 camelCase 的"转 kebab。
 */
const SVG_ATTR_SPECIAL = {
  viewBox: 'viewBox',
  preserveAspectRatio: 'preserveAspectRatio',
  gradientUnits: 'gradientUnits',
  patternUnits: 'patternUnits',
  clipPathUnits: 'clipPathUnits',
  markerWidth: 'markerWidth',
  markerHeight: 'markerHeight',
  refX: 'refX',
  refY: 'refY',
}
const reactAttrToHtml = (name) => {
  if (name === 'className') return 'class'
  if (name === 'htmlFor') return 'for'
  if (SVG_ATTR_SPECIAL[name] !== undefined) return SVG_ATTR_SPECIAL[name]
  return /[A-Z]/.test(name) ? name.replace(/([A-Z])/g, '-$1').toLowerCase() : name
}
function toHtml(node, depth = 0) {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (Array.isArray(node)) return node.map((n) => toHtml(n, depth)).join('')
  if (typeof node === 'string' || typeof node === 'number') return esc(node)
  if (typeof node !== 'object' || node.type === undefined) return ''
  if (depth > 12) return ''
  const { type, props } = node
  if (type === react.Fragment || typeof type === 'symbol') return toHtml(props?.children, depth)
  if (typeof type === 'function') return toHtml(react.__render(type, props), depth + 1)
  const attrs = Object.entries(props ?? {})
    .filter(([k, v]) => !DROP.has(k) && k !== 'children' && typeof v !== 'function' && v !== undefined && v !== null && v !== false)
    .map(([k, v]) => ` ${reactAttrToHtml(k)}="${esc(v)}"`).join('')
  return `<${type}${attrs}>${VOID.has(type) ? '' : toHtml(props?.children, depth)}</${type}>`
}

// ── 场景：把组件的真实分支各渲一遍 ─────────────────────────────────────────
const base = {
  name: 'zhanggui', description: '端到端拥有一个开发请求；从需求澄清到验证交付',
  entry: 'zhanggui', kind: 'bundle', source: 'user-agents', scope: 'global', writable: true,
  root: 'C:\\Users\\zhanglu\\.agents\\skills',
  modelInvocable: true, userInvocable: true, enabled: true,
}
const noop = () => {}
const detail = (over, extra) => toHtml(P.SkillDetail({
  row: { ...base, ...over }, shadowedBy: null, body: { status: 'ok', text: '技能正文示例' },
  busy: false, onRetry: noop, onToggle: noop, onRemove: noop, onModelInvocable: noop, onUserInvocable: noop,
  tab: 'overview', onTab: noop, ...extra,
}))
const listRow = (over, extra) => toHtml(P.SkillRow({
  row: { ...base, ...over }, selected: false, onSelect: noop, onToggle: noop, busy: false, shadowedBy: null, twins: null, ...extra,
}))

const scenes = [
  ['详情 · 正常（模型✓ 用户✓）', detail({})],
  ['详情 · 仅手动可调用（模型✗ 用户✓）', detail({ modelInvocable: false, userInvocable: true })],
  ['详情 · 仅模型可调用（模型✓ 用户✗）', detail({ modelInvocable: true, userInvocable: false })],
  ['详情 · 已停用（两个都✗）', detail({ modelInvocable: false, userInvocable: false, enabled: false })],
  ['详情 · 旧机制残留 + 停用（徽章最多）', detail({ modelInvocable: false, userInvocable: false, enabled: false, migrated: true })],
  ['详情 · 调用权限未知（两个开关都禁用）', detail({ modelInvocable: null, userInvocable: null, enabled: null })],
  ['详情 · 内置只读', detail({ writable: false, source: 'bundled' })],
  ['详情 · 被遮蔽', detail({}, { shadowedBy: { ...base, source: 'project-dsh' } })],
  ['详情 · 超长名 + 超长路径（最挤）', detail({
    name: 'zhanggui-verification-before-completion',
    entry: 'zhanggui-verification-before-completion',
    root: 'C:\\Users\\zhanglu\\.agents\\skills\\zhanggui-verification-before-completion',
    description: '在宣称完成之前用新鲜证据证明它——真实命令输出、测试结果或一次真实运行，而不是"看着像好了"',
  })],
  ['详情 · 正文读取失败', detail({}, { body: { status: 'error', text: 'ENOENT: no such file or directory' } })],
  ['列表行 · 已启用', listRow({})],
  ['列表行 · 已停用', listRow({ modelInvocable: false, userInvocable: false, enabled: false })],
  ['列表行 · 旧机制残留', listRow({ modelInvocable: false, userInvocable: false, enabled: false, migrated: true })],
  ['列表行 · 模型面关（模型不用）', listRow({ modelInvocable: false, userInvocable: true })],
  ['列表行 · 用户面关（不可手调）', listRow({ modelInvocable: true, userInvocable: false })],
  ['列表行 · 两个面都关但未判定为停用（边角）', listRow({ modelInvocable: false, userInvocable: false, enabled: null })],
  ['列表行 · 权限未知 + 超长名', listRow({ modelInvocable: null, userInvocable: null, enabled: null, name: 'a-very-long-skill-name-that-must-not-break-the-row-layout' })],
  ['列表行 · 被遮蔽 + 两个面都有徽章', listRow({ modelInvocable: false, userInvocable: false }, { shadowedBy: { ...base, source: 'project-dsh' } })],
]

const frames = scenes.map(([label, html]) => `
  <div class="pv-scene">
    <p class="pv-note"><b>${esc(label)}</b></p>
    <!-- ⚠️ 用真容器类（.dsh-mcp-body 是详情在真面板里的父级；.dsh-mcp-detail 由组件自己带）。
         曾经这里套的是自造的 .dsh-mcp-detail-host —— 一个不存在的类，等于在**没有真容器**
         的情况下看排版（宽度约束、flex 行为都可能不同）。 -->
    <div class="pv-frame"><div class="dsh-mcp-body">${html}</div></div>
  </div>`).join('')

const out = `<!doctype html>
<html lang="zh" data-theme="light"><head><meta charset="utf-8">
<!-- ⚠️ 必须有 viewport meta：缺了它，移动端仿真会用 980px 的默认布局视口，
     于是面板自己的 @media(max-width:760px/480px) 两条断点**永远不触发**——
     第一版就是这样，量出来一切正常，其实断点根本没生效（假绿）。 -->
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>技能面板 UI 预览（真主题 + 真样式 + 真组件）</title>
<style>${hostCss}</style>
<style>${panelCss}</style>
<style>
  .pv-wrap{padding:16px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#111)}
  .pv-note{font:12px/1.6 system-ui;color:var(--dsw-alias-label-secondary,#666);margin:0 0 6px}
  .pv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(430px,1fr));gap:18px;align-items:start}
  .pv-scene{min-width:0}
  .pv-frame{border:1px solid var(--dsw-alias-border-l3,#ddd);border-radius:12px;overflow:hidden;background:var(--dsw-alias-bg-layer-1,#fff)}
  .pv-toolbar{display:flex;gap:6px;align-items:center;margin:0 0 14px;flex-wrap:wrap;position:sticky;top:0;z-index:9;background:var(--dsw-alias-bg-base,#fff);padding:6px 0}
  .pv-toolbar button{font:12px system-ui;padding:5px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l3,#ccc);background:var(--dsw-alias-bg-layer-2,#f7f7f7);cursor:pointer}
</style>
</head>
<body>
<div class="pv-wrap">
  <div class="pv-toolbar">
    <span class="pv-note" style="margin:0">真主题 + 真样式 + 真组件。窄屏：</span>
    <button data-w="720">720</button><button data-w="520">520</button>
    <button data-w="420">420</button><button data-w="340">340</button><button data-w="0">自适应</button>
    <button data-theme="dark">深色</button><button data-theme="light">浅色</button>
  </div>
  <div class="pv-grid" id="grid">${frames}</div>
</div>
<script>
  const grid = document.getElementById('grid')
  document.querySelectorAll('[data-w]').forEach((b) => b.addEventListener('click', () => {
    const w = Number(b.dataset.w)
    grid.style.gridTemplateColumns = w === 0 ? '' : 'repeat(auto-fill,minmax(' + (w + 20) + 'px,1fr))'
    grid.querySelectorAll('.pv-frame').forEach((f) => { f.style.maxWidth = w === 0 ? '' : w + 'px' })
  }))
  // ⚠️ 宿主的深色开关是 **body[data-ds-dark-theme]**（design-platform.css:85/284），
  // 不是 data-theme="dark"。第一版用错了属性名 —— 于是"深色检查"全是浅色，
  // 那种绿是假的（什么都没验到）。这里照宿主的真实选择器切。
  // 页面初始也按浅色渲染：<body> 不带该属性即浅色。
  document.querySelectorAll('[data-theme]').forEach((b) => b.addEventListener('click', () => {
    const dark = b.dataset.theme === 'dark'
    if (dark) document.body.setAttribute('data-ds-dark-theme', '')
    else document.body.removeAttribute('data-ds-dark-theme')
    document.documentElement.dataset.theme = b.dataset.theme
  }))
  // 打开即按系统的 prefers-color-scheme 选一次，免得每次手动点
  if (matchMedia('(prefers-color-scheme: dark)').matches) document.body.setAttribute('data-ds-dark-theme', '')
</script>
</body></html>`

await writeFile(join(root, '.tasks', '_uipreview.html'), out, 'utf8')
console.log('已生成 .tasks/_uipreview.html')
console.log('  导出组件：' + Object.keys(P).join(', '))
console.log('  场景：' + scenes.length + ' 个；插件样式 ' + panelCss.length + ' 字节')
