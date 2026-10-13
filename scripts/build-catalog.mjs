// 把 `.tasks/mcp-servers-verified.yaml`（逐条一手核实）生成 `lib/mcp-catalog.js`。
//
// 为什么用生成器而不是手抄：每条 13 个字段，手抄必然出错；而且这份 YAML 是**有据可查**的
// 核实产物（每条带来源），让生成器承担搬运、让人只审阅差异，才是可持续的做法。
//
// 生成器负责四件事，都是「人容易漏、机器不会漏」的：
//   1. 原样搬运 YAML 字段，字段顺序固定（diff 可读）。
//   2. 按 CATEGORY_ORDER 重排条目，让「目录顺序」本身就是市场要的展示顺序。
//   3. 派生 `packages`（身份识别用）：stdio 从 args 推，HTTP 用显式映射补。
//   4. 把含 `<占位符>` 的参数标出来（`needsArgs`）——这类条目直接安装会拿占位符当路径启动，
//      市场里必须提示用户先改，不能装完就说成功。
//
// 结构：本文件分两半。上半是**纯函数**（不碰文件系统，全部导出供 test/build-catalog.test.mjs
// 直接单测——守卫必须有能跑的用例，而不是只活在真机报告里）；下半是 main()，只有直接执行
// 本脚本时才跑（import 它不会读文件、不会写产物）。
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse } from 'yaml'

// 相对**脚本自己**定位，不靠 cwd：从别的目录调用时（`node scripts/build-catalog.mjs`
// 之外的形式）写错文件是最难发现的一类事故——生成器会安静地改写另一个仓库的同名文件）。
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(ROOT, '.tasks/mcp-servers-verified.yaml')
// 英文文案副本（可选，见下面「英文文案」那段）。缺席时产物只有中文。
const SOURCE_EN = join(ROOT, '.tasks/mcp-servers-verified-en.yaml')
const TARGET = join(ROOT, 'lib/mcp-catalog.js')

/**
 * 各服务的真实包名。**显式维护，不从 args 推导**。
 *
 * 为什么不用推导：`docker mcp gateway run` 会推出 `mcp, gateway, run`，
 * `serena start-mcp-server --context ide` 会推出 `start-mcp-server, ide`——这些是子命令
 * 不是包名，拿去比对身份只会永远匹配不上（或更糟，误匹配）。包名是**知识**，必须写出来。
 *
 * 只列「确实有对应发行包」的服务；纯远端服务（GitHub / Sentry / Linear 等）没有包，
 * 靠 url 的 host 认身份就够了，这里不列。
 */
const PACKAGES = {
  exa: ['exa-mcp-server'],
  tavily: ['tavily-mcp'],
  firecrawl: ['firecrawl-mcp'],
  'brave-search': ['@brave/brave-search-mcp-server'],
  fetch: ['mcp-server-fetch'],
  git: ['mcp-server-git'],
  everything: ['@modelcontextprotocol/server-everything'],
  postgres: ['postgres-mcp'],
  sqlite: ['mcp-server-sqlite'],
  redis: ['redis-mcp-server'],
  clickhouse: ['mcp-clickhouse'],
  mongodb: ['mongodb-mcp-server'],
  'chrome-devtools': ['chrome-devtools-mcp'],
  playwright: ['@playwright/mcp'],
  aws: ['mcp-proxy-for-aws'],
  kubernetes: ['kubernetes-mcp-server'],
  memory: ['@modelcontextprotocol/server-memory'],
  'sequential-thinking': ['@modelcontextprotocol/server-sequential-thinking'],
  arxiv: ['arxiv-mcp-server'],
  filesystem: ['@modelcontextprotocol/server-filesystem'],
  time: ['mcp-server-time'],
  jshook: ['@jshookmcp/jshook'],
  dbx: ['@dbx-app/mcp-server'],
  'deepwiki-fetch': ['mcp-deepwiki'],
  'ida-pro': ['ida-pro-mcp'],
  'frida-mcp': ['frida-mcp'],
  'fast-context': ['fast-context-mcp'],
  // serena 特殊：PyPI 包名是 `serena-agent`，但用户配置里出现的字符串是**命令名** `serena`
  // （`serena start-mcp-server …`），而身份识别是拿包名去比对配置里的 token。写 `serena-agent`
  // 永远匹配不上——实测它是唯一一条换名后认不出、市场会重复安装的条目。所以这里写 `serena`。
  serena: ['serena'],
  // docker 走的是 `docker mcp gateway run`（CLI 插件，不是 npm 包），故不列：
  // 它的身份靠 command 里的 `docker` 与子命令认，凭包名反而认不出来。
}

