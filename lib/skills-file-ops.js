// 宿主侧 skills 文件动作：启停、删除、导入、扫描已禁用。
//
// 这一层真的动用户的文件，纪律比其它层严：
//   - 按 (name, scope, root) 精确定位；找不到就报错，**绝不回退**到别的作用域
//     （否则同名技能会被误删/误停用）。
//   - bundled 根只读，拒绝写入。
//   - 名字来自面板与远端目录，属外部输入，必须校验后才能拼进路径。
//   - 启停用 rename：dsh-atomic-write 只提供 writeFileAtomic 与 withFileLock，没有 rename。
//
// 宿主看不到已禁用的技能（SKILL.md 改名后按固定路径读不到 → 静默跳过），
// 所以「已禁用」必须由本层自己扫 .disabled 得到，否则面板无法展示它们。

import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { MAX_ARCHIVE_BYTES, extractArchive } from './skills-archive.js'
import { diagnoseSkill } from './skills-frontmatter.js'

// 与宿主同一套名字语法（dsh-skill 的 SKILL_NAME）。它天然排除 '.'、'/'、'\\'，
// 所以合法名字不可能跳出根目录——但越界校验仍然保留，因为这是系统边界。
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const BUNDLE_FILE = 'SKILL.md'
const DISABLED_SUFFIX = '.disabled'

/**
 * 「此作用域下没有这个技能」的专用错误。
 *
 * 单独一个类型是为了让调用方能安全地按 code 判定「不存在」——否则只能靠 catch 全部错误，
 * 那会把真正的失败（权限、IO）也当成「不存在」，进而做出错误决策。
 */
export class SkillNotFoundError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SkillNotFoundError'
    this.code = 'SKILL_NOT_FOUND'
  }
}

/** 路径是否存在（不抛错）。 */
async function exists(path) {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return false
    throw error
  }
}

/**
 * 把一个技能名解析成可操作的文件目标（形态由磁盘决定）。
 *
 * 找不到就抛错：绝不回退到别的作用域或别的形态。同名跨作用域是合法配置
 * （DSH 按 rank 裁决谁生效），静默回退会让用户停用/删掉另一个作用域的副本。
 *
 * 形态判定必须看磁盘而不是信调用方声明——声明可能与磁盘不一致。
 *
 * @param {{ name: string, scope: 'global'|'project', root: string, writable?: boolean }} input
 * @returns {Promise<object>} 带确定 kind 与 path 的目标。
 */
export async function resolveSkillTarget(input) {
  const { name, scope, root, writable = true } = input
  if (typeof name !== 'string' || !SKILL_NAME.test(name)) {
    throw new Error(`非法技能名：${JSON.stringify(name)}（只接受 kebab-case）`)
  }
  if (typeof root !== 'string' || root === '') {
    throw new Error('非法技能根目录')
  }
  const bundlePath = join(root, name, BUNDLE_FILE)
  const flatPath = join(root, `${name}.md`)
  const base = { name, scope, root, writable, bundlePath, flatPath }

  if (await exists(bundlePath)) return { ...base, kind: 'bundle', path: bundlePath }
  if (await exists(flatPath)) return { ...base, kind: 'flat', path: flatPath }
  // 已禁用的两种形态也要能定位——「启用」正是从这个目标出发的。
  if (await exists(`${bundlePath}${DISABLED_SUFFIX}`)) {
    return { ...base, kind: 'bundle', path: `${bundlePath}${DISABLED_SUFFIX}`, disabled: true }
  }
  if (await exists(`${flatPath}${DISABLED_SUFFIX}`)) {
    return { ...base, kind: 'flat', path: `${flatPath}${DISABLED_SUFFIX}`, disabled: true }
  }
  throw new SkillNotFoundError(`找不到技能 ${name}（作用域 ${scope}，根 ${root}）`)
}

