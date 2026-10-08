// 宿主侧 skills 读取层：把 ctx.skills 的目录投影成面板要的形状。
//
// 为什么需要这一层：宿主 SkillRegistry 返回的是「已生效的胜出条目」，而面板要的是
// 「可分别操作的行」——同名跨作用域各占一行、带作用域归属、能被界面直接渲染。
// 投影逻辑集中在这里，宿主契约的细节就不会漏进 UI。
//
// 本层只读：不写盘、不做启停（那些在 lib/skills-file-ops.js）。

import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'

// 宿主的 source 标签（见 dsh-skill-filesystem 的 roots()）：project-* 属项目级，
// 其余属全局级。这是唯一可靠的作用域依据——本机就没有 ~/.dsh/skills，技能全在
// ~/.agents/skills，所以不能靠路径猜作用域。
const PROJECT_SOURCES = new Set(['project-dsh', 'project-agents'])

/** 宿主目录捆绑的固定文件名（dsh-skill-filesystem 的 discoverRoot）。 */
const BUNDLE_FILE = 'SKILL.md'

function scopeOfSource(source) {
  return PROJECT_SOURCES.has(source) ? 'project' : 'global'
}

/**
 * 从宿主 summary 推出技能的**根目录**与**形态**。
 *
 * 为什么必须推而不是问：`ctx.skills` **不暴露 roots()**（实测公开面只有
 * registerProvider/register/list/snapshot/get/collect/...；roots() 在 filesystem provider 内部）。
 * 能用的线索只有 `resourceBase`——已用**真实 cordis Context + 真实宿主包**实测两种形态：
 *
 *   目录捆绑：path = `<技能目录>/SKILL.md`，resourceBase.path = `<技能目录>` → 根 = dirname(base)
 *   扁平文件：path = `<根>/<name>.md`，    resourceBase.path = `<根>`       → 根 = base
 *
 * 判别式必须用「path 是否**恰为** `<base>/SKILL.md`」。曾用「dirname(path) === base」判别——
 * 那个条件在两种形态下**都成立**（捆绑时 path 的父目录就是 base），不是判别式，会把扁平技能
 * 的根算成上一层（实测把 `~/.agents/skills` 算成了 `~/.agents`）。
 *
 * 推不出就返回空：宁可不填，也不猜一个根——猜错会让启停/删除作用在错误的目录上。
 *
 * @param {object} summary - 宿主 SkillSummary。
 * @returns {{ root?: string, kind?: 'bundle'|'flat' }}
 */
function locateSkill(summary) {
  const base = summary?.resourceBase?.path
  const path = summary?.path
  if (typeof base !== 'string' || base === '' || typeof path !== 'string' || path === '') return {}

  // 比较前统一分隔符：宿主给的是**本机原生**路径（Windows 上是反斜杠），而技能根也可能来自
  // 用户配置的 customSkillDirs（两种分隔符都写得出来）。join() 在这里不够——它是平台相关的，
  // 拿不到「另一种分隔符」的等价形式。返回值仍用**原生** base，不做转换（要给 fs 用）。
  const toSlashes = (value) => value.replace(/\\/g, '/')
  const baseSlashes = toSlashes(base)
  const pathSlashes = toSlashes(path)

  // 判别式：path 是否**恰为** <base>/SKILL.md（目录捆绑）。
  // 不能只看 dirname(path) === base —— 那种情况下扁平与捆绑都成立，会把扁平技能的根算成上一层。
  if (pathSlashes === `${baseSlashes}/${BUNDLE_FILE}`) return { root: dirname(base), kind: 'bundle' }
  if (dirname(pathSlashes) === baseSlashes) return { root: base, kind: 'flat' }
  // 形态与两种已知 locator 都不符：不猜。
  return {}
}

/** 取宿主 skills 服务；宿主的服务名就是 'skills'（dsh-skill 的 super(ctx, "skills")）。 */
function skillsService(ctx) {
  return typeof ctx?.get === 'function' ? ctx.get('skills') : undefined
}

/**
 * 把宿主的一条 SkillSummary 投影成面板行。
 * @param {object} summary - 宿主 SkillSummary。
 * @param {{ cwd?: string }} options - 该条目所属的查询作用域。
 * @returns {object} 面板行。
 */
