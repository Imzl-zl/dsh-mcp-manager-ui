// 面板样式的 DSH 主题契约。
//
// 判据来自 DSH 自己的 spec（见 scripts/theme-spec.mjs 顶部的逐条对照）。这些规则在
// jsdom 里渲染不出来（superellipse 只在支持 corner-shape 的引擎上显形），所以只能对
// 样式表文本断言——这也是上游 ui-theme 的做法。
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  aliasContract,
  aliasDeclarations,
  aliasHost,
  extractPanelCss,
  literalColors,
  literalMonoStacks,
  neutralBordersBesideElevation,
  parseRules,
  subtreesMissingLabelColor,
  unpairedFullRound,
  unscaledRadii,
} from '../scripts/theme-spec.mjs'
import { DSH_THEME_TOKENS } from '../scripts/dsh-theme-tokens.mjs'

const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const css = extractPanelCss(client)

test('every full-round radius pairs corner-shape: round', () => {
  // ui-theme 的 corner-shape.css 在 @supports 里用通用选择器 `*` 把整个文档的圆角
  // 换成 superellipse(1.5)；插件渲染在同一文档里，不配对的圆点会被压方、药丸会被削平。
  // 官方 Switch / StateDot / scrollbar 都逐个配了这条。
  assert.deepEqual(unpairedFullRound(css), [])
  // 抽查一处，确认扫描器确实在看真东西而不是把整张表当空。
  assert.match(css, /\.dsh-mcp-badge\{[^}]*corner-shape:round/)
  assert.match(css, /\.dsh-mcp-toggle::after\{[^}]*corner-shape:round/)
})

