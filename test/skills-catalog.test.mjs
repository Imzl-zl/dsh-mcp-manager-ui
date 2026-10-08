// 技能市场目录的数据闸门。
//
// 与 MCP 目录同构（`test/mcp-catalog.test.mjs`），但有两处本质差异：
//
// 1. **许可判定不写进数据。** YAML 只记录**事实**（该技能的许可是什么、证据在哪个文件），
//    「能不能装」由 `lib/skills-admission.js` 的 `classifyLicense` 在生成时算出。这样许可门禁
//    只有**一处**实现——数据里写死 `installable: false` 会形成第二真相源，改了规则却漏改数据，
//    门禁就静默失效了。
// 2. **同一技能名可以来自不同仓库。** `test-driven-development` 在 obra/superpowers 与
//    github/awesome-copilot 里都有；`id` 必须唯一，而 `name` 是真正的安装名（两者不是一回事）。
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { SKILL_CATALOG, SKILL_CATEGORY_ORDER, SKILL_CATEGORY_LABELS, skillCatalogById } from '../lib/skills-catalog.js'
import { classifyLicense } from '../lib/skills-admission.js'

test('the committed catalog matches what the generator produces from the YAML', () => {
  // 「改了 YAML 忘了重跑生成器」是这份目录最可能的坏法，且没有任何其它用例会红：
  // 漏掉的改动留在 YAML 里，产物还是旧的，市场照常渲染、就是少一条。
  const generator = fileURLToPath(new URL('../scripts/build-skills-catalog.mjs', import.meta.url))
  const target = fileURLToPath(new URL('../lib/skills-catalog.js', import.meta.url))
  const before = readFileSync(target, 'utf8')
  const output = execFileSync(process.execPath, [generator], { encoding: 'utf8', timeout: 60_000 })
  const after = readFileSync(target, 'utf8')
  // 生成器就地改写产物：不一致时先还原，别让「跑一次测试」把工作区改脏。
  if (after !== before) writeFileSync(target, before)
  assert.equal(after, before,
    `lib/skills-catalog.js 与 YAML 不同步：跑 \`node scripts/build-skills-catalog.mjs\` 重新生成后提交。\n生成器输出：${output.trim().split('\n')[0]}`)
})