/**
 * 分类的展示顺序。**唯一真相源就在这里**，标签见下面的 CATEGORY_LABELS。
 *
 * 它靠「重排生成的 MCP_CATALOG 数组」生效，不是靠客户端另读一份顺序表：
 * 面板的 chips 取自目录里的**首次出现序**（`lib/client.js` 的 `categoryCounts`），
 * 所以只要产物按这个顺序分段排列，目录顺序本身就是展示顺序，客户端一行都不用改。
 *
 * 为什么不在 YAML 里靠段落物理顺序表达：那样「插入一个新分类」会连带改变整个 chips
 * 顺序（加 security 段时它就跑到 ai 后面去了），而且 YAML 的段序还要同时承担**分组阅读**
 * 的职责（dbx 那种跨段条目会破坏它）。顺序是产品决策，改它应该是显式的一次编辑，
 * 而不是改数据文件的副作用。
 */
const CATEGORY_ORDER = [
  'search', 'dev', 'security', 'data', 'ai', 'browser',
  'cloud', 'productivity', 'files', 'comms',
]

// 分类标签：从既有 mcp-config.js 的约定取，保持中文名一致。
const CATEGORY_LABELS = {
  search: '搜索',
  dev: '开发工具',
  security: '安全与逆向',
  data: '数据库与数据',
  browser: '浏览器自动化',
  cloud: '云与基础设施',
  productivity: '效率协作',
  ai: 'AI 与知识',
  files: '文件与本地',
  comms: '通讯',
}

/**
 * 分类的英文标签。与 CATEGORY_LABELS **同键集**（下面 buildCatalog 里校验）。
 *
 * 为什么英文分类名放在生成器而不是英文副本 YAML：分类是**封闭枚举**（10 个），不是
 * 逐条自由文案——写进 47 条副本等于把同样的 10 个字符串抄 47 遍，改一次要动 47 处。
 * 中文标签本来就住在这里（CATEGORY_LABELS），英文并排放，一处一对，键集校验防漂移。
 * 产物写成 `categoryLabelEn`，客户端与 label/summary 同一规矩按语言挑（pickCatalogText）。
 */
const CATEGORY_LABELS_EN = {
  search: 'Search',
  dev: 'Dev tools',
  security: 'Security & reversing',
  data: 'Databases & data',
  browser: 'Browser automation',
  cloud: 'Cloud & infrastructure',
  productivity: 'Productivity',
  ai: 'AI & knowledge',
  files: 'Files & local',
  comms: 'Communication',
}

/** 从两个 YAML 源里抠出 ```yaml 围栏块。 */
function extractBlock(raw, label) {
  const block = /```yaml\n([\s\S]*?)```/.exec(raw)
  if (!block) throw new Error(`在 ${label} 里找不到 \`\`\`yaml 代码块`)
  return block[1]
}

/** 可译文案字段（中文基准字段名）。英文是对应的 `<field>En`。 */
export const TRANSLATABLE = ['label', 'summary', 'access', 'vendor']