/**
 * 启用或停用一个技能。
 *
 * ⚠️ 判据基准必须是**启用态路径**，不能拿 `target.path` 直接当基准：技能已停用时，
 * `resolveSkillTarget` 返回的 `path` **本身就带 `.disabled`**（那是「它在哪」，不是「方向」）。
 * 上一版就是这么错的，两个方向都坏：
 *   · 启用 → 算出的 `disabledPath` 是 `SKILL.md.disabled.disabled`（不存在）→ 静默 `{changed:false}`，
 *     用户点「启用」没有任何反应，而 UI 与文档都承诺能恢复；
 *   · 停用 → 把已停用的技能再改名成 `SKILL.md.disabled.disabled`，还返回成功——那个文件名
 *     既不被 `scanDisabledSkills` 认（它只看 `.md.disabled` / `SKILL.md.disabled`），
 *     也不被宿主看到，**只能手工改名救回**。
 * 归一化之后两个方向都幂等：已经是目标态就 `{changed:false}`。
 *
 * @param {object} target - resolveSkillTarget 的结果。
 * @param {boolean} enabled - true 启用、false 停用。
 */
export async function setSkillEnabled(target, enabled) {
  if (target.writable === false) {
    throw new Error('该技能来自只读根（bundled），不可启停')
  }
  const enabledPath = target.path.endsWith(DISABLED_SUFFIX)
    ? target.path.slice(0, -DISABLED_SUFFIX.length)
    : target.path
  const disabledPath = `${enabledPath}${DISABLED_SUFFIX}`
  // 读-改-写必须在锁内（SPEC 约束 20）：exists → rename 之间被插入的话，
  // 两个面板/一次重试就会把技能改成谁都没见过的名字（`.disabled.disabled` 那类事故）。
  // 锁键用 `root + name`（与导入、删除同一把），所以同名操作彼此串行。
  return await withFileLock(join(target.root, target.name), async () => {
    if (enabled) {
      // 已经是启用态就幂等返回（面板可能重复点），否则把 .disabled 改回来。
      if (!(await exists(disabledPath))) return { changed: false }
      await rename(disabledPath, enabledPath)
      return { changed: true, enabled: true }
    }
    if (!(await exists(enabledPath))) return { changed: false }
    await rename(enabledPath, disabledPath)
    return { changed: true, enabled: false }
  })
}

/**
 * 扫描一个根下所有**已禁用**的技能。
 *
 * 宿主目录看不到它们（改名后按固定路径读不到即静默跳过），所以这是面板能展示
 * 「已停用」并提供「启用」的唯一来源。
 *
 * @param {{ root: string, scope: 'global'|'project' }} input
 * @returns {Promise<object[]>}
 */
export async function scanDisabledSkills(input) {
  const { root, scope } = input
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return []
    throw error
  }
  const rows = []
  for (const entry of entries) {
    if (entry.isDirectory()) {
      // 目录捆绑：<name>/SKILL.md.disabled
      const name = entry.name
      if (!SKILL_NAME.test(name)) continue
      const disabled = join(root, name, `${BUNDLE_FILE}${DISABLED_SUFFIX}`)
      if (await exists(disabled)) {
        rows.push({ name, scope, root, kind: 'bundle', path: disabled, disabled: true })
      }
      continue
    }
    // 扁平：<name>.md.disabled
    if (typeof entry.name === 'string' && entry.name.endsWith(`.md${DISABLED_SUFFIX}`)) {
      const name = entry.name.slice(0, -`.md${DISABLED_SUFFIX}`.length)
      if (!SKILL_NAME.test(name)) continue
      rows.push({ name, scope, root, kind: 'flat', path: join(root, entry.name), disabled: true })
    }
  }
  return rows.sort((left, right) => left.name.localeCompare(right.name))
}

/**
 * 读取技能文件正文。
 * @param {object} target
 * @returns {Promise<string>}
 */
export async function readSkillFile(target) {
  return await readFile(target.path, 'utf8')
}

/**
 * 删除一个技能（目录捆绑删整个目录，扁平删文件）。
 * @param {object} target
 */