function toView(summary, { cwd }) {
  const invocation = summary.invocation ?? {}
  const located = locateSkill(summary)
  return {
    name: summary.name,
    description: summary.description ?? '',
    ...(summary.whenToUse !== undefined ? { whenToUse: summary.whenToUse } : {}),
    modelInvocable: invocation.modelInvocable !== false,
    userInvocable: invocation.userInvocable !== false,
    source: summary.source ?? 'unknown',
    provider: summary.provider ?? 'unknown',
    scope: scopeOfSource(summary.source),
    // 根目录与形态推不出来就不填（上层据此提示「无法定位」，而不是作用在错的目录上）。
    ...(located.root !== undefined ? { root: located.root, kind: located.kind } : {}),
    ...(cwd !== undefined ? { cwd } : {}),
    ...(summary.path !== undefined ? { path: summary.path } : {}),
    // bundled 根只读（SPEC 约束 3）：启停与删除都必须被拒。
    writable: summary.source !== 'bundled',
  }
}

/**
 * 查询一个技能作用域下的全部技能。
 * @param {object} skills - 宿主 ctx.skills（或等价替身）。
 * @param {{ cwd?: string, signal?: AbortSignal }} options
 * @returns {Promise<object[]>}
 */
async function queryScope(skills, options) {
  // 不传 cwd 时宿主只扫用户级/自定义/bundled 根（provider 的 roots(cwd) 在
  // cwd === undefined 时不 push 项目根），这正是「全局」作用域要的。
  const { cwd, signal } = options
  const summaries = await skills.list(cwd === undefined ? { signal } : { cwd, signal })
  return summaries.map((summary) => toView(summary, { cwd }))
}

/**
 * 列出全部作用域的技能行。
 *
 * 为什么要「先全局、再逐项目，且项目查询只取项目级条目」：宿主在传 cwd 时返回的是
 * 「项目根 + 用户根 + bundled」的**完整合并视图**（provider 的 roots(cwd) 把项目根 push
 * 进 cwd 分支，而用户根与 bundled 根的 push 在该分支之外无条件执行）。所以项目查询的
 * 结果已经包含全局技能，直接 concat 会让每个全局技能在每个项目里各重复一份。
 *
 * @param {object} ctx - 宿主上下文（或 { get } 替身）。
 * @param {{ workspaces?: string[], signal?: AbortSignal }} options
 * @returns {Promise<object[]>}
 */
async function listSkillViews(ctx, options = {}) {
  const skills = skillsService(ctx)
  // 宿主可能没挂 dsh-skill（该内置插件可被用户禁用）。降级为空列表——抛错会让
  // 整个面板打不开，而空列表只影响技能这一块。
  if (!skills) return []

  const { workspaces = [], signal } = options
  const globalRows = await queryScope(skills, { signal })
  const projectGroups = await Promise.all(workspaces.map(async (cwd) => {
    const rows = await queryScope(skills, { cwd, signal })
    // 只保留该项目真正新增的条目：按 source 归属判定，而不是按名称做差集——
    // 同名跨作用域是合法配置（DSH 按 rank 裁决谁生效），按名称差集会把项目里
    // 那份同名技能误当成重复而丢掉。
    return rows.filter((row) => row.scope === 'project')
  }))
  return [...globalRows, ...projectGroups.flat()]
}

/**
 * 加载单个技能正文。
 * @param {object} ctx
 * @param {{ name: string, cwd?: string, signal?: AbortSignal }} options
 * @returns {Promise<object|undefined>}
 */
async function projectSkillRow(ctx, options) {
  const skills = skillsService(ctx)
  if (!skills) return undefined
  const { name, cwd, signal } = options
  const definition = await skills.get(name, cwd === undefined ? { signal } : { cwd, signal })
  if (definition === undefined) return undefined
  return { ...toView(definition, { cwd }), content: definition.content ?? '' }
}

/**
 * 目录内容指纹，供面板判断是否需要重渲染。
 *
 * 接受**已经查好的行**而不是重新查一次宿主：面板会频繁拉这个指纹，重新查会让宿主
 * 做两倍工作，而且两次查询之间技能可能被改动（撕裂视图）——指纹与实际渲染的行对不上，
 * 面板就会漏掉一次刷新。所以指纹必须是行集合的**纯函数**。
 *
 * @param {object[]} rows - listSkillViews 的结果。
 * @returns {string}
 */
function revisionOfSkillRows(rows) {
  // 只取影响展示与判定的字段：正文变化不该让目录重渲染（正文按需单独加载）。
  const material = (Array.isArray(rows) ? rows : [])
    .map((row) => [row.name, row.scope, row.source, row.description, row.modelInvocable, row.userInvocable, row.path ?? ''])
    .sort((left, right) => String(left[1] + left[0]).localeCompare(String(right[1] + right[0])))
  return createHash('sha256').update(JSON.stringify(material)).digest('hex')
}

export { listSkillViews, projectSkillRow, queryScope, revisionOfSkillRows }