/**
 * 文案里的半角 `#` 会被 YAML 当行内注释吃掉后半句（真踩过：gitlab 的 access 在
 * 「issue #586184」处被截断，市场卡片上显示一句断掉的话）。括号不配对同理。
 *
 * ⚠️ 解析后的值**看不见**截断：`see issue #1234 end` 解析出来就是 `see issue`，
 * `#` 在 YAML 那一层就没了。所以守卫分两层：
 *   ① 原始文本层——非引号值里出现 ` #` 一律报错（截断在发生前被拦下，中英文副本都查）；
 *   ② 解析值层——括号不配对能兜住「截断留下未闭合括号」的残局（本文件的既有守卫）。
 * 只跑中文那份是半吊子：英文文案出现 issue 号 / C# / #channel 的概率比中文高得多。
 * @param {string} id - 条目 id（报错定位用）。
 * @param {string} field - 字段名。
 * @param {string} value - 解析后的值。
 */
export function assertCopySafe(id, field, value) {
  if (typeof value !== 'string') return
  for (const [open, close] of [['（', '）'], ['(', ')']]) {
    const opens = value.split(open).length - 1
    const closes = value.split(close).length - 1
    if (opens !== closes) {
      throw new Error(`${id}.${field} 括号不配对（${open}${opens} 个 / ${close}${closes} 个）：${value.slice(0, 60)}`)
    }
  }
}

/**
 * 原始文本层守卫：非引号文案值里不得出现 ` #`（YAML 行内注释的起点）。
 * 引号值里的 `#` 是字面量，安全。中英文两份 YAML 都要过这一关。
 * @param {string} rawBlock - ```yaml 围栏块的原始文本。
 * @param {string} label - 文件名（报错定位用）。
 */
export function assertRawCopyLines(rawBlock, label) {
  rawBlock.split('\n').forEach((line, index) => {
    const match = /^\s+(label|summary|access|vendor):\s+(.+)$/.exec(line)
    if (!match) return
    const value = match[2]
    const quoted = value.startsWith("'") || value.startsWith('"')
    if (!quoted && / #/.test(value)) {
      throw new Error(
        `${label} 第 ${index + 1} 行 ${match[1]} 的非引号值含半角 #，会被 YAML 当注释截断：${value.slice(0, 60)}——给值加引号`,
      )
    }
  })
}

/**
 * 英文副本里「键存在就不能是空串/纯空白」。
 *
 * 静默跳过空值会让下游报出 `缺 summaryEn` 却不指向英文 YAML——排错的人拿着产物
 * 一脸茫然。宁可在这里带着 id + 字段名炸掉。
 * @param {string} id - 条目 id。
 * @param {object} enEntry - 英文副本里的对应条目。
 */
export function assertCopyComplete(id, enEntry) {
  for (const field of TRANSLATABLE) {
    const value = enEntry[field]
    if (value === undefined) continue
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`英文副本 ${id}.${field} 是空串：要么补译文，要么把整个键删掉（缺席=回落中文）`)
    }
  }
}

/**
 * 「不要美化」闸：中文 access 里的 ⚠️ 警告必须原样带到英文。
 *
 * 真事：gitlab/netlify 的中文 access 写明「静态 Token 未获官方确认、DSH 里可能无法
 * 授权」，英文译文只剩乐观的一句——英文用户被剥夺了同一条警告，是信息不对称。
 * 判据用 ⚠️ 标记（中文 47 条里只有该警告的条目带它）。
 * @param {object} zhEntry - 中文条目。
 * @param {object} enEntry - 英文条目。
 */
export function assertWarningsPreserved(zhEntry, enEntry) {
  if (typeof zhEntry.access !== 'string' || !zhEntry.access.includes('⚠️')) return
  if (typeof enEntry.access !== 'string' || !enEntry.access.includes('⚠️')) {
    throw new Error(
      `英文副本 ${zhEntry.id}.access 丢掉了中文的 ⚠️ 警告（"不要美化"）：${zhEntry.access.slice(0, 60)}…`,
    )
  }
}

