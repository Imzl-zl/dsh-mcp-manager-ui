// 把 `.tasks/mcp-servers-verified.yaml`（43 条，逐条一手核实）生成 `lib/mcp-catalog.js`。
//
// 为什么用生成器而不是手抄：43 条 × 13 字段，手抄必然出错；而且这份 YAML 是**有据可查**的
// 核实产物（每条带来源），让生成器承担搬运、让人只审阅差异，才是可持续的做法。
//
// 生成器负责三件事，都是「人容易漏、机器不会漏」的：
//   1. 原样搬运 YAML 字段，字段顺序固定（diff 可读）。
//   2. 派生 `packages`（身份识别用）：stdio 从 args 推，HTTP 用显式映射补。
//   3. 把含 `<占位符>` 的参数标出来（`needsArgs`）——这类条目直接安装会拿占位符当路径启动，
//      市场里必须提示用户先改，不能装完就说成功。
import { readFileSync, writeFileSync } from 'node:fs'
import { parse } from 'yaml'

const SOURCE = '.tasks/mcp-servers-verified.yaml'
const TARGET = 'lib/mcp-catalog.js'

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
  'fast-context': ['fast-context-mcp'],
  // serena 特殊：PyPI 包名是 `serena-agent`，但用户配置里出现的字符串是**命令名** `serena`
  // （`serena start-mcp-server …`），而身份识别是拿包名去比对配置里的 token。写 `serena-agent`
  // 永远匹配不上——实测它是唯一一条换名后认不出、市场会重复安装的条目。所以这里写 `serena`。
  serena: ['serena'],
  // docker 走的是 `docker mcp gateway run`（CLI 插件，不是 npm 包），故不列：
  // 它的身份靠 command 里的 `docker` 与子命令认，凭包名反而认不出来。
}

/** 分类顺序：按 YAML 里的出现序（那个文件已按分类分组），保证 chips 顺序稳定。 */
const raw = readFileSync(SOURCE, 'utf8')
const block = /```yaml\n([\s\S]*?)```/.exec(raw)
if (!block) throw new Error('在 ' + SOURCE + ' 里找不到 ```yaml 代码块')
const entries = parse(block[1])
if (!Array.isArray(entries) || !entries.length) throw new Error('YAML 解析结果不是非空数组')

const categoryOrder = []
for (const entry of entries) if (!categoryOrder.includes(entry.category)) categoryOrder.push(entry.category)

// 文案里的半角 `#` 会被 YAML 当行内注释吃掉后半句（真踩过：gitlab 的 access 在
// 「issue #586184」处被截断，市场卡片上显示一句断掉的话）。这里显式拦住——生成器宁可
// 报错也不要产出半句话。
for (const entry of entries) {
  for (const field of ['access', 'summary', 'label', 'vendor']) {
    const value = entry[field]
    if (typeof value !== 'string') continue
    if (value.includes('#')) {
      throw new Error(`${entry.id}.${field} 含半角 #，会被 YAML 当注释截断：${value.slice(0, 60)}`)
    }
    for (const [open, close] of [['（', '）'], ['(', ')']]) {
      const opens = (value.split(open).length - 1)
      const closes = (value.split(close).length - 1)
      if (opens !== closes) {
        throw new Error(`${entry.id}.${field} 括号不配对（${open}${opens} 个 / ${close}${closes} 个）：${value.slice(0, 60)}`)
      }
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

function renderEntry(entry) {
  const lines = []
  const push = (key, value) => lines.push(`    ${key}: ${value},`)
  push('id', str(entry.id))
  push('label', str(entry.label))
  push('summary', str(entry.summary))
  push('category', str(entry.category))
  push('vendor', str(entry.vendor))
  push('access', str(entry.access))
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

const header = `// MCP 服务目录 —— 「MCP 市场」的数据源。
//
// ⚠️ 本文件由 \`scripts/build-catalog.mjs\` 从 \`.tasks/mcp-servers-verified.yaml\` 生成。
//    要增删条目请改那份 YAML（它逐条带来源），然后重跑：
//
//      node scripts/build-catalog.mjs
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
//   vendor      提供方。详情页显示，也用来区分官方与第三方。
//   access      中文，如实说清免费额度与是否需要 Key。**不要美化**。
//   transport   'streamable-http' | 'stdio'。
//   url/headers 仅 HTTP 型。
//   command/args 仅 stdio 型。
//   packages    该服务的包名，用于识别「用户已经装过这一条」。HTTP 型也要写——同一服务常常
//               既有远端 endpoint 又有本地 npx 包，装了哪种都算装过。这层知识推不出来。
//   envKeys     用户需要提供哪些环境变量。省略/空 = 不需要凭据。
//   placeholders args/command 里含 \`<占位符>\` 的片段。这类条目**装完还不能直接用**，市场会
//               提示先改；不标出来就会拿 \`<仓库路径>\` 当真实路径去启动。
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
 * 分类的展示顺序与中文标签。顺序 = 生成时 YAML 里的出现序。
 * @type {ReadonlyArray<[string, string]>}
 */
`

// 分类标签：从既有 mcp-config.js 的约定取，保持中文名一致。
const CATEGORY_LABELS = {
  search: '搜索',
  dev: '开发工具',
  data: '数据库与数据',
  browser: '浏览器自动化',
  cloud: '云与基础设施',
  productivity: '效率协作',
  ai: 'AI 与知识',
  files: '文件与本地',
  comms: '通讯',
}

const body = `
/**
 * 目录条目。字段含义见文件头。
 * @type {ReadonlyArray<object>}
 */
export const MCP_CATALOG = [
${entries.map(renderEntry).join('\n')}
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

const labelsBlock = `export const CATEGORY_ORDER = [\n${categoryOrder.map((c) => `  ${str(c)},`).join('\n')}\n]\n\n`
  + `/** 分类中文标签。 */\n`
  + `export const CATEGORY_LABELS = {\n${categoryOrder.map((c) => `  ${str(c)}: ${str(CATEGORY_LABELS[c] || c)},`).join('\n')}\n}\n`

writeFileSync(TARGET, header + labelsBlock + body)
console.log(`已生成 ${TARGET}：${entries.length} 条 · ${categoryOrder.length} 分类`)
console.log('分类顺序:', categoryOrder.join(' → '))
const withPlaceholders = entries.filter((e) => placeholdersIn(e).length)
console.log('含占位符（装后需用户改）:', withPlaceholders.length, withPlaceholders.map((e) => e.id).join(', ') || '(无)')
