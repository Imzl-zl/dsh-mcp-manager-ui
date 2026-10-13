// 生成器纯逻辑的闸门。
//
// 为什么值得单测而不是只靠「重跑生成器比对字节」：字节比对只能证明「产物与 YAML 同步」，
// 证明不了**守卫会响**。而本文件的每个 throw 都对应一种真实坏法——YAML 截断、译文丢警告、
// 译文改配置——它们的共同点是坏得悄无声息（产物看着正常，真机才出事）。守卫没有会红的
// 用例，就等于没有守卫。
//
// 生成器把纯逻辑（buildCatalog 与各 assert*）提成了导出函数、主流程收进 main()，
// 所以这里 import 它不会读文件、不会写产物。
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  TRANSLATABLE,
  assertConfigParity,
  assertCopyComplete,
  assertCopySafe,
  assertRawCopyLines,
  assertWarningsPreserved,
  buildCatalog,
} from '../scripts/build-catalog.mjs'

/** buildCatalog 要求 CATEGORY_ORDER 的每个分类都至少有一条（空分类 = 市场多一个空 chips
 *  分组，生成器宁可报错）。夹具因此按全部分类各生成一条。 */
const CATEGORIES = ['search', 'dev', 'security', 'data', 'ai', 'browser', 'cloud', 'productivity', 'files', 'comms']

/** 夹具条目：中英两份从同一份数据显式生成——不靠正则替换（全角标点一字符之差就静默失配）。 */
const ENTRIES = CATEGORIES.map((category, index) => ({
  id: `srv-${index}`,
  category,
  zh: {
    label: `服务${index}`,
    summary: `测试条目${index}`,
    vendor: `提供方${index}`,
    access: index === 1 ? '免费1；⚠️ 静态 Token 未获官方确认，可能无法授权' : `免费${index}`,
  },
  en: {
    label: `Service ${index}`,
    summary: `Test entry ${index}`,
    vendor: `Vendor ${index}`,
    access: index === 1
      ? 'Free1; ⚠️ static-token auth is not officially confirmed, may fail to authorize'
      : `Free${index}`,
  },
}))

/** 渲染一份 YAML 目录原文。lang 选中英文案；args 的占位符按语言给（译文允许译它）。 */
function fixture(lang) {
  const entries = ENTRIES.map((entry) => {
    const copy = entry[lang]
    const placeholder = lang === 'zh' ? '<仓库路径>' : '<repository path>'
    return `- id: ${entry.id}
  label: ${copy.label}
  summary: ${copy.summary}
  category: ${entry.category}
  vendor: ${copy.vendor}
  access: ${copy.access}
  transport: stdio
  command: uvx
  args: ['mcp-${entry.id}', '${placeholder}']
  homepage: https://example.com/${entry.id}`
  }).join('\n\n')
  return `# 目录（测试夹具·${lang}）\n\n\`\`\`yaml\n${entries}\n\`\`\`\n`
}

const zhFixture = () => fixture('zh')
const enFixture = () => fixture('en')