/** 深比较（本文件的配置数据都是 JSON 形态：字符串/数组/扁平对象）。 */
const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** 把 `<占位符>` 归一成 `<>`：args 里的占位符**允许**译（它们是显示提示，不是配置）。 */
const normalizePlaceholders = (value) => {
  if (Array.isArray(value)) return value.map(normalizePlaceholders)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizePlaceholders(item)]))
  }
  return typeof value === 'string' ? value.replace(/<[^>]*>/g, '<>') : value
}

/**
 * 配置数据不得来自译文：英文副本里除 TRANSLATABLE 外的每个字段都必须与中文**深相等**
 * （`<占位符>` 除外——那几个是市场显示给用户看的「装完先改这里」，译文才是对的）。
 *
 * 没有这条断言时，英文副本是一份「看着像真相源、改了却不生效、还没人校验」的配置副本：
 * 实测已有 3 条的 args 与中文不同（占位符译了），也有 url 被改成别处的潜在风险。
 * 归一化后比较，把静默无效变成显式报错。
 * @param {object} zhEntry - 中文条目。
 * @param {object} enEntry - 英文条目。
 */
export function assertConfigParity(zhEntry, enEntry) {
  for (const field of Object.keys(zhEntry)) {
    if (TRANSLATABLE.includes(field)) continue
    if (!deepEqual(normalizePlaceholders(zhEntry[field]), normalizePlaceholders(enEntry[field]))) {
      throw new Error(
        `英文副本 ${zhEntry.id}.${field} 与中文不一致：配置数据只有中文一份真相源`
        + `（<占位符> 除外，那些允许译）：${JSON.stringify(zhEntry[field])} vs ${JSON.stringify(enEntry[field])}`,
      )
    }
  }
  for (const field of Object.keys(enEntry)) {
    if (TRANSLATABLE.includes(field)) continue
    if (!(field in zhEntry)) {
      throw new Error(`英文副本 ${zhEntry.id}.${field} 是中文里没有的字段：译文只带文案，不带配置`)
    }
  }
}

/**
 * 该条目需要用户填写哪些**配置项**（非凭据）。
 *
 * 与 envKeys 的区别是有意义的：envKeys 表示「要申请一个密钥」，市场据此显示「需密钥」；
 * 而连接参数（HOST/PORT/USER）同样由用户填，却不是密钥——把它们混进 envKeys 会让
 * Redis / ClickHouse 这类本机服务看起来像要付费申请 Key。
 *
 * 判据是名字是否像凭据；不像的挑出来放这里。显式列白名单而不是靠猜，避免「PROFILE」
 * 这种功能开关被当成要填的东西。
 */
const NON_SECRET_CONFIG_KEYS = new Set([
  'REDIS_HOST', 'REDIS_PORT',
  'CLICKHOUSE_HOST', 'CLICKHOUSE_PORT', 'CLICKHOUSE_USER',
])

/** 该条目是否含 `<占位符>`（用户必须先替换才能用）。 */
function placeholdersIn(entry) {
  const values = [entry.command, entry.url, ...(entry.args || [])].filter((v) => typeof v === 'string')
  return values.filter((v) => /<[^>]+>/.test(v))
}

/**
 * 该条目需要用户提供哪些环境变量（**凭据**）。
 *
 * 从 headers / env 里的 `!!js` 表达式**派生**，不靠 YAML 手写：手写要与表达式两处同步，
 * 漏一处就会出现「装了但没提示要填 Key」——用户拿到一个静默连不上的 server。
 * 表达式是唯一真相源，它引用哪个变量，这里就列哪个。
 *
 * 连接参数（HOST/PORT/USER）不算凭据，转由 configKeys 承载——见 NON_SECRET_CONFIG_KEYS。
 */
function envKeysOf(entry) {
  const declared = Array.isArray(entry.envKeys) ? entry.envKeys : []
  const found = new Set(declared)
  // 从 headers 的表达式里抽变量名（含 `?? ""` 的兜底形式）。
  for (const value of Object.values(entry.headers || {})) {
    if (typeof value !== 'string') continue
    for (const match of value.matchAll(/process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g)) found.add(match[1])
  }
  for (const value of Object.values(entry.env || {})) {
    if (typeof value !== 'string') continue
    for (const match of value.matchAll(/process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g)) found.add(match[1])
  }
  return [...found].filter((name) => !NON_SECRET_CONFIG_KEYS.has(name))
}

