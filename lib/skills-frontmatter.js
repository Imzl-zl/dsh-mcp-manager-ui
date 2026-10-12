// frontmatter 校验与诊断。
//
// 为什么需要这一层：宿主发现非法技能时只做 `ctx.logger.warn(...)` 然后 **跳过**整条技能
// （dsh-skill-filesystem/lib/index.js:664-705）。用户和模型都看不到那条警告——技能就是
// 「莫名其妙不出现」。本层把那些静默跳过翻译成可展示的逐条诊断，这是「管理」面板相对
// 模型可见目录的第一个独有价值（第二个是已禁用技能，见 skills-file-ops.js）。
//
// 判定规则**一律照抄宿主源码**，不照抄外部规范：Claude Code 的 `when_to_use` 在 DSH 里
// 是被静默丢弃的字段，而 DSH 自己的 `whenToUse` 是驼峰。写反了不报错、只是不起作用，
// 所以两种都要能诊断出来。
//
// 唯一允许的宽容处是 issue 顺序：宿主按 name/description → 名字语法 → invocation 的顺序
// 校验，本层照抄该顺序，使 issues[0] 始终等于「宿主跳过的那个原因」。

import { parse } from 'yaml'

/** 与宿主同一套名字语法（dsh-skill/lib/index.js:17，本层独立声明以免依赖宿主包）。 */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** 宿主明确拒绝的驼峰式键 → 正确写法（dsh-skill-filesystem:850-861）。 */
const LEGACY_INVOCATION_KEYS = new Map([
  ['disableModelInvocation', 'disable-model-invocation'],
  ['modelInvocable', 'disable-model-invocation'],
  ['userInvocable', 'user-invocable'],
])

/**
 * 两个调用面字段的**唯一一份**语义声明：字段名 + 缺省值。
 *
 * 为什么必须只有一份：`disable-model-invocation` 的缺省是 false（不禁止），
 * `user-invocable` 的缺省是 true（可调用）——**方向相反**。写「停用/启用」要同时动这两个字段，
 * 任何一处把缺省方向记反，结果都是把「停用」写成「启用」，而且文件照样被改写、没有报错。
 * 所以字段名与缺省值只在这里声明，写入方（skills-file-ops）与展示方都从这里取。
 */
export const INVOCATION_FIELDS = {
  modelInvocable: { key: 'disable-model-invocation', absentMeans: false, inverted: true },
  userInvocable: { key: 'user-invocable', absentMeans: true, inverted: false },
}

/**
 * frontmatter 的字节范围——**解析与改写共用的唯一一套边界判据**。
 *
 * 为什么抽出来：读与写必须认同一个块。解析认得的块和改写动的块一旦分叉，后果是**静默改坏
 * 用户的技能文件**，而且只在手写的、形状不标准的文件上才会踩到——测试里最容易漏的那一类。
 *
 * @param {string} raw - 技能文件全文。
 * @returns {{ ok: true, fieldsStart: number, closingStart: number, bodyStart: number, eol: string }
 *   | { ok: false, code: string, message: string }} fieldsStart/closingStart 界定字段区，
 *   bodyStart 是正文起点，eol 是这份文件自己的行尾风格（插入新行时照用，别把 CRLF 写成混行）。
 */
function frontmatterSpan(raw) {
  if (typeof raw !== 'string') {
    return { ok: false, code: 'frontmatter-missing', message: '技能内容必须是文本' }
  }
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0) {
    return { ok: false, code: 'frontmatter-missing', message: '技能缺少 YAML frontmatter：文件只有一行' }
  }
  if (raw.slice(0, firstLineEnd).replace(/\r$/, '') !== '---') {
    return { ok: false, code: 'frontmatter-missing', message: '技能缺少 YAML frontmatter：首行必须是 ---' }
  }

  const fieldsStart = firstLineEnd + 1
  const closing = findClosingFrontmatter(raw, fieldsStart)
  if (closing === undefined) {
    return { ok: false, code: 'frontmatter-missing', message: '技能缺少 YAML frontmatter：找不到结束的 --- 行' }
  }
  return {
    ok: true,
    fieldsStart,
    closingStart: closing.start,
    bodyStart: closing.bodyStart,
    eol: raw[firstLineEnd - 1] === '\r' ? '\r\n' : '\n',
  }
}