test('the English copy is optional: its absence yields a Chinese-only product', () => {
  // 副本缺席是**合法状态**（文档化的老行为）：产物只有中文，面板回落中文。
  // 这条同时钉住「缺席不崩」与「不写空壳 *En 键」——空壳会让面板以为有英文，
  // 显示一句空话（比显示中文更糟）。
  const { content, withEnglish, entries } = buildCatalog(zhFixture())
  assert.equal(withEnglish, false)
  assert.equal(entries, CATEGORIES.length)
  assert.match(content, /export const MCP_CATALOG = \[/)
  for (const field of TRANSLATABLE) {
    assert.doesNotMatch(content, new RegExp(`${field}En:`), `缺席时不得写 ${field}En 空壳`)
  }
  // 中文基准字段一个不少（含占位符提示）。
  assert.match(content, /label: '服务0'/)
  assert.match(content, /placeholders: \['<仓库路径>'\]/)
})

test('a complete English copy flows into the product, placeholders included', () => {
  const { content, withEnglish } = buildCatalog(zhFixture(), enFixture())
  assert.equal(withEnglish, true)
  assert.match(content, /labelEn: 'Service 0'/)
  assert.match(content, /accessEn: 'Free1; ⚠️ static-token auth is not officially confirmed/)
  // 分类英文名与占位符英文提示都随产物下发（面板按语言挑）。
  assert.match(content, /categoryLabelEn: 'Search'/)
  assert.match(content, /placeholdersEn: \['<repository path>'\]/)
  // 配置数据仍只有中文一份：args 里除占位符外不得被译文改动。
  assert.match(content, /args: \['mcp-srv-0', '<仓库路径>'\]/)
})

test('an unquoted half-width # in either copy throws before YAML can truncate it', () => {
  // 真踩过：gitlab 的 access 在「issue #586184」处被 YAML 当行内注释截断，市场卡片上
  // 显示一句断掉的话。解析后的值看不见 #（那一层就没了），所以判据在**原始文本**上，
  // 且中英文两份都查——英文出现 issue 号 / C# / #channel 的概率比中文高。
  const zh = zhFixture()
  const en = enFixture()
  assert.throws(
    () => buildCatalog(zh, en.replace('summary: Test entry 0', 'summary: Test entry 0; see issue #1234')),
    /非引号值含半角 #/,
  )
  assert.throws(
    () => buildCatalog(zh.replace('summary: 测试条目0', 'summary: 测试条目0；见 issue #1234')),
    /非引号值含半角 #/,
  )
  // 引号值里的 # 是字面量，安全——不应误伤。
  assert.doesNotThrow(() => buildCatalog(zh, en.replace('summary: Test entry 0', 'summary: "Test entry 0; see issue #1234"')))
})

test('a dropped warning in the English copy throws ("do not beautify")', () => {
  // 中文 access 的 ⚠️ 警告必须原样带到英文：丢一次，英文用户就少一条
  // 「这条路未获官方确认、可能授权失败」的告知（gitlab/netlify 真事）。
  const en = enFixture().replace(
    'access: Free1; ⚠️ static-token auth is not officially confirmed, may fail to authorize',
    'access: Free1',
  )
  assert.throws(() => buildCatalog(zhFixture(), en), /丢掉了中文的 ⚠️ 警告/)
})

test('config data may not come from the translation copy', () => {
  // 译文只带文案。改 command/flag 一律抛——<占位符> 除外（那是显示提示，译文才是对的）。
  const zh = zhFixture()
  const en = enFixture()
  assert.throws(
    () => buildCatalog(zh, en.replace("args: ['mcp-srv-0', '<repository path>']", "args: ['mcp-srv-0', '--extra-flag']")),
    /srv-0\.args 与中文不一致/,
  )
  // 反方向：英文副本多出中文里没有的字段，同样是漂移。
  assert.throws(
    () => buildCatalog(zh, en.replace('  vendor: Vendor 0', '  vendor: Vendor 0\n  notes: 译文私货')),
    /是中文里没有的字段/,
  )
  // 占位符译了不算漂移（complete-copy 那条已从正面钉住）。
  assert.doesNotThrow(() => assertConfigParity(
    { id: 'x', args: ['mcp-x', '<仓库路径>'] },
    { id: 'x', args: ['mcp-x', '<repository path>'] },
  ))
})

test('a present-but-empty English value throws instead of being silently skipped', () => {
  // 静默跳过空值会让下游报「缺 summaryEn」却不指向英文 YAML——排错的人拿着产物一头雾水。
  const en = enFixture().replace('summary: Test entry 0', 'summary: ""')
  assert.throws(() => buildCatalog(zhFixture(), en), /英文副本 srv-0\.summary 是空串/)
  assert.throws(() => assertCopyComplete('alpha', { summary: '   ' }), /alpha\.summary 是空串/)
  // 整个键缺席不抛（回落中文）。
  assert.doesNotThrow(() => assertCopyComplete('alpha', {}))
})

test('copy shape mismatches throw with readable messages', () => {
  const zh = zhFixture()
  const en = enFixture()
  // 删掉副本的最后一条（保留结尾围栏）。
  const dropped = en.replace(/\n- id: srv-9\n[\s\S]*$/, '\n```\n')
  assert.throws(() => buildCatalog(zh, dropped), /条数不一致：中文 10 条 \/ 英文 9 条/)
  assert.throws(() => buildCatalog(zh, en.replace('- id: srv-3', '- id: srv-x')), /英文副本缺少条目：srv-3/)
})

test('unbalanced parentheses in copy throw (the truncation aftermath)', () => {
  // 括号不配对是「截断留下未闭合括号」的残局检测，也是手误检测。
  assert.throws(() => assertCopySafe('alpha', 'access', '免费（未闭合'), /括号不配对/)
  assert.throws(() => assertCopySafe('alpha', 'summary', 'balanced (half'), /括号不配对/)
  assert.doesNotThrow(() => assertCopySafe('alpha', 'access', '免费（配对）'))
})

test('the warning gate keys off the Chinese source, not the English text', () => {
  // 中文没警告 → 不要求英文有（避免把正常条目误判）。
  assert.doesNotThrow(() => assertWarningsPreserved({ id: 'x', access: '免费' }, { id: 'x', access: 'Free' }))
  // 中文有警告 → 英文必须有。
  assert.throws(
    () => assertWarningsPreserved({ id: 'x', access: '免费｜⚠️ 注意' }, { id: 'x', access: 'Free' }),
    /丢掉了中文的 ⚠️ 警告/,
  )
})

test('the raw-line guard ignores quoted values and non-copy fields', () => {
  // 只查 label/summary/access/vendor 四个文案字段；url/command 里的 #（片段标识符）不管。
  assert.doesNotThrow(() => assertRawCopyLines('- id: x\n  url: https://example.com/#anchor\n', 'fixture'))
  assert.doesNotThrow(() => assertRawCopyLines('- id: x\n  label: "A # B"\n', 'fixture'))
  assert.throws(() => assertRawCopyLines('- id: x\n  label: A # B\n', 'fixture'), /第 2 行 label/)
})