/** 该条目需要用户填写的连接参数（非凭据）。 */
function configKeysOf(entry) {
  const declared = Array.isArray(entry.envKeys) ? entry.envKeys : []
  const found = new Set()
  for (const value of [...Object.values(entry.headers || {}), ...Object.values(entry.env || {})]) {
    if (typeof value !== 'string') continue
    for (const match of value.matchAll(/process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
      if (NON_SECRET_CONFIG_KEYS.has(match[1])) found.add(match[1])
    }
  }
  for (const name of declared) if (NON_SECRET_CONFIG_KEYS.has(name)) found.add(name)
  return [...found]
}

/** 单引号安全的 JS 字面量。 */
const str = (value) => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

function renderEntry(entry, translated) {
  const lines = []
  const push = (key, value) => lines.push(`    ${key}: ${value},`)
  push('id', str(entry.id))
  push('label', str(entry.label))
  push('summary', str(entry.summary))
  push('category', str(entry.category))
  push('categoryLabel', str(CATEGORY_LABELS[entry.category]))
  push('vendor', str(entry.vendor))
  push('access', str(entry.access))
  // 英文文案：只在英文副本里**确实提供了**该字段时才写出来。
  // 不写 `summaryEn: ''` 这种空壳——面板的判据是「有没有这个字段」，
  // 空串会让它以为"有英文"，结果显示一句空话。
  const en = translated?.get(entry.id)
  if (en) {
    for (const field of TRANSLATABLE) {
      const value = en[field]
      if (typeof value === 'string' && value.trim() !== '') push(`${field}En`, str(value))
    }
    // 分类英文名：封闭枚举，来自生成器的 CATEGORY_LABELS_EN（与中文标签并排维护）。
    push('categoryLabelEn', str(CATEGORY_LABELS_EN[entry.category]))
    // 占位符的英文提示：args 里的 `<占位符>` 是**显示文案**（「装完先改这里」），
    // 中文那份派生 placeholders，英文这份从英文副本的 args 派生——作者把三个占位符
    // 译进副本正是为了这个。归一化 parity 断言保证占位符以外的 args 内容不被译文改动。
    const enPlaceholders = placeholdersIn(en)
    if (enPlaceholders.length) push('placeholdersEn', `[${enPlaceholders.map(str).join(', ')}]`)
  }
  push('transport', str(entry.transport))
  if (entry.transport === 'streamable-http') {
    push('url', str(entry.url))
    if (entry.headers) {
      const pairs = Object.entries(entry.headers).map(([k, v]) => `${str(k)}: ${str(v)}`).join(', ')
      push('headers', `{ ${pairs} }`)
    }
  } else {
    push('command', str(entry.command))
    push('args', `[${(entry.args || []).map(str).join(', ')}]`)
  }
  const packages = PACKAGES[entry.id] || []
  if (packages.length) push('packages', `[${packages.map(str).join(', ')}]`)
  const envKeys = envKeysOf(entry)
  if (envKeys.length) push('envKeys', `[${envKeys.map(str).join(', ')}]`)
  const configKeys = configKeysOf(entry)
  if (configKeys.length) push('configKeys', `[${configKeys.map(str).join(', ')}]`)
  const placeholders = placeholdersIn(entry)
  if (placeholders.length) {
    push('placeholders', `[${placeholders.map(str).join(', ')}]`)
  }
  push('homepage', str(entry.homepage))
  return `  {\n${lines.join('\n')}\n  },`
}

/** 随产物一起下发的文案字段表：mcp-config 的两处搬运、测试的字段清单都从它取，
 *  加一个可译字段只改这一处（漏改的后果是字段被静默丢掉、英文界面漏出中文，
 *  而那是 jsdom 测不出来、真机才看得见的）。lib/client.js 那份是例外：
 *  预构建 bundle 不能 import 宿主模块，见 mcp-config.js 的说明。 */
const MCP_COPY_FIELDS = [...TRANSLATABLE, 'categoryLabel']

const header = `// MCP 服务目录 —— 「MCP 市场」的数据源。
//
// ⚠️ 本文件由 \`scripts/build-catalog.mjs\` 从 \`.tasks/mcp-servers-verified.yaml\` 生成。
//    要增删条目请改那份 YAML（它逐条带来源），然后重跑：
//
//      node scripts/build-catalog.mjs
//
// 语言：中文字段是**基准**（label / summary / access / vendor / categoryLabel），英文由**可选的**副本
// \`.tasks/mcp-servers-verified-en.yaml\` 提供，生成时写成 \`*En\` 字段（labelEn 等）。
// 副本缺席也能生成，产物就只有中文——面板回落显示中文，即改前的行为。
// 客户端按界面语言在「原字段 / *En」之间挑，见 lib/client.js 的 pickCatalogText。
//
// 为什么目录单独成文件，不留在 \`mcp-config.js\`：那个文件管**配置读写**（解析 patch、校验
// serverName、归一化表达式），目录是**数据**。两者变更频率差一个数量级——上游改配置格式可能
// 几个月一次，收录一个 MCP 是每天都能发生的事。混在一起会让「加一条收录」这种低风险改动
// 去动一个高风险文件。
//
// 字段约定（\`test/mcp-catalog.test.mjs\` 逐条校验）：
//
//   id          短标识，小写连字符。写进配置的 serverName 就是它，所以**一旦发布不能改**。
//   label       显示名。
//   summary     一句话说明。
//   category    见 mcp-config.js 的 MCP_CATEGORIES，市场按它分组。
//   categoryLabel 分类的中文标签（封闭枚举，生成器维护；英文是 categoryLabelEn）。
//   vendor      提供方。详情页显示，也用来区分官方与第三方。
//   access      中文，如实说清免费额度与是否需要 Key。**不要美化**（⚠️ 警告必须带进英文副本，
//               生成器有 parity 闸门）。
//   transport   'streamable-http' | 'stdio'。
//   url/headers 仅 HTTP 型。
//   command/args 仅 stdio 型。
//   packages    该服务的包名，用于识别「用户已经装过这一条」。HTTP 型也要写——同一服务常常
//               既有远端 endpoint 又有本地 npx 包，装了哪种都算装过。这层知识推不出来。
//   envKeys     用户需要提供哪些环境变量。省略/空 = 不需要凭据。
//   placeholders args/command 里含 \`<占位符>\` 的片段。这类条目**装完还不能直接用**，市场会
//               提示先改；不标出来就会拿 \`<仓库路径>\` 当真实路径去启动。placeholdersEn 是
//               同一批占位符的英文提示（从英文副本的 args 派生）。
//   homepage    官方文档或仓库。详情页的「文档」入口。
//
// 收录纪律：**宁可少，不可错**。一条装不上的配置比没有这条更糟——用户会以为是插件的锅。
// 所以只收能追到官方文档/官方仓库的条目；拿不到一手来源的宁可不收（哪些被排除、为什么，
// 见 \`.tasks/mcp-servers-report.md\`）。
//
// ⚠️ 已知边界：DSH 的 mcp-client **不支持 OAuth 交互授权**（transport.ts 只传
//    \`requestInit.headers\`，没有 authProvider）。所以只支持 OAuth、拿不到静态 Token 的
//    远端服务在这个宿主里**用不了**，本目录不收录。\`access\` 字段如实标注每条要什么凭据。

/**
 * 分类的展示顺序（唯一真相源）。
 *
 * 它靠重排下面的 \`MCP_CATALOG\` 生效：面板的 chips 取自目录里的**首次出现序**，
 * 所以这个数组的顺序就是用户看到的顺序。改顺序 = 改这里，不要手工重排 MCP_CATALOG。
 * 中文标签见 CATEGORY_LABELS，两者由生成器校验为同一集合。
 * @type {ReadonlyArray<string>}
 */
`

const labelsBlock = `export const CATEGORY_ORDER = [\n${CATEGORY_ORDER.map((c) => `  ${str(c)},`).join('\n')}\n]\n\n`
  + `/** 分类中文标签。与 CATEGORY_ORDER 同集合（生成时校验）。 */\n`
  + `export const CATEGORY_LABELS = {\n${CATEGORY_ORDER.map((c) => `  ${str(c)}: ${str(CATEGORY_LABELS[c])},`).join('\n')}\n}\n\n`
  + `/** 分类英文标签。与 CATEGORY_LABELS 同键集（生成时校验）。 */\n`
  + `export const CATEGORY_LABELS_EN = {\n${CATEGORY_ORDER.map((c) => `  ${str(c)}: ${str(CATEGORY_LABELS_EN[c])},`).join('\n')}\n}\n\n`
  + `/** 随界面语言切换的文案字段表（含分类标签）。mcp-config 的搬运与测试的清单都以它为准。 */\n`
  + `export const MCP_COPY_FIELDS = ${JSON.stringify(MCP_COPY_FIELDS)}\n\n`

const body = (orderedEntries, translated) => `
/**
 * 目录条目。字段含义见文件头。
 *
 * **数组顺序 = 市场的分类展示顺序**（按 CATEGORY_ORDER 分段排布）。面板的 chips
 * 靠这个顺序渲染，所以不要为了顺手而手工重排——要改顺序请改生成器的 CATEGORY_ORDER。
 * @type {ReadonlyArray<object>}
 */
export const MCP_CATALOG = [
${orderedEntries.map((entry) => renderEntry(entry, translated)).join('\n')}
]

/**
 * 按 id 建索引。多个消费者（市场列表、详情页、安装路径）都用它，避免各自 \`find\`。
 * @param {ReadonlyArray<object>} [catalog] - 目录，缺省用内置目录。
 * @returns {Map<string, object>} id → 条目。
 */
export function catalogById(catalog = MCP_CATALOG) {
  return new Map(catalog.map((entry) => [entry.id, entry]))
}
`

/**
 * 从两份 YAML 原文生成 `lib/mcp-catalog.js` 的完整内容。**纯函数**：不碰文件系统，
 * 所有校验失败都以 throw 表达（生成器宁可报错也不要产出坏数据）。
 *
 * 英文副本**可以缺席**（传 undefined）：那时产物只有中文，面板回落显示中文（改前行为）。
 * 一旦存在就必须自洽——条数/id 集合/空值/⚠️ 警告/配置 parity 逐条断言。
 *
 * @param {string} zhRaw - 中文 YAML 原文（含 \`\`\`yaml 围栏）。
 * @param {string} [enRaw] - 英文副本原文；缺席 = 纯中文产物。
 * @returns {{ content: string, entries: number, withEnglish: boolean, categories: number }}
 */
export function buildCatalog(zhRaw, enRaw) {
  const entries = parse(extractBlock(zhRaw, '中文目录'))
  if (!Array.isArray(entries) || !entries.length) throw new Error('YAML 解析结果不是非空数组')

  // 原始文本层守卫：非引号值里的 ` #` 会在 YAML 层截断（解析后看不见），两份都查。
  assertRawCopyLines(extractBlock(zhRaw, '中文目录'), 'mcp-servers-verified.yaml')

  let translated = null
  if (enRaw !== undefined && enRaw !== null) {
    assertRawCopyLines(extractBlock(enRaw, '英文副本'), 'mcp-servers-verified-en.yaml')
    const parsedEn = parse(extractBlock(enRaw, '英文副本'))
    if (!Array.isArray(parsedEn)) throw new Error('解析结果不是数组')
    if (parsedEn.length !== entries.length) {
      throw new Error(`条数不一致：中文 ${entries.length} 条 / 英文 ${parsedEn.length} 条`)
    }
    const byId = new Map(parsedEn.map((entry) => [entry.id, entry]))
    for (const entry of entries) {
      const enEntry = byId.get(entry.id)
      if (!enEntry) throw new Error(`英文副本缺少条目：${entry.id}`)
      assertCopyComplete(entry.id, enEntry)
      for (const field of TRANSLATABLE) assertCopySafe(entry.id, `${field}En`, enEntry[field])
      assertWarningsPreserved(entry, enEntry)
      assertConfigParity(entry, enEntry)
    }
    translated = byId
  }

  const usedCategories = [...new Set(entries.map((entry) => entry.category))]
  const unknownCategories = usedCategories.filter((category) => !CATEGORY_ORDER.includes(category))
  if (unknownCategories.length) {
    throw new Error(`目录里出现未登记的分类：${unknownCategories.join(', ')}——请加进 CATEGORY_ORDER`)
  }

  // 反向：登记了却一条都没有，会让市场多出一个空 chips 分组。宁可报错也不要发出去。
  const emptyCategories = CATEGORY_ORDER.filter((category) => !usedCategories.includes(category))
  if (emptyCategories.length) {
    throw new Error(`CATEGORY_ORDER 里的这些分类没有任何条目：${emptyCategories.join(', ')}——删掉该分类或补条目`)
  }

  // 上面那段注释承诺的「两处同集合」在这里兑现：只登记了顺序却忘了写标签，
  // 面板就会显示英文 key（`test/mcp-catalog.test.mjs` 正是为此存在的）。宁可报错。
  const missingLabels = CATEGORY_ORDER.filter((category) => !CATEGORY_LABELS[category] || !CATEGORY_LABELS_EN[category])
  if (missingLabels.length) {
    throw new Error(`CATEGORY_ORDER 里的这些分类缺中/英文标签：${missingLabels.join(', ')}——请补进 CATEGORY_LABELS / CATEGORY_LABELS_EN`)
  }

  // 按分类重排（组内保持 YAML 原序）：这一步就是「顺序由 CATEGORY_ORDER 决定」的实现。
  const orderedEntries = CATEGORY_ORDER.flatMap((category) => entries.filter((entry) => entry.category === category))

  // 解析值层守卫：括号不配对（截断残局/手误）。中文基准与英文副本都过。
  for (const entry of entries) {
    for (const field of TRANSLATABLE) assertCopySafe(entry.id, field, entry[field])
  }

  return {
    content: header + labelsBlock + body(orderedEntries, translated),
    entries: orderedEntries.length,
    withEnglish: translated !== null,
    categories: CATEGORY_ORDER.length,
  }
}

// ── 主流程：只有直接执行本脚本时才跑 ────────────────────────────────────────
function main() {
  const zhRaw = readFileSync(SOURCE, 'utf8')
  // 英文副本可选：读不到文件 = 缺席（ENOENT），产物只有中文。存在但不合法则抛。
  let enRaw
  try {
    enRaw = readFileSync(SOURCE_EN, 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  const result = buildCatalog(zhRaw, enRaw)
  writeFileSync(TARGET, result.content)
  console.log(`已生成 ${TARGET}：${result.entries} 条 · ${result.categories} 分类`)
  console.log('分类顺序:', CATEGORY_ORDER.join(' → '))
  const entries = parse(extractBlock(zhRaw, '中文目录'))
  const withPlaceholders = entries.filter((e) => placeholdersIn(e).length)
  console.log('含占位符（装后需用户改）:', withPlaceholders.length, withPlaceholders.map((e) => e.id).join(', ') || '(无)')
}

// import.meta.main 是 Node 24 的正式判据；老 node 没有它时退回调用的脚本路径比对
// （宁可显式比对也不要静默不跑——生成器不执行比报错更难发现）。
const invokedDirectly = import.meta.main ?? (() => {
  const arg = process.argv[1]
  return arg ? import.meta.url === pathToFileURL(arg).href : false
})()
if (invokedDirectly) main()