test('component radii stay on the shared theme scale', () => {
  // docs/ui-radius.md：不写局部数值（10/14/18/24px 被点名），一律引用 --dsw-radius-*。
  assert.deepEqual(unscaledRadii(css), [])
  // 刻度映射抽查：主浮层与对话框是最大一档，微型徽标是最小一档。
  assert.match(css, /\.dsh-mcp-panel\{[^}]*border-radius:var\(--mcp-r-panel\)/)
  assert.match(css, /\.dsh-mcp-modal\{[^}]*border-radius:var\(--mcp-r-panel\)/)
  assert.match(css, /\.dsh-mcp-param-type\{[^}]*border-radius:var\(--mcp-r-xs\)/)
  // 响应式覆盖里的圆角同样走令牌。
  assert.match(css, /@media \(max-width:760px\)\{[^@]*\.dsh-mcp-panel\{[^}]*border-radius:var\(--mcp-r-panel\)/)
})

test('elevated surfaces carry no neutral border beside the elevation shadow', () => {
  // 发丝描边画在阴影里，组件配 border: 0；否则轮廓画两遍且边框宽度撑动布局。
  assert.deepEqual(neutralBordersBesideElevation(css), [])
  for (const selector of ['dsh-mcp-panel', 'dsh-mcp-modal', 'dsh-mcp-whatsnew']) {
    assert.match(css, new RegExp(`\\.${selector}\\{[^}]*border:0[^}]*box-shadow:var\\(--dsw-elevation-prominent\\)`))
  }
  // 状态色边框是规范豁免项，必须仍是真的边框。
  assert.match(css, /\.dsh-mcp-toast\.err\{border:1px solid var\(--dsw-alias-state-error-primary\)\}/)
  assert.match(css, /\.dsh-mcp-toast\.ok\{border:1px solid var\(--dsw-alias-state-success-primary\)\}/)
})

test('the panel writes no literal colors and no literal mono stack', () => {
  // docs/web-styling.md：特性组件只消费语义令牌，不复制静态色板。
  assert.deepEqual(literalColors(css), [])
  assert.deepEqual(literalMonoStacks(css), [])
  // 等宽字体走 ui-theme 真正定义的 --ds-font-family-code。别用名字很像的
  // --dsw-font-mono：全仓没有定义它，引用它等于永远命中 fallback，等宽字形与宿主
  // 代码块不一致（这条由下面 aliasContract 的存在性校验兜住，这里显式钉住意图）。
  assert.doesNotMatch(css, /--dsw-font-mono/)
  assert.doesNotMatch(css, /--dsw-alias-font-mono/)
  assert.match(css, /--mcp-mono:var\(--ds-font-family-code,ui-monospace/)
})

test('the alias layer only points at real tokens and declares everything it is asked for', () => {
  const { unknown, undeclared } = aliasContract(css)
  assert.deepEqual(unknown, [], '别名层引用了不存在的 DSH 令牌')
  assert.deepEqual(undeclared, [], '有规则引用了未声明的 --mcp-* 别名')
  // 别名层必须真的在（而不是扫描器把空表当通过）。
  const declared = aliasDeclarations(css)
  assert.ok(declared.size >= 15, `别名层只声明了 ${declared.size} 个令牌`)
  assert.equal(declared.get('--mcp-accent'), 'var(--dsw-alias-brand-primary)')
  assert.equal(declared.get('--mcp-r-panel'), 'var(--dsw-radius-panel)')
})

test('the alias layer is hosted where the theme tokens live', () => {
  // 两个约束同时成立才安全，两条都踩过：
  //   ① 落在三个 slot 子树的公共祖先上（否则悬浮按钮/侧栏入口取不到别名）；
  //   ② 与 DSH 令牌同层 —— ui-theme 把 --dsw-alias-* 定义在 body 上，自定义属性在声明处
  //      就完成替换，所以挂在 :root（body 的祖先）会取到空值、整片别名失效。
  assert.equal(aliasHost(css), 'body')
  assert.deepEqual(subtreesMissingLabelColor(css), [])
})

test('the scanner itself rejects the violations it is meant to catch', () => {
  // 自我保护：扫描器若退化成"永远通过"，上面五条就都是空的。
  assert.deepEqual(unpairedFullRound('.a{border-radius:50%}'), ['.a'])
  assert.deepEqual(unpairedFullRound('.a{border-radius:50%;corner-shape:round}'), [])
  assert.equal(unscaledRadii('.a{border-radius:14px}').length, 1)
  assert.deepEqual(unscaledRadii('.a{border-radius:var(--dsw-radius-md)}'), [])
  assert.equal(unscaledRadii('.a{border-radius:var(--dsw-radius-missing)}').length, 1)
  assert.equal(unscaledRadii('.a{border-radius:var(--mcp-r-nope)}').length, 1)
  assert.equal(literalColors('.a{color:#fff}').length, 1)
  assert.equal(literalColors('.a{color:rgba(0,0,0,.3)}').length, 1)
  assert.equal(literalMonoStacks('.a{font-family:ui-monospace,monospace}').length, 1)
  assert.equal(neutralBordersBesideElevation(
    '.a{box-shadow:var(--dsw-elevation-panel);border:1px solid var(--dsw-alias-border-l2)}').length, 1)
  // 绘图细节（≤4px）与全圆角（≥99px）都不算自造刻度。
  assert.deepEqual(unscaledRadii('.a{border-radius:2px}'), [])
  assert.deepEqual(unscaledRadii('.a{border-radius:999px;corner-shape:round}'), [])
  // 别名宿主与 label 色检查同样要能抓到错。
  assert.equal(aliasHost('body{--mcp-accent:red}'), 'body')
  assert.equal(aliasHost(':root{--mcp-accent:red}'), ':root')
  assert.equal(aliasHost('.a{color:red}'), null)
  assert.deepEqual(subtreesMissingLabelColor('.dsh-mcp-fab{color:var(--dsw-alias-label-primary)}'),
    ['.dsh-mcp-footer-action', '.dsh-mcp-toast', '.dsh-mcp-wrap', '.dsh-mcp-panel-overlay', '.dsh-mcp-overlay'])
  // 别名指向不存在的令牌必须抓到 —— 查的是令牌清单，不是前缀。前缀合法的名字正是最危险
  // 的形态：--dsw-alias-font-mono 看着像真的（生态里 dsh-market 就用了它），实际取到空值。
  assert.deepEqual(aliasContract('body{--mcp-accent:var(--dsw-alias-nope)}').unknown,
    ['--mcp-accent -> --dsw-alias-nope'])
  assert.deepEqual(aliasContract('body{--mcp-line:var(--dsw-alias-border-l9)}').unknown,
    ['--mcp-line -> --dsw-alias-border-l9'])
  assert.deepEqual(aliasContract('body{--mcp-mono:var(--dsw-alias-font-mono,monospace)}').unknown,
    ['--mcp-mono -> --dsw-alias-font-mono'])
  assert.deepEqual(aliasContract('body{--mcp-mono:var(--dsw-font-mono,monospace)}').unknown,
    ['--mcp-mono -> --dsw-font-mono'])
  // 带 fallback 不豁免：fallback 让错名字"看着能用"，恰恰是它长期潜伏的原因。
  assert.equal(aliasContract('body{--mcp-x:var(--dsw-does-not-exist,red)}').unknown.length, 1)
  // 真实令牌（含带 fallback 的写法）与别名互相引用都要放行。
  assert.deepEqual(aliasContract('body{--mcp-a:var(--dsw-alias-brand-primary)}').unknown, [])
  assert.deepEqual(aliasContract('body{--mcp-a:var(--ds-font-family-code,monospace)}').unknown, [])
  assert.deepEqual(aliasContract('body{--mcp-a:var(--dsw-radius-md);--mcp-b:var(--mcp-a)}').unknown, [])
  // 中性边框走别名（--mcp-line）时也要抓到——本仓库最常见的形态就是这个。
  assert.equal(neutralBordersBesideElevation(
    '.a{box-shadow:var(--dsw-elevation-panel);border:1px solid var(--mcp-line)}').length, 1)
  assert.equal(neutralBordersBesideElevation(
    '.a{box-shadow:var(--dsw-elevation-panel);border:0}').length, 0)
  // 状态色边框不算中性边框，放行。
  assert.equal(neutralBordersBesideElevation(
    '.a{box-shadow:var(--dsw-shadow-lv3);border:1px solid var(--dsw-alias-state-error-primary)}').length, 0)
})

test('every scanner still reports the real sheet as clean', () => {
  // 上一条证明扫描器抓得到错；这条证明它在真实样式表上不误报。
  // 两者缺一：只测"抓得到"会放过满屏误报，只测"干净"会放过永远通过的扫描器。
  for (const [name, hits] of [
    ['unpairedFullRound', unpairedFullRound(css)],
    ['unscaledRadii', unscaledRadii(css)],
    ['neutralBordersBesideElevation', neutralBordersBesideElevation(css)],
    ['literalColors', literalColors(css)],
    ['literalMonoStacks', literalMonoStacks(css)],
    ['subtreesMissingLabelColor', subtreesMissingLabelColor(css)],
  ]) {
    assert.deepEqual(hits, [], `${name} 在真实样式表上误报`)
  }
})

test('the scanner skips the alias layer for radii but still polices its colors', () => {
  // 别名层只做令牌映射：圆角刻度不该在它里面出现，所以不查；
  // 但字面色值必须查——写死颜色等于把主题跟随关掉，且只有真实浏览器才看得出来。
  const sheet = 'body{--mcp-accent:var(--dsw-alias-brand-primary)}.a{border-radius:14px}'
  assert.equal(unscaledRadii(sheet).length, 1, '别名层之外的违规必须仍被看到')
  assert.deepEqual(literalColors('body{--mcp-accent:var(--dsw-alias-brand-primary)}'), [])
  // 带 fallback 的 var() 是官方推荐写法，放行。
  assert.deepEqual(literalColors('body{--mcp-mono:var(--dsw-font-mono,ui-monospace,monospace)}'), [])
  // 在别名层写死颜色要抓到。
  assert.equal(literalColors('body{--mcp-line:#e5e7eb}').length, 1)
  assert.equal(literalColors('body{--mcp-bg-1:rgba(0,0,0,.5)}').length, 1)
  // 组件规则里的字面值照常抓到。
  assert.equal(literalColors('body{--mcp-x:var(--dsw-radius-md)}.a{color:#fff}').length, 1)
})

test('the scanner reads rules out of minified css and nested at-rules', () => {
  // 面板 CSS 是压缩过的：一行挤多条规则，@media 里还嵌覆盖规则。按行切会张冠李戴。
  const parsed = parseRules('.a{color:red}.b{color:blue}')
  assert.deepEqual(parsed.map((rule) => rule.selectors), [['.a'], ['.b']])
  const nested = parseRules('@media (max-width:760px){.a{border-radius:10px}}')
  assert.deepEqual(nested.map((rule) => rule.at), [['@media (max-width:760px)']])
  assert.deepEqual(nested[0].declarations, [['border-radius', '10px']])
  // 注释要被剥掉，否则注释里的 `{` 会打乱配对。
  assert.deepEqual(parseRules('/* } */ .a{color:red}').map((rule) => rule.selectors), [['.a']])
})

test('every panel class the bundle renders has a style', () => {
  // 拼错一个类名 / 忘了写样式，表现是「这块没排版」——不像报错那样显眼，jsdom 也看不出来。
  // 写市场 UI 时就漏过一次（筛选条右侧的「全选当前 N 个」引用了没定义的类）。
  // ⚠️ 前缀必须同时覆盖 dsh-mcp- 与 dsh-skills-：这里原先只扫 dsh-mcp-，注释写着
  //   「其它类由各自的规则覆盖」——那个假设在 SKILLS_CSS 出现后就过期了。实际漏掉的代价
  //   是安装弹窗里整块作用域单选（dsh-skills-list/-row）被当死 CSS 删掉后无人报警，
  //   12 条主题测试全绿而那块没有排版。
  const stylesheet = parseRules(css);
  const defined = new Set(stylesheet.flatMap((rule) => rule.selectors
    .flatMap((selector) => [...selector.matchAll(/\.(dsh-(?:mcp|skills)-[a-z0-9-]+)/g)].map((m) => m[1]))));
  // 从 className 字符串里取 token，含 'a' + (x ? ' b' : '') 这种拼接的两侧。
  const rendered = new Set([...client.matchAll(/className:\s*'([^']*)'/g)]
    .flatMap((m) => m[1].split(/[^a-z0-9-]+/))
    .filter((token) => token.startsWith('dsh-mcp-') || token.startsWith('dsh-skills-')));
  const missing = [...rendered].filter((name) => !defined.has(name)).sort();
  assert.deepEqual(missing, [], '这些类被渲染但没有样式：' + missing.join(', '));
  // 反向也留个下限，避免上面两处一起退化成空集合而假通过。
  assert.ok(rendered.size > 40, `只扫到 ${rendered.size} 个类，疑似正则失效`);
  assert.ok(defined.size > 40, `样式表只解析出 ${defined.size} 个类，疑似解析失效`);
  // 覆盖面本身要有下限：只扫到 dsh-mcp- 一个前缀，就说明技能面那套又脱离了检查。
  assert.ok([...rendered].some((name) => name.startsWith('dsh-skills-')),
    '扫描必须覆盖 dsh-skills-* 类，否则技能面板的悬空类无人报警');
})

test('the extractor collects every stylesheet constant, not just MCP_CSS', () => {
  // 面板的样式常量不止一份时（新增 Skills 面板就会出现第二份），提取器若只认 MCP_CSS，
  // 上面 11 个扫描器会**全部扫不到新样式**——12 条主题测试全绿，但一条都没查过新代码。
  // 这是最危险的失败形态：绿而无效。所以提取范围本身要有测试守着。
  const synthetic = [
    'const MCP_CSS = `.a{color:red}`;',
    'const SKILLS_CSS = `.b{color:blue}`;',
  ].join('\n')
  const extracted = extractPanelCss(synthetic)
  assert.match(extracted, /\.a\{color:red\}/)
  assert.match(extracted, /\.b\{color:blue\}/, '第二份样式常量必须一并纳入扫描范围')
})

test('the real bundle now ships two stylesheet constants and both are scanned', () => {
  // 上一条用合成输入证明提取器「具备」多常量能力；这条证明**真实产物里确实有两份**，
  // 且第二份真的被扫到了。少任何一半，11 个扫描器都可能只覆盖了一半代码而全绿。
  const names = [...client.matchAll(/const ([A-Z][A-Z0-9_]*_CSS) = `/g)].map((match) => match[1])
  assert.deepEqual(names, ['MCP_CSS', 'SKILLS_CSS'], `实际样式常量：${names.join(', ')}`)
  // 两份内容都在提取结果里（抽查各自的特征选择器）。
  assert.match(css, /\.dsh-mcp-/, 'MCP 样式应被提取')
  assert.match(css, /\.dsh-skills-/, 'SKILLS_CSS 应被提取（否则扫描器全都没查过它）')
})

test('the skills stylesheet declares no second alias layer', () => {
  // 别名层（--mcp-* 指向 --dsw-*）的唯一宿主是 body：自定义属性在**声明处**完成替换，
  // 所以第二处 body 声明会把第一处整体覆盖（顺序靠后者胜），一半界面取到空值。
  // SKILLS_CSS 只允许消费已声明的别名，不得再声明一次。
  const hosts = [...css.matchAll(/(^|[};])\s*body\s*\{/g)].length
  assert.equal(hosts, 1, `别名层的 body 宿主应恰好一处，实际 ${hosts} 处`)
  // 别名**声明**（--mcp-*: …）也只能出现在那一处。
  const skillsStart = client.indexOf('const SKILLS_CSS = ')
  const skillsCss = client.slice(skillsStart)
  assert.doesNotMatch(skillsCss.slice(0, skillsCss.indexOf('`;')), /--mcp-[a-z0-9-]+:/,
    'SKILLS_CSS 不得重复声明 --mcp-* 别名（别名层唯一宿主是 body）')
})

test('the extractor still fails loudly when no stylesheet constant exists', () => {
  // 容忍多份不等于容忍没有：提取不到必须抛，否则扫描器会拿空表当"干净"。
  assert.throws(() => extractPanelCss('const NOT_CSS = 1;'), /找不到 .* 模板字面量/)
})

test('the token snapshot is real, so the existence checks cannot pass vacuously', () => {  // aliasContract 的存在性校验完全依赖这份清单。清单若退化成空表或残缺，上面那条
  // "抓得到错"仍然会过（任何令牌都"不存在"），而"真实样式表干净"则会失败——
  // 但反过来，清单若被换成"只收插件用到的那些"，校验就恒真了。所以在这里独立钉住它的规模与关键成员。
  assert.ok(DSH_THEME_TOKENS.size > 300, `令牌快照只有 ${DSH_THEME_TOKENS.size} 项，疑似残缺`)
  for (const token of [
    '--dsw-alias-brand-primary', // 别名层的地基
    '--dsw-alias-border-l2',
    '--dsw-alias-switch-thumb', // 改动期间新引入的
    '--dsw-alias-label-primary-foreground',
    '--dsw-elevation-prominent',
    '--dsw-shadow-lv3',
    '--ds-font-family-code', // 等宽字体改指向它
  ]) {
    assert.ok(DSH_THEME_TOKENS.has(token), `快照缺少 ${token}`)
  }
  // 这几个必须**不在**清单里：它们是本仓库踩过的坑，留着是为了让上一条测试有靶子。
  for (const token of ['--dsw-font-mono', '--dsw-alias-font-mono']) {
    assert.ok(!DSH_THEME_TOKENS.has(token), `${token} 竟然在清单里，存在性校验会失去意义`)
  }
})