export async function removeSkill(target) {
  if (target.writable === false) {
    throw new Error('该技能来自只读根（bundled），不可删除')
  }
  // 与启停/导入同一把锁（root + name）：删除与「正在导入的同名技能」不能交错。
  return await withFileLock(join(target.root, target.name), async () => {
    if (target.kind === 'bundle') {
      // 目录捆绑连同它的 resources（scripts/references/assets）一起删，
      // 否则会在根里留下无主的资源目录。
      const directory = join(target.root, target.name)
      await rm(directory, { recursive: true, force: true })
      return { changed: true, removed: directory }
    }
    // 扁平文件：两种形态都清掉，避免留下一个 .md.disabled 残骸。
    await rm(join(target.root, `${target.name}.md`), { force: true })
    await rm(join(target.root, `${target.name}.md${DISABLED_SUFFIX}`), { force: true })
    return { changed: true, removed: join(target.root, `${target.name}.md`) }
  })
}

// ---------------------------------------------------------------------------
// 导入
//
// 落盘名必须取自 **frontmatter 的 name**，而不是源文件/目录/压缩包内层的名字：宿主的技能
// 身份就来自 frontmatter（dsh-skill-filesystem/lib/index.js:696-704 的 parsed.name），
// 它完全忽略外层名字。若按外层名落盘，本层自己的 resolveSkillTarget(name) 会找不到刚导入
// 的技能——用户导入完面板就点不动它，而且宿主展示的名字与目录名还会不一致。
// ---------------------------------------------------------------------------

/** 列出一个技能树里所有 SKILL.md 的相对路径（正斜杠）。 */
async function findSkillFiles(directory) {
  const found = []
  const walk = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.name === BUNDLE_FILE) found.push(relative(directory, full).replace(/\\/g, '/'))
    }
  }
  await walk(directory)
  return found
}

/**
 * 拒绝技能树里的符号链接，与压缩包路径同一纪律（skills-archive 拒链接）。
 *
 * 理由：克隆下来的技能仓库可以带符号链接，而 `fs.cp` 默认保留链接（dereference: false）。
 * 原样复制的话，技能里的 `references/x.md` 就可能指向技能根之外的文件——技能正文会把
 * 读者引向不该读的内容。宁可整包拒绝，也不静默解引用（那会把外部文件的内容复制进用户的技能）。
 *
 * @param {string} directory - 技能树根。
 */
async function assertNoSymlinks(directory) {
  const walk = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`技能目录含符号链接，已拒绝：${full}`)
      if (entry.isDirectory()) await walk(full)
    }
  }
  await walk(directory)
}

/**
 * 从若干 SKILL.md 里挑出唯一的技能根，挑不出就报错。
 *
 * 取**最浅**的那个（压缩包常见的外层包装目录因此被自然剥掉）；最浅层若仍有两个不同目录，
 * 说明这个包装了多个技能——静默挑一个等于猜，而导入的目标必须是确定的。
 *
 * @param {string[]} candidates - 相对路径清单。
 * @returns {string} 技能根相对路径（空串表示就是顶层）。
 */
function pickSkillRoot(candidates) {
  if (candidates.length === 0) throw new Error(`导入内容里没有 ${BUNDLE_FILE}，不是一个技能`)
  const depth = (path) => path.split('/').length
  const shallowest = Math.min(...candidates.map(depth))
  const top = candidates.filter((path) => depth(path) === shallowest)
  const roots = new Set(top.map((path) => path.split('/').slice(0, -1).join('/')))
  if (roots.size > 1) {
    throw new Error(`导入内容含多个技能（${[...roots].join('、')}），无法确定要导入哪一个`)
  }
  return [...roots][0]
}

/**
 * 校验待导入的技能原文，返回它的 frontmatter 名字。
 *
 * 导入时就挡住非法 frontmatter：宿主对非法技能只 warn + 跳过，放进来只会得到一条
 * 「看不见的技能」，用户会以为导入成功。
 */
