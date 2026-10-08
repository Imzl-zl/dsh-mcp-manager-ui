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
 * 拆出 frontmatter 与正文，逐字照抄宿主 parseFrontmatter（dsh-skill-filesystem:780-806）。
 *
 * 宿主在这里的宽容度比一般实现低：首行必须**恰好**是 `---`（去尾随 `\r` 后比较），
 * 结束行同理。任何偏差都返回 ok:false，而不是猜一个边界。
 *
 * @param {string} raw - 技能文件全文。
 * @returns {{ ok: true, data: object, body: string } | { ok: false, code: string, message: string }}
 */
export function parseSkillFrontmatter(raw) {
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

  const start = firstLineEnd + 1
  const closing = findClosingFrontmatter(raw, start)
  if (closing === undefined) {
    return { ok: false, code: 'frontmatter-missing', message: '技能缺少 YAML frontmatter：找不到结束的 --- 行' }
  }

  let parsed
  try {
    parsed = parse(raw.slice(start, closing.start))
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
  return { ok: true, data: parsed, body: raw.slice(closing.bodyStart) }
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