/**
 * 拆出 frontmatter 与正文，逐字照抄宿主 parseFrontmatter（dsh-skill-filesystem:780-806）。
 *
 * 宿主在这里的宽容度比一般实现低：首行必须**恰好**是 `---`（去尾随 `\r` 后比较），
 * 结束行同理。任何偏差都返回 ok:false，而不是猜一个边界。
 *
 * @param {string} raw - 技能文件全文。
 * @returns {{ ok: true, data: object, body: string, span: object }
 *   | { ok: false, code: string, message: string }}
 */
export function parseSkillFrontmatter(raw) {
  const span = frontmatterSpan(raw)
  if (!span.ok) return span

  let parsed
  try {
    parsed = parse(raw.slice(span.fieldsStart, span.closingStart))
  } catch (error) {
    return {
      ok: false,
      code: 'frontmatter-invalid-yaml',
      message: `YAML frontmatter 解析失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, code: 'frontmatter-not-mapping', message: 'YAML frontmatter 必须是一个键值映射' }
  }
  // span 一并交出去：改写方要用**同一套**边界（见 frontmatterSpan 的说明），不该自己再算一遍。
  return { ok: true, data: parsed, body: raw.slice(span.bodyStart), span }
}

/** 找结束的 `---` 行（照抄宿主 findClosingFrontmatter:794-806）。 */
function findClosingFrontmatter(raw, start) {
  let lineStart = start
  while (lineStart <= raw.length) {
    const nextNewline = raw.indexOf('\n', lineStart)
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline
    if (raw.slice(lineStart, lineEnd).replace(/\r$/, '') === '---') {
      return { start: lineStart, bodyStart: nextNewline < 0 ? raw.length : nextNewline + 1 }
    }
    if (nextNewline < 0) return undefined
    lineStart = nextNewline + 1
  }
  return undefined
}

/** 照抄宿主 stringField（:841-844）：非空字符串才算存在。 */
function stringField(data, key) {
  const value = data[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * 照抄宿主 frontmatterBoolean（:863-878）：接受布尔、1/0 与 yes/on/no/off 等字符串，
 * 其它值抛错（宿主抛 TypeError → 整条技能被跳过）。
 */
function frontmatterBoolean(data, key) {
  if (!Object.hasOwn(data, key)) return undefined
  const value = data[key]
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1') return true
  if (value === 0 || value === '0') return false
  if (typeof value === 'string') {
    switch (value.toLowerCase()) {
      case 'true':
      case 'yes':
      case 'on':
        return true
      case 'false':
      case 'no':
      case 'off':
        return false
      default:
        break
    }
  }
  throw new TypeError(`frontmatter 字段 "${key}" 必须是布尔值`)
}

// ── 改写一个顶层布尔字段 ────────────────────────────────────────────────────
//
// 面板的「模型自动调用」开关就落在这里（写 SKILL.md 的 disable-model-invocation）。三条不变量：
//
//   1. **只动该动的那一行**：字段顺序、缩进、正文、行尾风格全部逐字保留。所以刻意不走
//      `parse → stringify`——那会把用户的文件整体重排（diff 噪声、丢注释），而技能文件是
//      **用户手写的资产**，不是我们的数据。
//   2. **语义先于文本**：先用宿主那套规则（frontmatterBoolean）算出当前值，已经是要的那个值
//      就原样返回 changed:false。于是「关掉」= 删掉那一行（缺省即 false），开关不留痕迹。
//   3. **读不准就抛错**：值跨行、不是布尔、YAML 本身读不动、有宿主拒绝的驼峰键、键写在解析器
//      认得而逐行扫描认不出的形状里（引号键 / 流式映射）、值带 YAML 锚点——一律拒绝并说清原因；
//      另外**打开**时若那一行带行尾注释也拒绝（**关掉**不受注释拦阻：整行删除的边界是确定的，
//      见下方那条「注释随行而去」的用例）。猜一个改法等于改坏用户的文件；说「我做不到」才是诚实的行为。

/** frontmatter 字段区里的每一行（含它自己的 `\r`，不含 `\n`）。 */
function frontmatterLines(raw, span) {
  const lines = []
  let lineStart = span.fieldsStart
  while (lineStart < span.closingStart) {
    const newline = raw.indexOf('\n', lineStart)
    const end = newline < 0 || newline > span.closingStart ? span.closingStart : newline
    lines.push({ start: lineStart, end, text: raw.slice(lineStart, end) })
    lineStart = end + 1
  }
  return lines
}

/** 这一行是不是**顶层**的 `key:`——缩进行属于别的字段或嵌套结构，不算。 */
function isTopLevelKey(text, key) {
  if (/^[ \t]/.test(text)) return false
  const content = text.endsWith('\r') ? text.slice(0, -1) : text
  const colon = content.indexOf(':')
  return colon >= 0 && content.slice(0, colon).trim() === key
}

/**
 * 把 frontmatter 里的一个顶层布尔字段改成目标值，其余字节原样保留。
 *
 * ⚠️ `absentMeans` 是**字段自己的语义**，不是实现细节：DSH 的两个调用面字段缺省方向**相反**——
 * `disable-model-invocation` 缺省 = false（不禁止），`user-invocable` 缺省 = true（可调用）。
 * 于是「表达目标值」的最干净写法也不同：与缺省同向就**删掉那一行**（缺省即它），
 * 反向才写字面量。两个字段共用这一处实现，方向由参数给——写反了会让「停用」变成「启用」，
 * 而且两个方向都会**静默**生效（文件照样被改写，只是语义反了）。
 *
 * @param {string} raw - 技能文件全文。
 * @param {string} key - 顶层字段名。
 * @param {boolean} value - 目标**语义值**（不是要写进文件的字面量）。
 * @param {boolean} [absentMeans=false] - 该字段缺席时等价于什么值。
 * @returns {{ text: string, changed: boolean }} changed 为 false 时 text 与输入逐字节相同。
 * @throws {Error} 形状读不准时抛错，绝不猜一个改法。
 */
export function setFrontmatterBoolean(raw, key, value, absentMeans = false) {
  const parsed = parseSkillFrontmatter(raw)
  if (!parsed.ok) throw new Error(`无法改写 frontmatter：${parsed.message}`)

  // 宿主对驼峰式旧键是**抛错**（整条技能被跳过，:850-861）。此时补一个规范键只会让两个键并存、
  // 宿主照样跳过——面板不能给出「我改好了」的假象，只能点名让用户自己改。
  for (const [legacy, canonical] of LEGACY_INVOCATION_KEYS) {
    if (canonical === key && Object.hasOwn(parsed.data, legacy)) {
      throw new Error(`frontmatter 里有宿主不支持的驼峰键 "${legacy}"（整条技能会被跳过）：请先手工改成 "${canonical}"`)
    }
  }

  let current
  try {
    current = frontmatterBoolean(parsed.data, key)
  } catch (error) {
    throw new Error(`无法改写 ${key}：${error instanceof Error ? error.message : String(error)}。宿主会因此跳过整条技能，请先手工修正这一行`)
  }
  // 「当前值」也按字段自己的缺省方向解读（缺省方向由调用方给，见函数头）。
  const currentValue = current === undefined ? absentMeans : current
  const desired = value === true
  if (currentValue === desired) return { text: raw, changed: false }
  // 目标值恰好等于该字段的缺省 → **删掉那一行**（缺席即它），而不是写一个与缺省同向的字面量：
  // 后者会让「开关不留痕迹」这条不变量失效（开→关→开 的往返不再逐字节还原原文）。
  //
  // ⚠️ 这两个概念必须分开：`deleteLine` 是**怎么做**，`desired` 才是**写什么值**。
  // 曾经把「要不要写字面量」这个布尔直接当成值插进文本，于是 `user-invocable`（缺省 true）
  // 的「关掉」被写成 `user-invocable: true`——一个语义完全相反的字段，而且照样返回 changed:true。
  const deleteLine = desired === absentMeans

  const lines = frontmatterLines(raw, parsed.span)
  const at = lines.findIndex((line) => isTopLevelKey(line.text, key))
  if (at < 0) {
    // ⚠️ 追加或删除的前提是「键**真的**不在」。行扫描认不出的形状是存在的：引号键（`"key": true`）与
    // 流式映射（`{key: true}`）解析器都认得、宿主也读得到（面板照它显示权限），
    // 而 isTopLevelKey 匹配不上那一行。此时两个判据分叉，**任何方向都不能动手**：
    //   · 追加 → 写出**第二个**同名键 → YAML 重复键让整份 frontmatter 报废（宿主跳过整条技能）；
    //   · 想删掉那一行 → 根本找不到行。
    // 曾经这一支对「目标值恰好等于缺省」的方向返回 changed:false，那是在**谎报「已经是目标态」**
    // ——解析出来的当前值与目标值明明是相反的（否则上面早就 no-op 返回了）。所以只取**解析结果**
    // 作判据：键在，就拒绝并说清原因。
    if (Object.hasOwn(parsed.data, key)) {
      throw new Error(`无法改写 ${key}：这个键写在解析器认得、逐行改写认不出的形状里（引号键或流式映射），请手工修改`)
    }
    // 键确实不在 → 走到这里只可能要求写字面量（等于缺省的话上面已经 no-op 返回了）。
    // 追加到 frontmatter 块**末尾**：插在 name/description 之前会把后面每个字段的 diff 都推一行，
    // 而这里没有任何理由去动别人的字段。
    return {
      text: raw.slice(0, parsed.span.closingStart) + `${key}: ${desired}` + parsed.span.eol + raw.slice(parsed.span.closingStart),
      changed: true,
    }
  }

  const line = lines[at]
  const next = lines[at + 1]
  // 续行守卫：下一行只要缩进，值就跨了行——删掉首行会留下孤儿缩进行，整份 frontmatter 随之报废。
  if (next !== undefined && /^[ \t]/.test(next.text)) {
    throw new Error(`无法改写 ${key}：这个字段的值跨了多行（下一行有缩进），逐行改写会破坏 YAML，请手工修改`)
  }

  const hasCr = line.text.endsWith('\r')
  const content = hasCr ? line.text.slice(0, -1) : line.text
  const colon = content.indexOf(':')
  const rest = content.slice(colon + 1)
  // 锚点守卫：布尔字面量里不可能出现 `&`，所以走到这里还见到它只可能是 YAML 锚点（`key: &flag true`）。
  // 这一行正给别处的 `*flag` 供值——整行删掉或就地换值都会让那个引用悬空、整份 frontmatter 报废。
  // 两个方向都拦，所以放在方向分支之前（判据同样取解析结果那一侧的事实，不猜文本）。
  if (rest.includes('&')) {
    throw new Error(`无法改写 ${key}：这个字段的值带 YAML 锚点（&），别处可能正引用它，请手工修改`)
  }

  if (!deleteLine) {
    // 能走到这里只可能是「当前值已在缺省侧、要写到非缺省侧」：就地把值换成目标字面量，
    // 键的位置不动。值是块标量或带行尾注释时不动手——那两种改法都得猜。
    if (rest.trim() === '' || rest.includes('#')) {
      throw new Error(`无法改写 ${key}：这一行不是「键: 简单值」的形状，请手工修改`)
    }
    const replaced = content.slice(0, colon + 1) + ` ${desired}` + (hasCr ? '\r' : '')
    return { text: raw.slice(0, line.start) + replaced + raw.slice(line.end), changed: true }
  }
  // 目标值 = 该字段的缺省：整行连同它自己的换行一起删掉，其余行与行尾风格不变。
  return { text: raw.slice(0, line.start) + raw.slice(line.end + 1), changed: true }
}

/**
 * 诊断一条技能原文，产出可展示的逐条诊断。
 *
 * @param {string} raw - 技能文件全文。
 * @returns {{ ok: boolean, name?: string, description?: string, whenToUse?: string,
 *   invocation?: { modelInvocable: boolean, userInvocable: boolean }, metadata?: object,
 *   body: string, issues: { code: string, level: 'error'|'warning', message: string }[] }}
 */
export function diagnoseSkill(raw) {
  const issues = []
  const add = (code, level, message) => issues.push({ code, level, message })

  const parsed = parseSkillFrontmatter(raw)
  if (!parsed.ok) {
    // 这三类都让宿主整条跳过，故都是 error（宿主给的是不同的 warn，本层保持可区分）。
    add(parsed.code, 'error', parsed.message)
    return { ok: false, body: '', issues }
  }

  const data = parsed.data
  const name = stringField(data, 'name')
  const description = stringField(data, 'description')

  // 顺序照抄宿主：name/description 的存在性先于名字语法。
  if (name === undefined) add('name-missing', 'error', 'frontmatter 缺少 name（宿主要求非空字符串）')
  if (description === undefined) add('description-missing', 'error', 'frontmatter 缺少 description（宿主要求非空字符串）')
  if (name !== undefined && !SKILL_NAME.test(name)) {
    add('name-invalid', 'error', `技能名 "${name}" 非法：只接受小写 kebab-case（/^[a-z0-9]+(?:-[a-z0-9]+)*$/）`)
  }

  // 驼峰式 invocation 键是宿主**抛错**的路径，最严重；做成 error 而不是 warning。
  for (const [legacy, canonical] of LEGACY_INVOCATION_KEYS) {
    if (Object.hasOwn(data, legacy)) {
      add('invocation-legacy-key', 'error', `frontmatter 字段 "${legacy}" 不被支持：请改用 "${canonical}"`)
    }
  }

  let invocation
  if (issues.every((issue) => issue.code !== 'invocation-legacy-key')) {
    try {
      const disableModelInvocation = frontmatterBoolean(data, 'disable-model-invocation')
      const userInvocable = frontmatterBoolean(data, 'user-invocable')
      invocation = {
        modelInvocable: disableModelInvocation !== true,
        userInvocable: userInvocable !== false,
      }
    } catch (error) {
      add('invocation-invalid-boolean', 'error', error instanceof Error ? error.message : String(error))
    }
  }

  // whenToUse 是可选字段，出问题只降级不致命——但必须说出来，否则用户会以为它生效了。
  let whenToUse
  if (Object.hasOwn(data, 'when_to_use')) {
    add(
      'when-to-use-snake-case',
      'warning',
      'DSH 不识别 when_to_use（那是 Claude Code 的字段），该字段被忽略；请改用驼峰 whenToUse',
    )
  }
  if (Object.hasOwn(data, 'whenToUse')) {
    const value = data.whenToUse
    if (typeof value === 'string' && value.length > 0) whenToUse = value
    else add('when-to-use-ignored', 'warning', 'whenToUse 必须是非空字符串，否则会被宿主忽略')
  }

  let metadata
  if (Object.hasOwn(data, 'metadata')) {
    const value = data.metadata
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) metadata = value
    else add('metadata-ignored', 'warning', 'metadata 必须是键值映射，否则会被宿主忽略')
  }

  const ok = issues.every((issue) => issue.level !== 'error')
  return {
    ok,
    ...(name !== undefined ? { name } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(whenToUse !== undefined ? { whenToUse } : {}),
    ...(invocation !== undefined ? { invocation } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
    // 宿主在读取正文时 trim（dsh-skill-filesystem:703）；这里同样给出 trim 后的正文，
    // 而 parseSkillFrontmatter 保留原样——想看原始切片的人仍能拿到。
    body: parsed.body.trim(),
    issues,
  }
}
