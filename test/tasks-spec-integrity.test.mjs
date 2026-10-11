// 规范层的机械闸：把「无悬空引用」「三件套不许再漂」这类散文承诺变成会红的用例。
//
// 为什么值得有：`SPEC.md` / `TODO.csv` / `PROGRESS.md` 是跨会话恢复的唯一真值，而它们的
// 引用（决策 id、约束编号、原型路径、行状态）没有任何编译期保护——写错了不报错，只会让
// 下一个会话按错的事实行动。本文件只断言**可机械判定**的部分：
//
//   - 三件套是否符合 zhanggui 协议的形状（SPEC 章节、PROGRESS 六字段、CSV 十列）；
//   - 每个被引用的决策 id / 约束编号是否可解析（悬空引用＝红）；
//   - SPEC 点名的仓库内路径是否真实存在（设计真值只写在未跟踪文件里＝红）；
//   - 行状态与 FinalizationStatus 是否自洽（写「complete」却还有未完成的行＝红）。
//
// 它**不**管「编号是不是指对了那条决策」——那需要语义判断，机械闸判不了，不该假装守着。
// 只读文本，不执行任何东西。
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const TASK = join(ROOT, '.tasks', 'toolbox-ui')
const SPEC_PATH = join(TASK, 'SPEC.md')
const TODO_PATH = join(TASK, 'TODO.csv')
const PROGRESS_PATH = join(TASK, 'PROGRESS.md')

// `.tasks/` 是开发期工件、不随 npm 包发布：只装了产物的 checkout 里它不存在，
// 那时跳过（而不是把「没有工件」判成失败）。本仓库里它必须存在。
const PRESENT = existsSync(SPEC_PATH) && existsSync(TODO_PATH) && existsSync(PROGRESS_PATH)
const spec = PRESENT ? readFileSync(SPEC_PATH, 'utf8') : ''
const todo = PRESENT ? readFileSync(TODO_PATH, 'utf8') : ''
const progress = PRESENT ? readFileSync(PROGRESS_PATH, 'utf8') : ''

/** RFC 4180 的最小实现：够用来校验字段数、引号与换行。 */
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quoted) {
      if (ch !== '"') { field += ch; continue }
      if (text[i + 1] === '"') { field += '"'; i += 1; continue }
      quoted = false
      continue
    }
    if (ch === '"') { quoted = true; continue }
    if (ch === ',') { row.push(field); field = ''; continue }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue }
    if (ch !== '\r') field += ch
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  // 去掉文件末尾的空行
  return rows.filter((cells) => cells.length > 1 || cells[0] !== '')
}

const CSV_HEADER = ['id', 'goal', 'boundary', 'related_files', 'sync_targets', 'depends_on', 'status', 'validation', 'completed_at', 'notes']
const STATUSES = new Set(['TODO', 'IN_PROGRESS', 'DONE', 'FAILED'])
const FINALIZATION = new Set(['active', 'pending-validation', 'pending-cleanup', 'complete'])

const csvRows = PRESENT
  ? parseCsv(todo).slice(1).map((cells) => Object.fromEntries(CSV_HEADER.map((key, index) => [key, (cells[index] ?? '').trim()])))
  : []

/** SPEC 决策表里的 id。`D2/D9` 是历史合并行：两个号指同一条决策，都要能解析。 */
const decisionIds = new Set()
for (const line of spec.split('\n')) {
  const match = /^\|\s*(D[0-9]+[a-z]?(?:\/D[0-9]+[a-z]?)*)\s*\|/.exec(line)
  if (!match) continue
  for (const id of match[1].split('/')) decisionIds.add(id)
}

/**
 * 已作废的 id（SPEC 里显式声明的一行）。它们必须**不在**决策表里，
 * 但引用它们的历史文字不该把闸门弄红——过期引用是事实，不是错误。
 */
