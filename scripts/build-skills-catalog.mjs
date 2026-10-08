// 把 `.tasks/skills-verified.yaml`（逐条一手核实）生成 `lib/skills-catalog.js`。
//
// 与 `scripts/build-catalog.mjs`（MCP）同构，四件事相同：
//   1. 原样搬运 YAML 字段，字段顺序固定（diff 可读）。
//   2. 按 CATEGORY_ORDER 重排条目，让「目录顺序」本身就是市场要的展示顺序。
//   3. 派生字段，人容易漏、机器不会漏。
//   4. 把风险披露标出来（含占位符/含脚本），这些必须离线可得。
//
// 但有一处**本质差异**：技能目录的「能不能装」**不写进 YAML**，而是在这里调用
// `classifyLicense()` 算出来。理由是许可门禁必须只有一个实现——数据里手写
// `installable: false` 会形成第二真相源，改了规则却漏改数据，门禁就静默失效。
// 所以 YAML 只记录**事实**（许可是什么、证据在哪个文件），判定由代码做。
//
// 另一个差异：技能名可能跨仓库重复（`test-driven-development` 在 obra/superpowers 与
// github/awesome-copilot 都有），所以 id 必须显式区分，不能拿 name 当 id。
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { classifyLicense, resolveGoverningLicense } from '../lib/skills-admission.js'

// 相对**脚本自己**定位，不靠 cwd：从别处调用时安静地改写另一个仓库的同名文件是最难发现的
// 一类事故（MCP 生成器同样处理）。
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(ROOT, '.tasks/skills-verified.yaml')
const TARGET = join(ROOT, 'lib/skills-catalog.js')

const raw = readFileSync(SOURCE, 'utf8')
const block = /```yaml\n([\s\S]*?)```/.exec(raw)
if (!block) throw new Error('在 ' + SOURCE + ' 里找不到 ```yaml 代码块')
const entries = parse(block[1])
if (!Array.isArray(entries) || !entries.length) throw new Error('YAML 解析结果不是非空数组')

/**
 * 分类的展示顺序（唯一真相源）。
 *
 * 它靠重排生成的 SKILL_CATALOG 生效：面板 chips 取目录里的**首次出现序**，所以数组顺序
 * 就是用户看到的顺序。改顺序 = 改这里，不要手工重排 SKILL_CATALOG。
 */
const CATEGORY_ORDER = [
  'docs', 'dev', 'process', 'design', 'agent', 'data', 'infra', 'writing',
]

const CATEGORY_LABELS = {
  docs: '文档处理',
  dev: '开发工具',
  process: '开发流程',
  design: '设计与前端',
  agent: 'Agent 与技能工程',
  data: '数据与分析',
  infra: '云与基础设施',
  writing: '写作与协作',
}

const usedCategories = [...new Set(entries.map((entry) => entry.category))]
const unknownCategories = usedCategories.filter((category) => !CATEGORY_ORDER.includes(category))
if (unknownCategories.length) {
  throw new Error(`目录里出现未登记的分类：${unknownCategories.join(', ')}——请加进 CATEGORY_ORDER`)
}
const emptyCategories = CATEGORY_ORDER.filter((category) => !usedCategories.includes(category))
if (emptyCategories.length) {
  throw new Error(`CATEGORY_ORDER 里的这些分类没有任何条目：${emptyCategories.join(', ')}——删掉该分类或补条目`)
}
const missingLabels = CATEGORY_ORDER.filter((category) => !CATEGORY_LABELS[category])
if (missingLabels.length) {
  throw new Error(`CATEGORY_ORDER 里的这些分类没有中文标签：${missingLabels.join(', ')}`)
}

// 按分类重排（组内保持 YAML 原序）：这一步就是「顺序由 CATEGORY_ORDER 决定」的实现。
const orderedEntries = CATEGORY_ORDER.flatMap((category) => entries.filter((entry) => entry.category === category))

