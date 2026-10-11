// 宿主侧 skills 读取层：把 ctx.skills 的目录投影成面板要的形状。
//
// 为什么需要这一层：宿主 SkillRegistry 返回的是「已生效的胜出条目」，而面板要的是
// 「可分别操作的行」——同名跨作用域各占一行、带作用域归属、能被界面直接渲染。
// 投影逻辑集中在这里，宿主契约的细节就不会漏进 UI。
//
// 本层只读：不写盘、不做启停（那些在 lib/skills-file-ops.js）。

import { access, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { readSkillDocument, resolveSkillTarget, SkillNotFoundError } from './skills-file-ops.js'

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
 * 借一个「Agent preset 作用域」，用于读取 preset 局部注册的技能。
 *
 * 为什么必须有这一层：宿主 `dsh-web-app` **有意**把基础行 `skill-filesystem` 置为
 * `disabled: true`，改由**每个 agent preset 各自挂一份**（`presets/standard.patch.yml` 等），
 * 于是文件系统 provider 注册进的是**该 preset 的作用域层**，而 `dsh-skill` 的注册表是按层合并的：
 * 读取时只合并「全局层 + 查看作用域链」。本插件的 RPC 跑在宿主层，直接 `skills.list({})`
 * 因此**只能看到 bundled 那一个**，用户装在 `~/.agents/skills` 的技能一个都看不到。
 *
 * 宿主的官方读法（`dsh-api-session-controller` 的 `sessionSkillCatalog`）正是：
 *   `const lease = await agentPresets.acquireScope(presetId); skills.list({ cwd, scope: lease.key })`
 * 它的文档明确写着 “Resolve a live or standing preset scope **without creating an Agent**”，
 * 所以这里不违反 SPEC 约束 14（面板的读取不得依赖存在活动会话）。
 *
 * 归还：租约是 `AsyncDisposable`，必须用完就释放（它内部有 users 计数，不释放会留住那一代）。
 * 拿不到服务（旧宿主、或没装 preset 注册表）时返回 undefined，调用方退回原来的全局读取。
 *
 * @param {object} ctx - 宿主上下文（或 { get } 替身）。
 * @returns {Promise<{ scope?: object, dispose: () => Promise<void> }>} scope 为 undefined 表示不可用。
 */
async function presetScope(ctx) {
  const presets = typeof ctx?.get === 'function' ? ctx.get('agentPresets') : undefined
  if (presets === undefined || typeof presets.acquireScope !== 'function') return { scope: undefined, dispose: async () => {} }
  let lease
  try {
    // 不传 id 时宿主用 defaultId（当前选中的默认 preset）——与「用户即将开的新会话看到什么」一致。
    lease = await presets.acquireScope()
  } catch {
    // preset 未注册/损坏：退回全局读取，不让技能面板整体失败。
    return { scope: undefined, dispose: async () => {} }
  }
  if (lease === undefined || lease.key === undefined) return { scope: undefined, dispose: async () => {} }
  return {
    scope: lease.key,
    dispose: async () => {
      try {
        await lease[Symbol.asyncDispose]?.()
      } catch {
        // 释放失败不该把一个已经成功的读取变成错误。
      }
    },
  }
}

/** 「这个技能读不到」：定位不到，或文件系统层面读不了（已被删、无权限、目录不可达）。 */
function isUnreadable(error) {
  if (error instanceof SkillNotFoundError) return true
  return typeof error?.code === 'string' && /^E[A-Z]+$/.test(error.code)
}

/**
 * 一行的调用权限——**一律来自技能文件本身**，不取宿主的发现缓存。
 *
 * 为什么不能用宿主 summary 里的那份：summary 是**发现缓存**（同一个文件被改写后它继续报旧值，
 * 改名场景已实测复现，见 list() 里那段「陈旧行」的说明）。而调用权限正是本面板要**写**的东西：
 * 写盘后显示回退，用户看到的是「点了没反应」；更糟的是把缓存里的旧值当事实展示。
 * 行与详情因此都从这个文件的字节里解析——它们与用户看到的正文同源。
 *
 * 读不到就是 `null`（不知道）：宿主缓存可能指向一个已经被删/搬走的技能，此时「能不能被模型调用」
 * 没有答案，编一个布尔值就是让面板撒谎。
 *
 * @param {{ name: string, root?: string, scope: 'global'|'project' }} row
 * @returns {Promise<{ modelInvocable: boolean|null, userInvocable: boolean|null }>}
 */
async function invocationOf(row) {
  const unknown = { modelInvocable: null, userInvocable: null }
  if (typeof row?.name !== 'string' || typeof row?.root !== 'string' || row.root === '') return unknown
  try {
    const target = await resolveSkillTarget({ name: row.name, root: row.root, scope: row.scope })
    const { invocation } = await readSkillDocument(target)
    return {
      modelInvocable: invocation?.modelInvocable ?? null,
      userInvocable: invocation?.userInvocable ?? null,
    }
  } catch (error) {
    // 只吞「读不到」这一类；其余错误照原样抛——把 bug 说成「未知」等于把缺陷埋起来。
    if (isUnreadable(error)) return unknown
    throw error
  }
}

/**
 * 把宿主的一条 SkillSummary 投影成面板行。
 * @param {object} summary - 宿主 SkillSummary。
 * @param {{ cwd?: string }} options - 该条目所属的查询作用域。
 * @returns {Promise<object>} 面板行。
 */
async function toView(summary, { cwd }) {
  const located = locateSkill(summary)
  const scope = scopeOfSource(summary.source)
  // 调用权限**不读** summary.invocation：那一份来自宿主的发现缓存（见 invocationOf 的说明）。
  const invocation = await invocationOf({ name: summary.name, root: located.root, scope })
  return {
    name: summary.name,
    description: summary.description ?? '',
    ...(summary.whenToUse !== undefined ? { whenToUse: summary.whenToUse } : {}),
    ...invocation,
    source: summary.source ?? 'unknown',
    provider: summary.provider ?? 'unknown',
    scope,
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
 * @param {{ cwd?: string, scope?: object, signal?: AbortSignal }} options
 * @returns {Promise<object[]>}
 */
async function queryScope(skills, options) {
  // 不传 cwd 时宿主只扫用户级/自定义/bundled 根（provider 的 roots(cwd) 在
  // cwd === undefined 时不 push 项目根），这正是「全局」作用域要的。
  // `scope` 决定合并哪些**层**：preset 挂的 provider 只在该 preset 的层里，
  // 不传就只看得到宿主层的 bundled（见 presetScope 的说明）。
  const { cwd, scope, signal } = options
  const request = {
    ...(cwd === undefined ? {} : { cwd }),
    ...(scope === undefined ? {} : { scope }),
    ...(signal === undefined ? {} : { signal }),
  }
  const summaries = await skills.list(request)
  return await Promise.all(summaries.map((summary) => toView(summary, { cwd })))
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
  // 借默认 preset 的作用域：用户技能由 preset 挂的 provider 提供，宿主层看不到（见 presetScope）。
  const lease = await presetScope(ctx)
  try {
    const globalRows = await queryScope(skills, { scope: lease.scope, signal })
    const projectGroups = await Promise.all(workspaces.map(async (cwd) => {
      const rows = await queryScope(skills, { cwd, scope: lease.scope, signal })
      // 只保留该项目真正新增的条目：按 source 归属判定，而不是按名称做差集——
      // 同名跨作用域是合法配置（DSH 按 rank 裁决谁生效），按名称差集会把项目里
      // 那份同名技能误当成重复而丢掉。
      return rows.filter((row) => row.scope === 'project')
    }))
    return [...globalRows, ...projectGroups.flat()]
  } finally {
    await lease.dispose()
  }
}

/**
 * 加载单个技能正文的旧路径：**已被 detail 的按根读取取代**（2026-10-10）。
 *
 * 为什么删掉而不是留着：`ctx.skills.get(name)` 按 rank 返回**生效者**，与面板
 * 「(name, root) 精确操作」的模型（D8）冲突——点被遮蔽的那行会读到生效者的正文。
 * 现在的 detail 走 `resolveTargetReference` + `resolveSkillTarget` + `readSkillDocument`，
 * 既精确到根，又能读出已停用技能的 `.disabled` 正文（并顺带从同一份字节里给出调用权限）。
 */

// ── 安装目标（skillTargets）───────────────────────────────────────────────
//
// 为什么需要这一层：面板的「安装到」原来只能列**已经存在、并且已经有技能**的位置——
// 候选来自实际发现（约束 12）。于是两种真实需求无处可选：
//   · 想装到 `~/.dsh/skills`（DSH 原生位置，本机还没建）；
//   · 想给一个还没建技能目录的项目装一份。
// 用户问的正是这个（「用户没有选择的权力？」）。
//
// 为什么不能写死路径：`~` 随 DSH_HOME 走、项目根要往上找到 `.git`、custom 目录来自用户配置。
// 这些规则的**真值**在 `@deepseek-ai/dsh-skill-filesystem` 的 `roots(cwd)` 里（随宿主发布）。
// 本函数照抄那份规则，并直接从 loader 树里读**它真正在用的 config**，而不是自己另猜一份：
//   1) `providerConfig(ctx)` 按包名找到那个 provider 条目，取它的 `config`；
//   2) `resolveDshHome` 三行照抄 `@deepseek-ai/dsh-home-paths`（本仓库解析不到那个包，
//      否则就该直接 import——真值来自它的 lib/index.js）；
//   3) `findProjectRoot` 照抄 provider 的实现：往上找含 `.git` 的目录，找不到就用原路径。
// ⚠️ provider 改算法时这里要一起改；语义由 test/skill-targets.test.mjs 钉住。

/** 宿主的 source 档位与 rank（与 provider 的 *_RANK 常量、docs/skills.md 的表一致）。 */
const SKILL_SOURCE_RANK = {
  'project-dsh': 100,
  'project-agents': 200,
  custom: 300,
  'user-dsh': 400,
  'user-agents': 500,
  bundled: 600,
}
const DSH_HOME_ENV = 'DSH_HOME'
const AGENTS_HOME_ENV = 'DSH_AGENTS_HOME'
const BUNDLED_SKILL_DIR_ENV = 'DSH_BUNDLED_SKILL_DIR'
const PROVIDER_PACKAGE = '@deepseek-ai/dsh-skill-filesystem'
const DSH_HOME_DIR_NAME = '.dsh'

/** 展开 `~` / `~/x` / `~\x`（与 dsh-home-paths 的 expandHomePath 同语义）。 */
function expandHomePath(path, home) {
  if (path === '~') return home
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(home, path.slice(2))
  return path
}

/** 与 dsh-home-paths 的 resolveDshHome(configured, env) 同语义：配置 > DSH_HOME > ~/.dsh。 */
function resolveDshHome(configured, env = process.env) {
  const home = homedir()
  const fromEnv = env?.[DSH_HOME_ENV]
  const base = configured ?? (typeof fromEnv === 'string' && fromEnv.trim() !== '' ? fromEnv : join(home, DSH_HOME_DIR_NAME))
  return resolve(expandHomePath(String(base), home))
}

/**
 * 与 provider 的 findProjectRoot 同语义：往上找含 `.git` 的目录，找不到就用原路径。
 *
 * ⚠️ 判据必须是**存在**（`access`），不是 `isDirectory`：git worktree 与 submodule 里
 * `.git` 是个**文件**。用 isDirectory 会继续往上走到外层仓库，于是「装到项目」会写进
 * 另一个工作树、而列表里永远不出现（本仓库自己就是这种形态）。
 */
async function findProjectRoot(cwd) {
  const start = resolve(String(cwd))
  let current = start
  for (;;) {
    if (await pathExists(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return start
    current = parent
  }
}

async function pathExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** 从 loader 树里取 filesystem provider 的 config；找不到就返回空对象（只剩环境变量与默认值）。 */
function providerConfig(ctx) {
  const entries = ctx?.loader?.entries?.()
  if (!Array.isArray(entries)) return {}
  for (const entry of entries) {
    const name = entry?.options?.name
    if (typeof name === 'string' && name.includes(PROVIDER_PACKAGE)) return entry.options.config ?? {}
  }
  return {}
}

/**
 * 宿主支持的**全部**技能落盘位置，不管那里现在有没有技能。
 *
 * 「可以写到哪里」（决定安装能选什么）。它是**能力**而不是观察——
 * 混用会导致「没装过东西的位置就选不到」。候选项的**展示顺序**由面板决定，这里只给真值。
 *
 * @param {object} ctx - 宿主上下文（或 { loader } 替身）。
 * @param {{ workspaces?: string[] }} [options] - 要一并列出项目位置的工作区。
 * @returns {Promise<{ targets: object[] }>} 按 rank 排序；`exists` 为 false 表示尚未创建。
 */
async function skillTargetsView(ctx, options = {}) {
  const config = providerConfig(ctx)
  const includeDefaults = config.includeDefaultRoots !== false
  const dshHome = resolveDshHome(config.dshHome)
  const agentsHome = resolve(String(
    config.agentsHome
    ?? (typeof process.env?.[AGENTS_HOME_ENV] === 'string' && process.env[AGENTS_HOME_ENV] !== '' ? process.env[AGENTS_HOME_ENV] : join(homedir(), '.agents')),
  ))
  const customDirs = (Array.isArray(config.customSkillDirs) ? config.customSkillDirs : []).map((dir) => resolve(String(dir)))
  const bundledDir = config.bundledSkillDir ?? (includeDefaults ? process.env?.[BUNDLED_SKILL_DIR_ENV] : undefined)

  const targets = []
  const seen = new Set()
  const push = async (source, root, extra = {}) => {
    const key = `${source}\u0000${root}`
    if (seen.has(key)) return
    seen.add(key)
    targets.push({
      source,
      root,
      rank: SKILL_SOURCE_RANK[source],
      scope: scopeOfSource(source),
      // bundled 是宿主随包发布的只读根：能看见，但不能往里装（装了会被升级覆盖）。
      writable: source !== 'bundled',
      exists: await isDirectory(root),
      ...extra,
    })
  }

  const workspaces = Array.isArray(options.workspaces) ? options.workspaces.map(String).filter((path) => path !== '') : []
  if (includeDefaults) {
    for (const workspace of workspaces) {
      const projectRoot = await findProjectRoot(workspace)
      // projectPath 保留原始工作区路径（可能比 projectRoot 深），面板按它显示项目名。
      await push('project-dsh', join(projectRoot, '.dsh', 'skills'), { projectPath: workspace, projectRoot })
      await push('project-agents', join(projectRoot, '.agents', 'skills'), { projectPath: workspace, projectRoot })
    }
  }
  for (const dir of customDirs) await push('custom', dir)
  if (includeDefaults) {
    await push('user-dsh', join(dshHome, 'skills'))
    await push('user-agents', join(agentsHome, 'skills'))
  }
  if (typeof bundledDir === 'string' && bundledDir !== '') await push('bundled', resolve(bundledDir))

  targets.sort((left, right) => left.rank - right.rank || left.root.localeCompare(right.root))
  return { targets }
}

/**
 * 把 wire 上的**目标引用**解析成服务端自己认可的目标。
 *
 * 为什么必须有这一步：`root` / `writable` 曾经直接取自 RPC 载荷，于是
 * 「写入限定在技能根内」与「bundled 只读」这两条不变量**只由客户端保证**——
 * 一个 `removeSkill {name:'<任意 kebab-case 名>', root:'<任意目录>'}` 就能递归删掉
 * `<任意目录>/<名>`（例如整个仓库），`importSkill {root:'<bundled 路径>', writable:true}`
 * 也能绕过只读根。所以现在 wire 只送一个**引用**（source + root + 可选的 projectPath），
 * 服务端拿**自己算出来的**目标集合去核对，对不上就拒；`writable` 一律以服务端那份为准，
 * 载荷里的值不再读。
 *
 * 注意这里刻意不接受「裸 root」：调用方无法凭空指定一个位置，只能引用宿主报告过的位置。
 *
 * @param {object} ctx - 宿主上下文（或 loader 替身）。
 * @param {{ source?: string, root?: string, projectPath?: string }} reference
 * @returns {Promise<object>} 服务端算出的目标（含 writable / scope / rank）。
 */
async function resolveTargetReference(ctx, reference) {
  const source = String(reference?.source ?? '')
  const root = String(reference?.root ?? '')
  const projectPath = String(reference?.projectPath ?? '')
  if (source === '' || root === '') {
    throw new Error('缺少技能目标引用（source + root）：不接受调用方直接指定路径')
  }
  const { targets } = await skillTargetsView(ctx, {
    workspaces: projectPath === '' ? [] : [projectPath],
  })
  const match = targets.find((target) => target.source === source
    && target.root === root
    // projectPath 只作为**附加**约束：给了就必须也对上（安装目标带它，行操作不带）。
    && (projectPath === '' || String(target.projectPath ?? '') === projectPath))
  if (match === undefined) {
    throw new Error(`未知的技能目标：${source} / ${root}（只能操作宿主报告过的位置）`)
  }
  return match
}

/**
 * 一行技能的**唯一身份**：`source \0 cwd \0 name`。
 *
 * ⚠️ 必须与客户端 `lib/client.js` 的 `skillIdentity` 是**同一个元组**：客户端拿它当行 key，
 * 这里拿它保证「同一个身份在 `{skills, disabled}` 里最多出现一次」。两边各有一条用例把
 * **同一个字面量**钉死（test/skills-host.test.mjs 与 test/client-behavior.test.mjs），
 * 只改一边就会红——这套断言存在的理由见 `list()` 里那段注释（改错的后果是静默的）。
 */
const skillRowKey = (row) => `${row?.source || 'unknown'}\u0000${row?.cwd || ''}\u0000${row?.name || ''}`

export { invocationOf, listSkillViews, queryScope, resolveTargetReference, skillRowKey, skillTargetsView }
