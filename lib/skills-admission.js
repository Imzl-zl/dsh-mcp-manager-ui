// 许可门禁与风险扫描（纯函数）。
//
// 这个模块决定「一条技能能不能装」。它是**硬闸门**（SPEC 约束 8），所以判定纪律是单向的：
// 拿不准就不放行。少收一条是可惜，错收一条是法律风险与安全风险。
//
// 两条关键设计：
//
// 1. **逐技能判定，不按仓库聚合。** 同一个 `anthropics/skills` 里，文档技能（docx/pdf/pptx/xlsx）
//    的 LICENSE.txt 禁止「在服务之外保留副本」，而同仓库的 `algorithmic-art` 是 Apache-2.0。
//    按仓库聚合会把能装的也一起毙掉，或把不能装的放进来——两个方向都错。
//
// 2. **白名单之外一律拒绝。** 只认明确列出的宽松许可；不认识的字符串判为 unknown 且不可安装。
//    这不是偷懒：许可领域「没见过的写法」无法安全地猜，而猜错的代价是把受限内容装进用户机器。
//
// 它不联网、不读磁盘：许可事实由 `.tasks/skills-verified.yaml` 逐条人工核实后喂进来
// （TODO row 6 的边界：「不联网、不读远端」）。

/**
 * 可安全安装的宽松许可（SPDX 标识）。
 *
 * 全部是允许再分发、允许在本地保留副本的许可——这是「能装到用户机器上」的最低条件。
 * 注意 GPL/AGPL 系列**故意不在**此表：它们要求衍生作品同样开源，把技能装进用户的私有
 * 项目会带来传染性义务，属于需要用户自己判断的事，不该由市场代为放行。
 */
const PERMISSIVE = new Set([
  'MIT',
  'APACHE-2.0',
  'BSD-2-CLAUSE',
  'BSD-3-CLAUSE',
  'ISC',
  'MPL-2.0',
  'CC0-1.0',
  'UNLICENSE',
  '0BSD',
])

/**
 * 明确禁止安装的许可特征。
 *
 * 每条是命中即拒绝的正则，针对的是**条款实质**而不是名称——同一段限制可以自称很多名字
 * （Proprietary / Source-available / 自造条款）。
 *
 * ⚠️ 这些正则必须按**真实条款的句法**写。首版就是在这里错的：它匹配
 * `may not retain copies outside`，而 anthropics/skills 的原文是
 * `Extract these materials from the Services or retain copies of these materials outside
 * the Services`——否定词在上一行的列表引导语里（`users may not:`），并不紧邻动作。
 * 结果是我自己改写的「简化版」用例绿了、真实文本却**漏过**，门禁形同虚设。
 * 现在每个模式都对着 git 克隆到的逐字原文校准，并由 test 里那段原文钉住。
 *
 * 另一个刻意的取舍：**不把 `All rights reserved` 当成拒绝特征**。它在 BSD-2/BSD-3 这类
 * 正常宽松许可里是标准开头，单看这句会误杀合法技能。纯专有文本没有显式限制时仍然会被
 * 挡住——因为它不在白名单里，走的是 unknown → 不可安装（fail-closed），不靠这句话兜。
 */
const FORBIDDEN_PATTERNS = [
  // 禁止在厂商服务之外保留副本（anthropics/skills 的第 1 条限制，也是它被硬阻断的原因）。
  /retain\s+copies?[^.\n]{0,80}?\boutside\b/i,
  /extract\s+(?:these|the|any)\s+materials?\s+from\s+the\s+services?/i,
  /\boutside\s+(?:of\s+)?the\s+services?\b/i,
  // 禁止复制（原文第 2 条）。
  /\breproduce\s+or\s+copy\b/i,
  // 禁止再分发/转授给第三方（原文第 4 条）。
  /(?:distribute|sublicense|transfer)[^.\n]{0,80}?\bthird\s+part/i,
  /may\s+not\s+(?:redistribute|distribute)/i,
  /no\s+redistribution/i,
  // 仅限非商业使用（技能会被装进公司项目，放行等于替用户踩线）。
  /non-?commercial\s+(?:use\s+)?only/i,
  /may\s+not\s+use\s+(?:this\s+)?for\s+commercial/i,
  // 仅限在特定服务/平台内使用。
  /solely\s+within\s+[^.\n]{0,40}?services?/i,
  // 「持有不等于授权」兜底声明（原文结尾那句）。
  /does\s+not\s+convey\s+or\s+imply\s+any\s+licen[cs]e/i,
]

/**
 * 规范化一个许可标识，便于比对。
 * @param {unknown} value
 * @returns {string}
 */
function normalizeSpdx(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    // `Apache 2.0` 与 `Apache-2.0` 是同一个东西，人工维护的目录里两种写法都会出现。
    .replace(/\s+/g, '-')
}

/**
 * 判定一条技能的许可是否可以安装。
 *
 * @param {{ spdx?: string, text?: string }} input - 声明的 SPDX 标识与（可选的）许可原文。
 * @returns {{ verdict: 'permissive'|'forbidden'|'unknown', installable: boolean,
 *   spdx?: string, reason: string }}
 */