const retiredIds = new Set(
  (/^Retired-ids:\s*(.+)$/m.exec(spec)?.[1] ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
)

/** 只取 Constraints 段：前言的 1./2./3. 维护纪律与附录里的 1./2./3. 改名纪律不是约束编号。 */
const constraintsSection = (() => {
  const start = spec.indexOf('**Constraints:**')
  const end = spec.indexOf('**Non-goals:**')
  return start >= 0 && end > start ? spec.slice(start, end) : ''
})()

/** SPEC 约束的编号（`12. **…**` 形态，只在 Constraints 段里数）。 */
const constraintNumbers = [...constraintsSection.matchAll(/^(\d+)\. \*\*/gm)].map((match) => Number(match[1]))

/** 会被引用扫描的文本：三件套 + 随包文档 + 源码 + 测试 + 脚本。 */
function filesIn(dir, filter) {
  let names
  try { names = readdirSync(join(ROOT, dir)) } catch { return [] }
  return names.filter((name) => filter.test(name)).map((name) => join(ROOT, dir, name))
}

const citationFiles = [
  SPEC_PATH,
  TODO_PATH,
  PROGRESS_PATH,
  ...filesIn('lib', /\.js$/),
  ...filesIn('test', /\.mjs$/),
  ...filesIn('scripts', /\.mjs$/),
  ...filesIn('docs', /\.md$/),
  join(ROOT, 'README.md'),
  join(ROOT, 'README.en.md'),
]
  // 定义基准的测试不能参与被测的那次扫描：本文件里有 `约束 8b` 这类**反面样例**文字，
  // 把它们算进去就等于用自己的样例把自己判红（这条教训本仓库付过代价，见 PROGRESS 教训 5）。
  .filter((path) => path !== fileURLToPath(import.meta.url))
  .filter((path) => existsSync(path))

test('SPEC 保持协议规定的章节形状', { skip: !PRESENT }, () => {
  for (const heading of ['**Goal:**', '**Decisions:**', '**Constraints:**', '**Non-goals:**', '**Architecture:**', '**Final validation:**']) {
    assert.ok(spec.includes(heading), `SPEC 缺少协议规定的字段：${heading}`)
  }
})

test('决策 id 唯一、形态合法，且没有把字母后缀当成新号', { skip: !PRESENT }, () => {
  assert.ok(decisionIds.size > 0, '决策表为空，取样范围疑似失效')
  // `D2b` 是历史 id；新的字母后缀一律不允许（那是「约束 8b」那一类漂移的入口）。
  const letterSuffixed = [...decisionIds].filter((id) => /^D\d+[a-z]$/.test(id) && id !== 'D2b')
  assert.deepEqual(letterSuffixed, [], `出现了新的字母后缀决策 id：${letterSuffixed.join(', ')}——新增只能追加无后缀的号`)
  for (const retired of retiredIds) {
    assert.ok(!decisionIds.has(retired), `${retired} 同时出现在决策表与 Retired-ids 里`)
  }
})

test('约束编号连续无缺口、无字母子项', { skip: !PRESENT }, () => {
  assert.ok(constraintNumbers.length > 0, '没有解析到任何约束，取样范围疑似失效')
  const expected = constraintNumbers.map((_, index) => index + 1)
  assert.deepEqual(constraintNumbers, expected,
    `约束编号必须是从 1 开始的连续整数（当前：${constraintNumbers.join(',')}）——子项要提升为独立编号，不能写成 8b/11b`)
})

test('每一处决策 id 引用都可解析（悬空引用＝红）', { skip: !PRESENT }, () => {
  const stragglers = []
  for (const path of citationFiles) {
    const text = readFileSync(path, 'utf8')
    for (const match of text.matchAll(/\bD\d+[a-z]?\b/g)) {
      const id = match[0]
      if (decisionIds.has(id) || retiredIds.has(id)) continue
      const line = text.slice(0, match.index).split('\n').length
      stragglers.push(`${path.slice(ROOT.length + 1)}:${line} → ${id}`)
    }
  }
  assert.deepEqual(stragglers, [], `这些决策 id 在 SPEC 决策表里解析不到：\n${stragglers.join('\n')}`)
})

test('每一处约束编号引用都可解析，且没有字母子项残留', { skip: !PRESENT }, () => {
  const max = constraintNumbers.length
  const stragglers = []
  for (const path of citationFiles) {
    const text = readFileSync(path, 'utf8')
    // `约束 8b` 这类历史写法：子项已被提升为独立编号，引用必须一起改。
    for (const match of text.matchAll(/约束\s*\d+[a-z]/g)) {
      const line = text.slice(0, match.index).split('\n').length
      stragglers.push(`${path.slice(ROOT.length + 1)}:${line} → ${match[0]}（字母子项已废）`)
    }
    for (const match of text.matchAll(/约束\s*([0-9][0-9/\s,、]*)/g)) {
      for (const token of match[1].split(/[/\s,、]+/).filter(Boolean)) {
        const number = Number(token)
        if (number >= 1 && number <= max) continue
        const line = text.slice(0, match.index).split('\n').length
        stragglers.push(`${path.slice(ROOT.length + 1)}:${line} → 约束 ${number}（超出 1..${max}）`)
      }
    }
  }
  assert.deepEqual(stragglers, [], `这些约束引用解析不到：\n${stragglers.join('\n')}`)
})

test('SPEC 点名的仓库内路径都真实存在', { skip: !PRESENT }, () => {
  // 只查「看起来就是仓库内文件」的引用：必须带文件扩展名。反引号里的东西多数不是路径
  // （`node:fs/promises`、`obra/superpowers`、`namespace/method`、`~/.dsh/skills`），
  // 用一个过宽的启发式会把它们全报成缺失，那样的闸门只会被人关掉。
  // 宿主包内部路径（`dsh-*/…`、`cordis/…`）与 npm scope（`@scope/name`）不归本仓库管。
  const repoFile = /\.(?:js|mjs|cjs|md|json|ya?ml|html|css|ts)$/
  const hostOwned = /^(?:@|dsh-|cordis|~|\$)/
  const missing = []
  for (const match of spec.matchAll(/`([^`\n]+)`/g)) {
    const candidate = match[1].trim().replace(/:\d+(?:-\d+)?$/, '')
    if (!candidate.includes('/')) continue
    if (candidate.includes('*') || candidate.includes('<') || candidate.includes(' ')) continue
    if (hostOwned.test(candidate) || !repoFile.test(candidate)) continue
    const resolved = [join(ROOT, candidate), join(TASK, candidate)]
    if (resolved.some((path) => existsSync(path))) continue
    const line = spec.slice(0, match.index).split('\n').length
    missing.push(`SPEC.md:${line} → ${candidate}`)
  }
  assert.deepEqual(missing, [], `SPEC 引用了不存在的路径（设计真值不许只活在未跟踪文件里）：\n${missing.join('\n')}`)
})

test('TODO.csv 符合协议列定义与行状态约束', { skip: !PRESENT }, () => {
  const header = parseCsv(todo)[0]
  assert.deepEqual(header, CSV_HEADER, 'CSV 表头必须与 zhanggui 协议一致（列的顺序也是协议的一部分）')

  const ids = csvRows.map((row) => Number(row.id))
  assert.deepEqual(ids, ids.map((_, index) => index + 1), `行 id 必须从 1 起连续（当前：${ids.join(',')}）`)

  const problems = []
  for (const row of csvRows) {
    if (!STATUSES.has(row.status)) problems.push(`row ${row.id}: status「${row.status}」不在枚举里`)
    if (!row.validation.trim()) problems.push(`row ${row.id}: validation 为空（每行都要有可执行验证）`)
    if (row.status === 'DONE') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.completed_at)) problems.push(`row ${row.id}: DONE 但 completed_at 不是日期`)
    } else if (row.completed_at) {
      problems.push(`row ${row.id}: 未完成却写了 completed_at`)
    }
    for (const token of row.depends_on.split(';').filter(Boolean)) {
      if (!ids.includes(Number(token))) problems.push(`row ${row.id}: depends_on「${token}」不是有效行号`)
    }
    // sync_targets 里带文件的那几种必须指向真实存在的文件
    for (const target of row.sync_targets.split(';').filter(Boolean)) {
      const [kind, ...rest] = target.split(':')
      if (!['test', 'doc', 'config'].includes(kind)) continue
      const path = rest.join(':')
      if (existsSync(join(ROOT, path)) || existsSync(join(TASK, path))) continue
      problems.push(`row ${row.id}: sync_targets 的 ${target} 指向不存在的文件`)
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'))
})

test('PROGRESS 有协议六字段，且状态不与行状态矛盾', { skip: !PRESENT }, () => {
  for (const field of ['Shape', 'FinalizationStatus', 'Truth', 'Current', 'Latest validation', 'Next']) {
    assert.match(progress, new RegExp(`^- ${field}: .+$`, 'm'), `PROGRESS 缺少协议字段：${field}`)
  }
  const finalization = /^- FinalizationStatus: (\S+)$/m.exec(progress)?.[1]
  assert.ok(FINALIZATION.has(finalization), `FinalizationStatus「${finalization}」不在协议枚举里`)

  // 这条是防「声明完成、实际还有活」的闸——本仓库真的漂过一次。
  const unfinished = csvRows.filter((row) => row.status !== 'DONE')
  if (finalization === 'complete') {
    assert.deepEqual(unfinished, [], `FinalizationStatus 是 complete，但还有未完成的行：${unfinished.map((row) => row.id).join(', ')}`)
  } else {
    assert.ok(unfinished.length > 0,
      `FinalizationStatus 是「${finalization}」却没有任何未完成的行——要么收口成 complete，要么状态写错了`)
  }
  const truth = /^- Truth: (.+)$/m.exec(progress)?.[1]
  assert.ok(truth.includes('.tasks/toolbox-ui/TODO.csv'), 'Truth 必须指向本任务的 TODO.csv')
})
