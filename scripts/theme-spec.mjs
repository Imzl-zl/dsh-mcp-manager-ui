// 面板样式表对 DSH 主题契约的合规扫描。断言在 test/theme-contract.test.mjs。
//
// 放在 scripts/ 而不是 test/：`node --test` 会把 test/ 下每个 .mjs 都当测试执行，
// 扫描器不需要每次跑测试都被当成一个"测试文件"加载一次。
//
// 判据不是自创的，逐条对齐 DSH 自己的 spec（`deepseek-harness`
// `packages/client/ui-theme/tests/`），语义保持一致，好让上游规则收紧时能直接比对：
//
//   corner-shape-styles.client.spec.ts
//     全圆角（50% / 100% / ≥99px）必须与 `corner-shape: round` 同规则出现。ui-theme 的
//     corner-shape.css 在 `@supports` 里用通用选择器 `*` 给**整个文档**套
//     superellipse(1.5)；插件渲染在同一个文档里，所以没配对的圆点会被压方、药丸会被削平
//     两端。这条只在支持 corner-shape 的引擎上显形，jsdom 渲染不出来，只能扫文本。
//
//   radius-styles.client.spec.ts
//     组件不得自造圆角：`>4px 且 <99px` 的字面值判为违规（≤4px 属绘图细节，≥99px 属
//     全圆角），引用的 `--dsw-radius-*` 必须是真实存在的刻度。
//
//   elevation-styles.client.spec.ts
//     中性边框（`--dsw-alias-border-*`）不得与 elevation/lv 阴影并用：抬升表面的发丝描边
//     画在阴影里、组件配 `border: 0`，否则轮廓画两遍且边框宽度撑动布局。状态色边框
//     （`.err` 之类）不在管辖内，仍是真的边框。
//
//   docs/web-styling.md
//     特性组件只消费语义令牌，不复制静态色板、不写字面色值。
//
// 本插件的落地方式是在别名层把要用的令牌一次性收成 `--mcp-*`，后面的规则只引用别名。
// 于是判据分两级：① 别名层之外的规则不得出现字面圆角／字面色值／字面等宽字体栈；
// ② 别名层的每个 `--mcp-*` 必须指向真实存在的 DSH 令牌，且引用到的别名都已声明。
//
// 已知边界：声明按 `;` 切分、按第一个 `:` 拆属性值，因此值里含裸 `;`（data URI 之类）
// 会误判。真实样式表的圆角声明里不含逗号，所以不影响判定；含逗号的写法（`:is(.a,.b)`、
// `[x="a,b"]`、data URI）要在引入真正的 CSS 解析器时一并解决，不要在这里加特例。
// `@keyframes` 的帧（`from` / `50%`）会被当成叶子规则，属性名都带 `opacity`/`transform`
// 这类前缀，落不进本文件的任何判据，因此无影响。

import { DSH_THEME_TOKENS } from './dsh-theme-tokens.mjs'

/** DSH 圆角刻度，取自 ui-theme/src/styles/base.css（xs:4 sm:8 md:12 lg:16 xl:20 panel:28）。 */
const RADIUS_TOKENS = new Set(
  [...DSH_THEME_TOKENS].filter((token) => token.startsWith('--dsw-radius-')),
)

/**
 * 一个令牌名是否真实可解析。
 *
 * **查清单，不查前缀**——这是本文件最容易做错的一条：`--dsw-alias-font-mono` 这类名字
 * 前缀完全合法、看着也很像，实际全仓没有定义，`var()` 取到空值（生态里 `dsh-market`
 * 就踩了这个坑）。两处判据（`aliasContract` 与 `unscaledRadii`）共用这一个原语，
 * 免得各自演化出不同的宽松度。
 *
 * @param {string} name - 令牌名。
 * @param {Map<string, string>} declared - 本样式表别名层已声明的 `--mcp-*`。
 * @returns {boolean} 该令牌要么是宿主主题令牌，要么在本样式表里声明过。
 */
function tokenExists(name, declared) {
  return DSH_THEME_TOKENS.has(name) || declared.has(name)
}