export function classifyLicense(input = {}) {
  const { spdx, text } = input
  const normalized = normalizeSpdx(spdx)

  // 原文优先于声明：声明可能是错的、过时的或抄来的，而原文是法律文本本身。
  // 两者冲突时按**更严**的一方判（下面的用例钉住了这条）。
  if (typeof text === 'string' && text.length > 0) {
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(text)) {
        return {
          verdict: 'forbidden',
          installable: false,
          ...(normalized !== '' ? { spdx: spdx } : {}),
          reason: '许可原文禁止在服务之外保留副本或禁止再分发，本地安装属违约',
        }
      }
    }
  }

  if (normalized === '') {
    return { verdict: 'unknown', installable: false, reason: '未声明许可（没有许可即没有授权，默认不可安装）' }
  }
  if (PERMISSIVE.has(normalized)) {
    return { verdict: 'permissive', installable: true, spdx: spdx, reason: `许可 ${spdx} 允许本地保留与再分发` }
  }
  // 白名单之外一律不放行：可能是不兼容的 copyleft，也可能是没见过的自造条款。
  // 两种情况都不该由市场替用户拍板。
  return {
    verdict: 'unknown',
    installable: false,
    spdx: spdx,
    reason: `许可 ${spdx} 不在允许清单内，无法判定是否可本地安装`,
  }
}

/**
 * 判定一条技能**实际适用**的许可是什么。
 *
 * 优先级照实现陷阱校准（不是凭直觉定的）：**技能目录里的许可文件优先于 frontmatter**。
 * 真实样本：`github/awesome-copilot` 的 `anti-ui-slop` frontmatter 写 `license: MIT`，
 * 同目录却带完整的 Apache-2.0 LICENSE 与第三方 NOTICE——只信 frontmatter 的门禁会把它
 * 当 MIT 放行，而它实际带 Apache-2.0 §4 的 NOTICE 保留义务。这是「机器可读字段与实际不符」
 * 的真实案例，所以规则必须写进代码，不能只写在注释里。
 *
 * 反向也守住：**没有逐技能声明时不得回落到仓库级许可**（SPEC 约束 8 禁止按仓库聚合）。
 * `anthropics/skills` 就没有顶层 LICENSE，而 `doc-coauthoring` 既无文件也无字段——
 * 回落到仓库许可会让它被当成可安装，实际是「没有授权」。
 *
 * @param {{ frontmatterLicense?: string, licenseFile?: { path: string, spdx: string, text?: string },
 *   repositoryLicense?: string }} input
 * @returns {{ spdx: string, basis: 'license-file'|'frontmatter'|'none', conflict: boolean,
 *   licenseFile?: string, text?: string }}
 */
export function resolveGoverningLicense(input = {}) {
  const { frontmatterLicense, licenseFile, repositoryLicense } = input
  const declared = typeof frontmatterLicense === 'string' ? frontmatterLicense.trim() : ''

  if (licenseFile !== undefined && licenseFile !== null) {
    // 指针式声明（`Complete terms in LICENSE.txt`）不是许可名，与文件解析结果不同名不算冲突。
    const isPointer = /complete terms|see license|LICENSE\.txt/i.test(declared)
    const conflict = declared !== '' && !isPointer && normalizeSpdx(declared) !== normalizeSpdx(licenseFile.spdx)
    return {
      spdx: licenseFile.spdx,
      basis: 'license-file',
      conflict,
      ...(licenseFile.path !== undefined ? { licenseFile: licenseFile.path } : {}),
      ...(licenseFile.text !== undefined ? { text: licenseFile.text } : {}),
    }
  }

  if (declared !== '') return { spdx: declared, basis: 'frontmatter', conflict: false }

  // repositoryLicense 只作为**诊断信息**接收，绝不用于放行：没有逐技能声明就是未核实。
  void repositoryLicense
  return { spdx: 'Unverified', basis: 'none', conflict: false }
}

/** 把 allowed-tools 的各种写法归一成字符串数组。 */
function normalizeAllowedTools(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === 'string' && item.trim() !== '').map((item) => item.trim())
  }
  if (typeof value === 'string' && value.trim() !== '') {
    // 逗号分隔是常见写法（`Bash, Write`）。
    return value.split(',').map((item) => item.trim()).filter((item) => item !== '')
  }
  return []
}

/**
 * 扫描一条技能会给用户带来什么（安装确认弹窗的披露项）。
 *
 * 「技能正文进入模型上下文」是无条件的——技能就是靠正文作为指令生效的。它**不计入** level，
 * 否则每条技能都是黄灯、红绿灯就失去区分力；UI 应当把它作为固定的第一等披露项单独显示。
 * level 只反映**额外**的风险：可执行片段与声明的工具权限。
 *
 * @param {{ files?: string[], frontmatter?: object }} input
 * @returns {{ entersModelContext: boolean, hasScripts: boolean, scripts: string[],
 *   allowedTools: string[], level: 'none'|'disclosure' }}
 */
export function scanSkillRisks(input = {}) {
  const { files, frontmatter } = input
  const list = Array.isArray(files) ? files.filter((file) => typeof file === 'string') : []

  // 只认技能**根**的 scripts/ 目录。用前缀判断会把 `myscripts/`、`scripts-extra/`、
  // `docs/scripts/` 一起误报成可执行片段，让纯文档技能看起来危险。
  const scripts = list
    .map((file) => file.replace(/\\/g, '/'))
    .filter((file) => /^scripts\/.+/.test(file))
    .sort()

  const allowedTools = normalizeAllowedTools(frontmatter?.['allowed-tools'])
  const hasScripts = scripts.length > 0

  return {
    entersModelContext: true,
    hasScripts,
    scripts,
    allowedTools,
    level: hasScripts || allowedTools.length > 0 ? 'disclosure' : 'none',
  }
}