/**
 * id 必须唯一。技能名会跨仓库重复，所以不能拿 name 当 id——冲突时明确报错，
 * 让人显式给一个区分的 id，而不是让生成器悄悄去重（那会静默吞掉一条收录）。
 */
const idSeen = new Map()
for (const entry of entries) {
  if (idSeen.has(entry.id)) throw new Error(`id 重复：${entry.id}（${idSeen.get(entry.id)} 与 ${entry.source}）`)
  idSeen.set(entry.id, entry.source)
}

// 文案里的半角 `#` 会被 YAML 当行内注释吃掉后半句（MCP 生成器踩过：一句话在卡片上断掉）。
for (const entry of entries) {
  for (const field of ['summary', 'license', 'source']) {
    const value = entry[field]
    if (typeof value !== 'string') continue
    if (value.includes('#')) {
      throw new Error(`${entry.id}.${field} 含半角 #，会被 YAML 当注释截断：${value.slice(0, 60)}`)
    }
    for (const [open, close] of [['（', '）'], ['(', ')']]) {
      const opens = value.split(open).length - 1
      const closes = value.split(close).length - 1
      if (opens !== closes) {
        throw new Error(`${entry.id}.${field} 括号不配对（${open}${opens} / ${close}${closes}）：${value.slice(0, 60)}`)
      }
    }
  }
}

/** 单引号安全的 JS 字面量。 */
const str = (value) => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

function renderEntry(entry) {
  // 先按证据优先级定出**实际适用**的许可（目录内许可文件 > frontmatter > 未核实），
  // 再交给门禁判定。两步分开是因为前者是「事实认定」，后者是「准入决定」。
  //
  // YAML 里 `license` 记的是**实际适用**的许可；若 frontmatter 的声明与之不符，另用
  // `licenseDeclared` 记下声明值——冲突本身是给用户的风险信号，不能在这一步被抹平。
  const governing = resolveGoverningLicense({
    frontmatterLicense: entry.licenseDeclared ?? entry.license,
    ...(entry.licenseFile !== undefined
      ? { licenseFile: { path: entry.licenseFile, spdx: entry.license } }
      : {}),
  })
  const verdict = classifyLicense({ spdx: governing.spdx })
  const lines = []
  const push = (key, value) => lines.push(`    ${key}: ${value},`)
  push('id', str(entry.id))
  push('name', str(entry.name))
  push('summary', str(entry.summary))
  push('category', str(entry.category))
  push('source', str(entry.source))
  push('path', str(entry.path))
  push('license', str(governing.spdx))
  if (entry.licenseFile) push('licenseFile', str(entry.licenseFile))
  // 声明与实际不一致是给用户的风险信号（真实样本：anti-ui-slop 声明 MIT、实为 Apache-2.0）。
  if (governing.conflict) push('licenseConflict', 'true')
  push('installable', String(verdict.installable))
  push('licenseReason', str(verdict.reason))
  push('scripts', String(entry.scripts === true))
  push('homepage', str(entry.homepage))
  return `  {\n${lines.join('\n')}\n  },`
}