function requireImportableName(text, sourcePath) {
  const diagnosed = diagnoseSkill(text)
  if (!diagnosed.ok) {
    const first = diagnosed.issues.find((issue) => issue.level === 'error')
    throw new Error(`技能 frontmatter 不合格（${sourcePath}）：${first.message}`)
  }
  const { name } = diagnosed
  // name 此刻即将被拼进路径，而它来自外部文件——边界处再挡一次，不依赖上游校验。
  if (typeof name !== 'string' || !SKILL_NAME.test(name)) {
    throw new Error(`非法技能名：${JSON.stringify(name)}（只接受 kebab-case）`)
  }
  return name
}

/** 确认目标名字在该作用域下完全空闲，避免静默覆盖用户已有的技能。 */
async function assertSkillVacant(root, name) {
  const candidates = [
    join(root, name),
    join(root, `${name}.md`),
    join(root, `${name}.md${DISABLED_SUFFIX}`),
  ]
  for (const candidate of candidates) {
    if (await exists(candidate)) {
      throw new Error(`技能 ${name} 在该作用域已存在：${candidate}（请先删除或改名，不会自动覆盖）`)
    }
  }
}

/**
 * 把一个技能导入到指定作用域的根。
 *
 * 支持三种来源（与主流 skills CLI 的范围一致）：
 *   - `{ type: 'file', path }`     单个 `.md` → 落成扁平技能 `<name>.md`
 *   - `{ type: 'directory', path }` 目录捆绑 → 落成 `<name>/`（连同 resources）
 *   - `{ type: 'archive', path }`  zip / tar / tar.gz / tgz → 落成 `<name>/`
 *
 * 「先全部校验、再落盘」：任何一步失败都不应该在用户的技能根里留下残骸。
 *
 * @param {{ root: string, scope: 'global'|'project', writable?: boolean,
 *   source: { type: 'file'|'directory'|'archive', path: string } }} input
 * @returns {Promise<{ name: string, kind: 'flat'|'bundle', scope: string, root: string, path: string }>}
 */
export async function importSkill(input) {
  const { root, scope, source, writable = true } = input ?? {}
  if (typeof root !== 'string' || root === '') throw new Error('非法技能根目录')
  if (writable === false) throw new Error('该技能来自只读根（bundled），不可导入')
  if (source === null || typeof source !== 'object') throw new Error('缺少导入源')
  const { type, path: sourcePath } = source
  if (typeof sourcePath !== 'string' || sourcePath === '') throw new Error('缺少导入源路径')
  if (!(await exists(sourcePath))) throw new Error(`导入源不存在：${sourcePath}`)

  if (type === 'file') {
    const text = await readFile(sourcePath, 'utf8')
    const name = requireImportableName(text, sourcePath)
    await mkdir(root, { recursive: true })
    // 锁 + 原子提交：临时名**刻意不带 `.md`**（宿主的扁平规则只认 `*.md`，所以它在扫描里不可见），
    // 写完 rename 到位。并发同名导入因此不会互相踩，中途失败也不会留下半个技能文件。
    return await withFileLock(join(root, name), async () => {
      await assertSkillVacant(root, name)
      return await commitFlatSkill(root, name, text, scope)
    })
  }

  if (type !== 'directory' && type !== 'archive') {
    throw new Error(`不支持的导入源类型：${JSON.stringify(type)}`)
  }

  // 压缩包先解到临时目录再挑技能根；目录来源直接原地读，不复制一份。
  // 临时目录放在系统 tmp 而不是技能根里：宿主会扫描技能根的每个子目录
  // （只跳过 .system），暂存目录会被它当成一条技能。
  const staging = type === 'archive' ? await mkdtemp(join(tmpdir(), 'dsh-skill-import-')) : undefined
  try {
    let tree = sourcePath
    if (type === 'archive') {
      // 先卡**输入**大小：限额判定发生在解压之后，而这里会把整包读进内存。
      await assertArchiveInputSize(sourcePath)
      tree = join(staging, 'extracted')
      await extractArchive(await readFile(sourcePath), tree)
    }

    const bundleSource = join(tree, pickSkillRoot(await findSkillFiles(tree)))
    // ⚠️ 树根**自身**也要查：只从内部走会漏掉「调用方给的路径本身就是链接/junction」那种情形
    // （Windows 上 cp 会 EPERM，POSIX 上会把链接原样复制进用户的技能根）。
    await assertNoSymlink(bundleSource)
    await assertNoSymlinks(bundleSource)
    const text = await readFile(join(bundleSource, BUNDLE_FILE), 'utf8')
    const name = requireImportableName(text, sourcePath)
    await mkdir(root, { recursive: true })
    // 锁 + 原子提交（与启停/删除同一把锁键 root + name）。
    return await withFileLock(join(root, name), async () => {
      await assertSkillVacant(root, name)
      return await commitBundleSkill(root, name, bundleSource, scope)
    })
  } finally {
    if (staging !== undefined) await rm(staging, { recursive: true, force: true })
  }
}