/**
 * `--mcp-*` 别名层必须落在这个选择器上。
 *
 * 两个约束同时成立才安全，而且两个方向都踩过一次：
 *
 * ① 必须是三个 slot 子树的公共祖先。本插件同时往 `shell.overlay`（悬浮按钮）、
 *    `sidebar.footer.action`（侧栏入口）和面板自己渲染，它们没有公共祖先。最初挂在
 *    `.dsh-mcp-wrap` 上——把圆角改走 `--mcp-r-*` 后，悬浮按钮的圆角与阴影当场解析失败。
 * ② 必须与主题令牌同层。ui-theme 把 `--dsw-alias-*` 定义在 **body** 上
 *    （design-platform.css 的 `body{}` / `body[data-ds-dark-theme]{}`；ui-layout 也是
 *    `body.setAttribute('data-ds-dark-theme','')`）。自定义属性在声明处就完成替换、不参与
 *    "向上查找"，所以挂在 `:root`（body 的祖先）会取到空值——整片颜色别名失效，卡片与
 *    面板背景全部变透明。
 */
const ALIAS_HOST = 'body'

/** 三个互不相邻的 slot 子树各自的根选择器：各自都要能取到文字色。 */
const SLOT_SUBTREES = [
  '.dsh-mcp-fab',
  '.dsh-mcp-footer-action',
  '.dsh-mcp-toast',
  '.dsh-mcp-wrap',
  '.dsh-mcp-panel-overlay',
  '.dsh-mcp-overlay',
]