test('every entry carries the fields the market needs offline', () => {
  // 市场首屏必须**离线**可用（SPEC 约束 11）——风险红绿灯不能等到下载完才算。
  // 所以 scripts/与许可必须来自目录数据本身，而不是运行时扫描。
  for (const entry of SKILL_CATALOG) {
    const where = `目录项 ${entry.id}`
    assert.match(entry.id, /^[a-z0-9][a-z0-9-]*$/, `${where}: id 必须是小写连字符`)
    assert.match(entry.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${where}: name 必须是宿主认可的 kebab-case`)
    for (const field of ['summary', 'source', 'path', 'license', 'homepage', 'category']) {
      assert.equal(typeof entry[field], 'string', `${where}: ${field} 必须是字符串`)
      assert.ok(entry[field].trim().length > 0, `${where}: ${field} 不能为空`)
    }
    assert.match(entry.source, /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/, `${where}: source 必须是 owner/repo`)
    assert.ok(/^https?:\/\//.test(entry.homepage), `${where}: homepage 必须是 http(s) 地址`)
    assert.equal(typeof entry.scripts, 'boolean', `${where}: scripts 必须是布尔（风险红绿灯靠它）`)
    assert.equal(typeof entry.installable, 'boolean', `${where}: 生成器必须算出 installable`)
    // 不可安装的条目必须说明理由——市场卡片要显示「为什么不能装」。
    if (!entry.installable) {
      assert.ok(typeof entry.licenseReason === 'string' && entry.licenseReason.length > 0,
        `${where}: 不可安装时必须给出 licenseReason`)
    }
  }
})

test('the license gate is computed, never hand-written into the data', () => {
  // 这条是「单一真相源」的守卫：把每条目录项的许可事实重新喂给门禁，结果必须与产物一致。
  // 如果谁在 YAML/产物里手写 installable 来绕过规则，这里立刻红。
  const mismatched = []
  for (const entry of SKILL_CATALOG) {
    const verdict = classifyLicense({ spdx: entry.license })
    if (verdict.installable !== entry.installable) {
      mismatched.push(`${entry.id}(数据=${entry.installable} / 门禁=${verdict.installable})`)
    }
  }
  assert.deepEqual(mismatched, [],
    `这些条目的 installable 与许可门禁不一致（不得手写绕过）：${mismatched.join(', ')}`)
})

test('the four anthropics document skills are present but hard-blocked', () => {
  // SPEC 约束 8 的核心验收：docx/pdf/pptx/xlsx 的 LICENSE.txt 禁止「在服务之外保留副本」。
  // 它们必须在目录里**可见**（用户搜 pdf 时要能知道为什么没有），但**不可安装**。
  for (const name of ['docx', 'pdf', 'pptx', 'xlsx']) {
    const entry = SKILL_CATALOG.find((item) => item.name === name && item.source === 'anthropics/skills')
    assert.ok(entry, `目录里应有 anthropics/skills 的 ${name}（用于展示许可门禁）`)
    assert.equal(entry.installable, false, `${name} 必须不可安装`)
    assert.match(entry.license, /proprietary/i, `${name} 的许可以 Proprietary 记录`)
    // 证据要能追到具体文件，否则这个判定无法复核。
    assert.match(entry.licenseFile, /LICENSE\.txt$/, `${name} 必须记录许可证据文件`)
  }
})

test('per-skill licensing is respected instead of aggregated by repository', () => {
  // SPEC 约束 8：不得按仓库聚合。anthropics/skills 里既有专有（docx）也有 Apache-2.0（如
  // algorithmic-art），所以「同仓库不同判定」必须真实存在——否则说明有人偷偷按仓库归并了。
  const anthropic = SKILL_CATALOG.filter((entry) => entry.source === 'anthropics/skills')
  const blocked = anthropic.filter((entry) => !entry.installable)
  const allowed = anthropic.filter((entry) => entry.installable)
  assert.ok(blocked.length > 0, 'anthropics/skills 应有被硬阻断的技能')
  assert.ok(allowed.length > 0, 'anthropics/skills 应有可安装的技能（Apache-2.0 那批）')
  // 可安装的那批必须真的是宽松许可，不能是靠漏判混进来的。
  for (const entry of allowed) {
    assert.equal(classifyLicense({ spdx: entry.license }).verdict, 'permissive',
      `${entry.id} 声称可安装，但许可 ${entry.license} 不是宽松许可`)
  }
})

test('a skill with no license statement is blocked, never assumed permissive', () => {
  // `anthropics/skills` 的 doc-coauthoring 既无 LICENSE 文件也无 license 字段。
  // 没有授权就是不能装——这条钉住「未声明 ≠ 随便用」。
  const entry = SKILL_CATALOG.find((item) => item.name === 'doc-coauthoring' && item.source === 'anthropics/skills')
  assert.ok(entry, 'doc-coauthoring 应在目录里（用户能看到它为何不可装）')
  assert.equal(entry.installable, false, '未声明许可的技能必须不可安装')
})

test('catalog ids are unique even when skill names repeat across repositories', () => {
  const seen = new Map()
  for (const entry of SKILL_CATALOG) {
    assert.equal(seen.has(entry.id), false, `id 重复：${entry.id}（来自 ${entry.source}）`)
    seen.set(entry.id, entry)
  }
  assert.equal(skillCatalogById().size, SKILL_CATALOG.length)
  // 反向：名字**允许**重复（同名技能来自不同仓库是合法的），但此时 id 必须已经区分开。
  const byName = new Map()
  for (const entry of SKILL_CATALOG) {
    byName.set(entry.name, (byName.get(entry.name) ?? 0) + 1)
  }
  for (const [name, count] of byName) {
    if (count > 1) {
      const ids = SKILL_CATALOG.filter((entry) => entry.name === name).map((entry) => entry.id)
      assert.equal(new Set(ids).size, count, `${name} 出现 ${count} 次，但 id 未区分：${ids.join(', ')}`)
    }
  }
})

test('category order is the catalog order the market renders', () => {
  // 与 MCP 目录同一不变量：面板 chips 取目录里的**首次出现序**，所以 CATEGORY_ORDER
  // 只有在生成器按它重排之后才是真的「唯一真相源」。
  const seen = []
  for (const entry of SKILL_CATALOG) if (!seen.includes(entry.category)) seen.push(entry.category)
  assert.deepEqual(seen, [...SKILL_CATEGORY_ORDER],
    '目录的分类首次出现序必须等于 SKILL_CATEGORY_ORDER（生成器按它重排；别手工重排 SKILL_CATALOG）')
  const runs = SKILL_CATALOG.map((entry) => entry.category).filter((c, i, all) => c !== all[i - 1])
  assert.deepEqual([...new Set(runs)], runs, `同一分类被拆成多段，chips 顺序会失真：${runs.join(' -> ')}`)
})

test('every category has a label and at least one entry', () => {
  const used = new Set(SKILL_CATALOG.map((entry) => entry.category))
  for (const category of used) {
    assert.ok(SKILL_CATEGORY_ORDER.includes(category), `未登记的分类：${category}`)
    assert.ok(SKILL_CATEGORY_LABELS[category], `分类 ${category} 缺中文标签`)
  }
  // 声明了分类却一条都没有，会让 chips 出现空分组。生成器已会为此报错，这里再钉一次
  // （生成器被绕过时仍然拦得住）。
  for (const category of SKILL_CATEGORY_ORDER) {
    assert.ok(used.has(category), `分类 ${category} 声明了但目录里没有条目`)
  }
  // 标签与顺序同集合（生成器校验，这里复核产物）。
  assert.deepEqual(Object.keys(SKILL_CATEGORY_LABELS).sort(), [...SKILL_CATEGORY_ORDER].sort(),
    'SKILL_CATEGORY_LABELS 与 SKILL_CATEGORY_ORDER 必须同集合')
})

test('every entry points at a path that could actually hold a SKILL.md', () => {
  // path 是安装时抓取的目标。写成仓库根或带尾斜杠都会让抓取落空——
  // 这是「面板正常、安装失败」的典型成因，而 jsdom 测不出来。
  for (const entry of SKILL_CATALOG) {
    const where = `目录项 ${entry.id}`
    assert.equal(entry.path.startsWith('/'), false, `${where}: path 必须是仓库内相对路径`)
    assert.equal(entry.path.endsWith('/'), false, `${where}: path 不得带尾斜杠`)
    assert.equal(entry.path.includes('..'), false, `${where}: path 不得含 ..`)
    assert.match(entry.path, /^[A-Za-z0-9._/-]+$/, `${where}: path 含可疑字符`)
  }
})

test('a declared-vs-actual license conflict is surfaced, not smoothed over', () => {
  // 真实样本：github/awesome-copilot 的 anti-ui-slop，frontmatter 声明 MIT，
  // 但目录里带完整的 Apache-2.0 LICENSE + 第三方 NOTICE。若生成器直接采信声明，
  // 这条会被当 MIT 放行，而它实际带 Apache-2.0 §4 的 NOTICE 保留义务。
  // 所以「实际适用的许可」必须来自文件，且冲突要作为风险信号保留到产物里。
  const entry = SKILL_CATALOG.find((item) => item.id === 'awesome-copilot-anti-ui-slop')
  assert.ok(entry, 'anti-ui-slop 应在目录里')
  assert.equal(entry.license, 'Apache-2.0', '目录内的许可文件优先于 frontmatter 的声明')
  assert.equal(entry.licenseConflict, true, '声明与实际不符必须标记出来给用户看')
  assert.equal(entry.installable, true, 'Apache-2.0 本身是可安装的（NOTICE 义务由用户遵守）')
})

test('entries without a declared conflict do not carry the flag', () => {
  // 反向：标记不能滥发，否则「有冲突」这个信号会被噪音淹没。
  const flagged = SKILL_CATALOG.filter((entry) => entry.licenseConflict === true).map((entry) => entry.id)
  assert.deepEqual(flagged, ['awesome-copilot-anti-ui-slop'],
    `只有已核实的冲突才该标记，实际标记了：${flagged.join(', ')}`)
})

test('the superseded/archived skills repository is not catalogued', () => {
  // 核实期间发现的陷阱：`obra/superpowers-skills` 与 `obra/superpowers` **名字极像**，
  // 且前者的 README 里**没有**任何废弃横幅（归档状态只在 GitHub API/UI 可见）。
  // 它装着 31 个已被取代的技能（frontmatter 还用 Title Case，因为小写 kebab-case 的规范
  // 是在它归档 3 天后才落地的）。收录它 = 让用户装到一年前的旧版技能。
  // 这条把「不要把归档仓库当现役来源」钉进目录，防止将来有人凭名字搜到就加进去。
  const archived = SKILL_CATALOG.filter((entry) => entry.source === 'obra/superpowers-skills')
  assert.deepEqual(archived, [], 'obra/superpowers-skills 已归档，不得作为现役来源收录')
  // 正向下限：现役的那个确实在（否则上面那条空循环也能通过）。
  assert.ok(SKILL_CATALOG.some((entry) => entry.source === 'obra/superpowers'),
    'obra/superpowers 是现役来源，应被收录')
})

test('every source is one of the verified allowlisted repositories', () => {
  // SPEC 约束 9：市场来源必须白名单。这里把白名单写成显式清单——加新来源必须是一次
  // 有意的编辑，而不是「搜到什么就收什么」（skills.sh 的 source 字段实测含仿冒同名）。
  const ALLOWED = new Set([
    'anthropics/skills',
    'github/awesome-copilot',
    'obra/superpowers',
    'wshobson/agents',
  ])
  const unexpected = [...new Set(SKILL_CATALOG.map((entry) => entry.source))]
    .filter((source) => !ALLOWED.has(source))
  assert.deepEqual(unexpected, [], `这些来源不在白名单里：${unexpected.join(', ')}`)
})

test('skills that ship executable code are marked as such', () => {
  // scripts 标记来自人工核实（离线数据），风险红绿灯靠它。至少要有带脚本与不带脚本的两类，
  // 否则说明这个字段没接上（全 false 的循环空转也会「通过」）。
  assert.ok(SKILL_CATALOG.some((entry) => entry.scripts), '没有任何条目标记 scripts，疑似字段未接上')
  assert.ok(SKILL_CATALOG.some((entry) => !entry.scripts), '所有条目都标了 scripts，疑似标记过宽')
  // 已知事实：anthropics/skills 的 mcp-builder 与 xlsx 都带 scripts/。
  for (const name of ['mcp-builder', 'xlsx']) {
    const entry = SKILL_CATALOG.find((item) => item.name === name && item.source === 'anthropics/skills')
    assert.equal(entry.scripts, true, `${name} 带 scripts/，必须标出来`)
  }
})