/**
 * 扁平技能的原子提交。
 *
 * 临时名**不带 `.md`**：宿主判定扁平技能是 `name.endsWith('.md')`，所以
 * `.dsh-import-<随机>` 在它眼里根本不存在——放置期间不会闪出一条幽灵技能。
 */
async function commitFlatSkill(root, name, text, scope) {
  const destination = join(root, `${name}.md`)
  const temp = join(root, `.dsh-import-${randomBytes(6).toString('hex')}`)
  try {
    await writeFile(temp, text)
    await rename(temp, destination)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
  return { name, kind: 'flat', scope, root, path: destination }
}

/**
 * 目录捆绑的原子提交：先复制到技能根里的**两层暂存结构**，再 rename 到位。
 *
 * 为什么不能直接 `cp` 到 `<root>/<name>`：`cp` 是合并语义，两次并发导入会互相踩
 * （实测过：一条的失败清理会删掉另一条正在写的目录）；中途失败还会在用户根里留半棵树。
 * 暂存用 `<root>/.dsh-import-<随机>/skill`：宿主判定技能看的是 `<dir>/SKILL.md`，
 * 外层没有 SKILL.md，所以放置期间它对宿主不可见（也不会被当成扁平技能——那要求 `*.md`）。
 */
async function commitBundleSkill(root, name, bundleSource, scope) {
  const holder = join(root, `.dsh-import-${randomBytes(6).toString('hex')}`)
  const staged = join(holder, 'skill')
  const destination = join(root, name)
  try {
    await mkdir(holder, { recursive: true })
    await cp(bundleSource, staged, { recursive: true })
    // 复制结果里不得出现链接：`cp` 的 dereference:false 会把链接当链接搬过来。
    await assertNoSymlinks(staged)
    await rename(staged, destination)
    return { name, kind: 'bundle', scope, root, path: join(destination, BUNDLE_FILE) }
  } finally {
    // 成功时 holder 只剩空壳；失败时它带着半成品一起被清掉。
    await rm(holder, { recursive: true, force: true })
  }
}

/** 该路径**本身**是不是链接/junction（`lstat` 不跟随链接，`stat` 会）。 */
async function assertNoSymlink(path) {
  const info = await lstat(path)
  if (info.isSymbolicLink()) throw new Error(`拒绝导入符号链接/联结：${path}`)
}

/** 压缩包**输入**大小上限：在把它读进内存之前卡一道（解压限额在解压之后才生效）。 */
async function assertArchiveInputSize(sourcePath) {
  const info = await stat(sourcePath)
  if (info.size > MAX_ARCHIVE_BYTES) {
    throw new Error(`压缩包过大（${info.size} 字节，上限 ${MAX_ARCHIVE_BYTES} 字节）`)
  }
}