const header = `// 技能市场目录 —— 「技能市场」的数据源。
//
// ⚠️ 本文件由 \`scripts/build-skills-catalog.mjs\` 从 \`.tasks/skills-verified.yaml\` 生成。
//    要增删条目请改那份 YAML（它逐条带来源与许可证据），然后重跑：
//
//      node scripts/build-skills-catalog.mjs
//
// 字段约定（\`test/skills-catalog.test.mjs\` 逐条校验）：
//
//   id           稳定短标识，**全局唯一**。技能名会跨仓库重复（同名技能来自不同来源是合法的），
//                所以 id 用 \`<name>@<owner>\` 形态区分，不能拿 name 当 id。
//   name         技能真名，必须匹配宿主的 kebab-case 规则——它同时是导入时的落盘名。
//   summary      一句话说明。
//   category     见 SKILL_CATEGORY_ORDER，市场按它分组。
//   source       \`owner/repo\`。市场卡片显示来源，也是用户判断可信度的主要依据。
//   path         仓库内相对路径（到技能目录）。安装时按它抓取。
//   license      许可**事实**（SPDX 或 Proprietary / Unverified）。
//   licenseFile  许可证据文件路径（如 \`skills/docx/LICENSE.txt\`）。判定必须可复核。
//   installable  ⚠️ **由 \`lib/skills-admission.js\` 的 classifyLicense() 在生成时算出**
//                （硬闸门，SPEC 约束 8）。不要在 YAML 里手写这一项——那会形成第二真相源，
//                改了规则却漏改数据，门禁就静默失效（测试会红）。
//   licenseReason 不可安装的原因，直接展示给用户。
//   scripts      是否随包提供可执行脚本（scripts/ 目录）。风险红绿灯靠它，必须离线可得。
//   homepage     官方仓库或文档。详情页的「文档」入口。
//
// 收录纪律：**宁可少，不可错**。一条装不上或不该装的技能比没有这条更糟——用户会以为是插件的锅。
// 许可必须**逐技能**判定（SPEC 约束 8）：同一仓库里既有 Apache-2.0 也有禁止本地留存的专有许可，
// 按仓库聚合两个方向都会错。
//
// ⚠️ 收录 ≠ 背书：技能正文会作为指令进入模型上下文，且可能含可执行脚本。本目录只做来源
//    白名单与许可校验，**不做安全审查**。

/**
 * 分类的展示顺序（唯一真相源）。
 *
 * 它靠重排下面的 \`SKILL_CATALOG\` 生效：面板 chips 取目录里的**首次出现序**。
 * 改顺序 = 改这里，不要手工重排 SKILL_CATALOG。中文标签见 SKILL_CATEGORY_LABELS。
 * @type {ReadonlyArray<string>}
 */
export const SKILL_CATEGORY_ORDER = [
${CATEGORY_ORDER.map((category) => `  ${str(category)},`).join('\n')}
]

/** 分类中文标签。与 SKILL_CATEGORY_ORDER 同集合（生成时校验）。 */
export const SKILL_CATEGORY_LABELS = {
${CATEGORY_ORDER.map((category) => `  ${str(category)}: ${str(CATEGORY_LABELS[category])},`).join('\n')}
}
`

const body = `
/**
 * 目录条目。字段含义见文件头。
 *
 * **数组顺序 = 市场的分类展示顺序**（按 SKILL_CATEGORY_ORDER 分段排布）。面板的 chips
 * 靠这个顺序渲染，所以不要为了顺手而手工重排——要改顺序请改生成器的 CATEGORY_ORDER。
 * @type {ReadonlyArray<object>}
 */
export const SKILL_CATALOG = [
${orderedEntries.map(renderEntry).join('\n')}
]

/**
 * 按 id 建索引。多个消费者（市场列表、详情页、安装路径）都用它，避免各自 \`find\`。
 * @param {ReadonlyArray<object>} [catalog] - 目录，缺省用内置目录。
 * @returns {Map<string, object>} id → 条目。
 */
export function skillCatalogById(catalog = SKILL_CATALOG) {
  return new Map(catalog.map((entry) => [entry.id, entry]))
}
`

writeFileSync(TARGET, header + body)

const blocked = orderedEntries.filter((entry) => !classifyLicense({ spdx: entry.license }).installable)
console.log(`已生成 ${TARGET}：${orderedEntries.length} 条 · ${CATEGORY_ORDER.length} 分类`)
console.log('分类顺序:', CATEGORY_ORDER.join(' → '))
console.log('来源:', [...new Set(orderedEntries.map((entry) => entry.source))].join(', '))
console.log(`许可门禁：可安装 ${orderedEntries.length - blocked.length} 条 · 阻断 ${blocked.length} 条`)
for (const entry of blocked) console.log(`  ✖ ${entry.name}（${entry.source}）：${entry.license}`)