const LITERAL_COLOR = /(#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\()/
const MONO_STACK = /ui-monospace|SFMono|Menlo|Consolas/
const LABEL_COLOR = 'var(--dsw-alias-label-primary)'

/** 从 lib/client.js 源码里取出 MCP_CSS 模板字面量。 */
export function extractPanelCss(clientSource) {
  // 容忍 CRLF：结尾是 `` `; `` 加换行。
  const match = /const MCP_CSS = `([\s\S]*?)`;\s*\n/.exec(clientSource)
  if (!match) throw new Error('lib/client.js: 找不到 MCP_CSS 模板字面量')
  return match[1]
}

/**
 * 从样式表文本里解析出叶子规则。
 *
 * 面板 CSS 是压缩过的，一行挤着好几条规则，`@media` 里还嵌着覆盖规则——所以必须按花括号
 * 配对来切，不能按行切（按行切会让选择器和声明张冠李戴）。
 *
 * @param {string} css - 样式表文本。
 * @returns {{selectors: string[], at: string[], declarations: [string, string][]}[]} 叶子规则，按出现顺序。
 */
export function parseRules(css) {
  const rules = []
  walk(css.replace(/\/\*[\s\S]*?\*\//g, ' '), [], rules)
  return rules
}

/** 递归下降：展开 @media / @supports，记录每条叶子规则的 at 上下文。 */
function walk(text, at, out) {
  let prelude = ''
  let i = 0
  while (i < text.length) {
    if (text[i] !== '{') {
      if (text[i] !== '}') prelude += text[i]
      i += 1
      continue
    }
    let depth = 1
    let j = i + 1
    while (j < text.length && depth > 0) {
      if (text[j] === '{') depth += 1
      else if (text[j] === '}') depth -= 1
      j += 1
    }
    const body = text.slice(i + 1, j - 1)
    const head = prelude.trim()
    if (head.startsWith('@') || body.includes('{')) walk(body, [...at, head], out)
    else out.push({ selectors: splitSelectors(head), at, declarations: parseDeclarations(body) })
    prelude = ''
    i = j
  }
}

/** 选择器按顶层逗号切分。 */
function splitSelectors(head) {
  return head.split(',').map((part) => part.trim()).filter(Boolean)
}

/** 声明按 `;` 切分，再各按第一个 `:` 拆成属性与值。 */
function parseDeclarations(body) {
  const out = []
  for (const chunk of body.split(';')) {
    const piece = chunk.trim()
    const at = piece.indexOf(':')
    if (at > 0) out.push([piece.slice(0, at).trim(), piece.slice(at + 1).trim()])
  }
  return out
}

/** 值是 `var(--x)` 形态时取出其中的令牌名。 */
function varReferences(value) {
  return [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1])
}

/**
 * 别名层规则 = 落在 `ALIAS_HOST` 上、且声明了自定义属性 `--mcp-*` 的那条。
 *
 * 从**已解析的规则列表**里挑，不接受 css 文本：每次 `parseRules` 都产生新对象，跨两次解析
 * 比较对象同一性永远不相等（用选择器匹配又会连坐同一选择器下的其他规则）。
 *
 * @param {object[]} rules - `parseRules` 的结果。
 * @returns {object|undefined} 别名层规则。
 */
function aliasRuleOf(rules) {
  return rules.find((rule) => rule.selectors.includes(ALIAS_HOST)
    && rule.declarations.some(([property]) => property.startsWith('--mcp-')))
}

/** 别名层声明的 `--mcp-*` → 值。 */
export function aliasDeclarations(css) {
  const rule = aliasRuleOf(parseRules(css))
  return new Map(rule ? rule.declarations.filter(([property]) => property.startsWith('--mcp-')) : [])
}

/** 别名层实际落在哪个选择器上；没有别名层时为 null。 */
export function aliasHost(css) {
  const rules = parseRules(css).filter((rule) =>
    rule.declarations.some(([property]) => property.startsWith('--mcp-')))
  const hosts = [...new Set(rules.flatMap((rule) => rule.selectors))]
  return hosts.length === 1 ? hosts[0] : (hosts.join(', ') || null)
}

/** 取不到 label 色的 slot 子树（文字会跟着主题丢失可读性）。 */
export function subtreesMissingLabelColor(css) {
  const rules = parseRules(css)
  return SLOT_SUBTREES.filter((selector) => !rules.some((rule) =>
    rule.selectors.includes(selector)
    && rule.declarations.some(([property, value]) => property === 'color' && value === LABEL_COLOR)))
}

/**
 * 规则级违规：逐条规则判定，跳过别名层。
 * @param {string} css - 样式表文本。
 * @param {(rule: object) => boolean} match - 命中即违规。
 * @returns {string[]} 违规规则的可读标识。
 */
function ruleViolations(css, match) {
  const rules = parseRules(css)
  const alias = aliasRuleOf(rules)
  return rules.filter((rule) => rule !== alias && match(rule)).map(describe)
}

/**
 * 声明级违规：精确到某条属性。
 *
 * @param {string} css - 样式表文本。
 * @param {(declaration: [string, string]) => boolean} match - 命中即违规。
 * @param {{includeAlias?: boolean}} [options] - `includeAlias` 为真时连别名层一起查
 *   （字面色值需要；圆角刻度不需要，别名层只做 `var()` 映射）。
 * @returns {string[]} 违规项的 `<selectors>: <property>: <value>`。
 */
function declarationViolations(css, match, options = {}) {
  const rules = parseRules(css)
  const alias = aliasRuleOf(rules)
  return rules
    .filter((rule) => options.includeAlias === true || rule !== alias)
    .flatMap((rule) => rule.declarations
      .filter(match)
      .map(([property, value]) => `${describe(rule)}: ${property}: ${value}`))
}

/** 违规项的可读标识：`@media (...) .a, .b`。 */
function describe(rule) {
  return [...rule.at, rule.selectors.join(', ')].join(' ')
}

/**
 * 全圆角缺 `corner-shape: round` 配对的规则。
 * @param {string} css - 样式表文本。
 * @returns {string[]} 违规规则的可读标识，按出现顺序。
 */
export function unpairedFullRound(css) {
  return ruleViolations(css, (rule) => {
    const radii = rule.declarations.filter(([property]) => /radius$/.test(property))
    const full = radii.some(([, value]) =>
      value.split(/\s+/).some((part) =>
        part === '50%' || part === '100%' || (part.endsWith('px') && Number.parseFloat(part) >= 99)))
    const paired = rule.declarations.some(([property, value]) => property === 'corner-shape' && value === 'round')
    return full && !paired
  })
}

/**
 * 自造圆角，或引用了不存在刻度的规则。
 * @param {string} css - 样式表文本。
 * @returns {string[]} 违规项的 `<selectors>: <property>: <value>`。
 */
export function unscaledRadii(css) {
  const declared = aliasDeclarations(css)
  return declarationViolations(css, ([property, value]) => {
    if (!/^border(?:-[\w-]+)?-radius$/.test(property)) return false
    const literal = [...value.matchAll(/\b(\d+(?:\.\d+)?)px\b/g)]
      .some(([, number]) => Number(number) > 4 && Number(number) < 99)
    // 圆角要么是绘图细节／全圆的字面值，要么引用刻度本身（--dsw-radius-*）或收口到刻度的
    // 别名（--mcp-r-*）。引用谁都要真实存在——判据与 aliasContract 共用 tokenExists()。
    const missing = varReferences(value)
      .filter((name) => name.startsWith('--dsw-radius-') || name.startsWith('--mcp-r-'))
      .some((name) => !tokenExists(name, declared))
    return literal || missing
  })
}

/**
 * 中性边框与 elevation 阴影并用的规则。
 *
 * 别名层之外的规则写的是 `var(--mcp-line)` 而不是 `--dsw-alias-border-*`，所以要同时认
 * 两种写法——否则本仓库最常见的形态恰好扫不到（变异测试发现的漏网）。
 *
 * @param {string} css - 样式表文本。
 * @returns {string[]} 违规规则的可读标识。
 */
export function neutralBordersBesideElevation(css) {
  return ruleViolations(css, (rule) => {
    const elevated = rule.declarations.some(([property, value]) =>
      property === 'box-shadow' && /--dsw-(?:shadow-lv|elevation-)/.test(value))
    if (!elevated) return false
    return rule.declarations.some(([property, value]) =>
      property.startsWith('border')
      && !property.startsWith('border-radius')
      && /--dsw-alias-border-|--mcp-line/.test(value))
  })
}

/**
 * 字面色值（hex / rgb / hsl）。
 *
 * 别名层也要查：它是唯一允许写 `var()` 映射的地方，但**不允许出现字面值**——令牌在
 * ui-theme 里已经算好明暗两套，在别名层写死颜色等于把主题跟随关掉，而且只有真实浏览器
 * 才看得出来。带 fallback 的 `var(--dsw-x, #fff)` 仍然放行（那正是官方推荐的写法）。
 *
 * @param {string} css - 样式表文本。
 * @returns {string[]} 违规项的 `<selectors>: <property>: <value>`。
 */
export function literalColors(css) {
  return declarationViolations(css, ([property, value]) => {
    if (!LITERAL_COLOR.test(value)) return false
    if (!property.startsWith('--mcp-')) return true
    // 别名层：只放行 var() 里作为 fallback 出现的字面值，例如
    // `--mcp-mono:var(--dsw-font-mono,ui-monospace,...)`。
    return !/^var\([^)]*\)$/.test(value)
  }, { includeAlias: true })
}

/**
 * 字面等宽字体栈（应改走 `--mcp-mono`）。
 * @param {string} css - 样式表文本。
 * @returns {string[]} 违规规则的可读标识。
 */
export function literalMonoStacks(css) {
  return ruleViolations(css, (rule) => rule.declarations.some(([property, value]) =>
    property.startsWith('font') && MONO_STACK.test(value)))
}

/**
 * 别名层的契约：每个 `--mcp-*` 指向真实存在的 DSH 令牌，且用到的别名都已声明。
 *
 * 「存在」必须查清单，不能查前缀：`--dsw-alias-font-mono` 这种名字前缀完全合法、看着也很像，
 * 但全仓没有定义，`var()` 会取到空值——面板当场丢色，而 jsdom 渲染不出来。
 * 同类错误在生态里真实发生过（`dsh-market` 就用了这个不存在的令牌）。
 *
 * 带 fallback 的写法（`var(--dsw-x, ui-monospace)`）同样要查：fallback 让它"看着能用"，
 * 于是错名字能长期潜伏、永远命中 fallback，恰恰是最该被指出来的形态。
 *
 * 清单只覆盖 `--dsw-*` / `--ds-*`（主题所有者 ui-theme 的刻度）。插件不消费 `--dsh-*`
 * （那是各包自己的运行时变量，全仓分散、没有单一所有者）；将来真要用，先扩
 * `sync-theme-tokens.mjs` 的采集范围，不要退回去放行前缀。
 *
 * @param {string} css - 样式表文本。
 * @returns {{unknown: string[], undeclared: string[]}} 指向不存在令牌的别名，以及未声明就被引用的别名。
 */
export function aliasContract(css) {
  const declared = aliasDeclarations(css)
  const unknown = []
  for (const [name, value] of declared) {
    for (const token of varReferences(value)) {
      if (tokenExists(token, declared)) continue
      unknown.push(`${name} -> ${token}`)
    }
  }
  const used = new Set(parseRules(css)
    .flatMap((rule) => rule.declarations)
    .flatMap(([, value]) => varReferences(value))
    .filter((name) => name.startsWith('--mcp-')))
  return { unknown, undeclared: [...used].filter((name) => !declared.has(name)) }
}
