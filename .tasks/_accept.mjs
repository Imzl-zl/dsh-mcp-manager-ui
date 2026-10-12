// 发布前验收：拿**已发布的产物本身**（npm tarball）与当前工作树，对**同一套「用户完整形状」**
// 各跑一遍，把「操作真的改了盘」的结果并排打出来。
//
// 为什么必须用已发布产物：教训 16 —— 曾经把工作树文件复制进「已发布产物」目录又去跑验收，
// 结论因此失真。这里从 npm 下载 tarball、按生产布局摆好（peer 为兄弟目录），再跑同一份脚本。
//
// 用法：
//   node .tasks/_accept.mjs 1.6.5        # 从 npm 取该版本
//   node .tasks/_accept.mjs worktree     # 当前工作树（lib/ 直接引用）
import { mkdtemp, mkdir, writeFile, symlink, rm, readFile, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const target = process.argv[2] ?? 'worktree'
// ⚠️ 宿主包一律从**本仓库自己的** node_modules 解析，而不是 profile 的：
//   · profile 的 `@deepseek-ai` 是个 junction，其目标会被 npm/pnpm 的操作清掉（实测：现在整目录不可达）；
//   · 本仓库 devDependencies 钉的就是真机运行的那一版（cordis 4.0.2、dsh-skill 0.2.0-rc.2、
//     dsh-skill-filesystem 0.2.0-rc.2），所以「真宿主包」这条要求照样满足，而且可复现。
const PEERS = join(process.cwd(), 'node_modules', '@deepseek-ai')
const load = async (spec) => await import(pathToFileURL(join(PEERS, spec)).href)

/** 把目标版本准备成一个可 import 的 lib 目录。 */
async function prepare(target) {
  if (target === 'worktree') {
    return { lib: pathToFileURL(join(process.cwd(), 'lib', 'index.js')).href, label: '工作树' }
  }
  const staging = await mkdtemp(join(tmpdir(), 'accept-pack-'))
  // npm pack 下载 tarball（不装依赖，只取产物）
  const { stdout } = await run('npm', ['pack', `dsh-toolbox-ui@${target}`, '--pack-destination', staging], {
    shell: true, maxBuffer: 16e6,
  })
  const tarball = join(staging, stdout.trim().split(/\r?\n/).pop())
  await run('tar', ['-xzf', tarball, '-C', staging], { shell: true })
  const pkgRoot = join(staging, 'package')
  // 生产布局：peer 是兄弟目录（真机里就是 profile 的 node_modules）。
  // ⚠️ 直接把**整个 profile 的 node_modules/@deepseek-ai** 链进来，而不是去链 PROFILE 的父目录：
  // 后者的父目录里还装着这个包自己，会造成自引用。第一版就是因为链错目标、
  // 而 `.catch()` 把真实错误吞掉，才在 import 时报一个看不懂的 ERR_MODULE_NOT_FOUND。
  const nm = join(pkgRoot, 'node_modules')
  await mkdir(nm, { recursive: true })
  // 产物自己的运行期依赖（yaml / zod / smol-toml）要装进来，否则 import 就断在它们上。
  // ⚠️ `--ignore-scripts` + 不装 peer：peer 已由宿主包提供，让 npm 去解析它们会牵出
  // 整棵宿主依赖树（慢，且可能改坏版本）。
  await run('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--legacy-peer-deps'],
    { cwd: pkgRoot, shell: true, maxBuffer: 32e6 })
  // ⚠️ 顺序要紧：npm install **会**把 node_modules/@deepseek-ai 那个 junction 换成真目录
  // （它按 package.json 的 peerDependencies 去解析），所以链接必须**在装完之后**再建一次。
  await rm(join(nm, '@deepseek-ai'), { recursive: true, force: true })
  // ⚠️ peer 用**本仓库自己的** devDependencies 目录，而不是 profile 的 node_modules：
  // 真机里插件装在 profile 里、由 pnpm 把 peer 解析到自己的树，而 profile 顶层**没有**
  // `@deepseek-ai/dsh-typert-protocol`（实测：它是本插件 package.json 里的 peer，
  // 不在宿主的依赖集里）。链 profile 会让 import 断在它上面。
  // 本仓库的 node_modules 里那六七个 peer 都在（devDependencies 装过），版本也一致。
  try {
    await symlink(join(process.cwd(), 'node_modules', '@deepseek-ai'), join(nm, '@deepseek-ai'), 'junction')
  } catch (error) {
    // 建不了链接时如实说出来——静默退化会让后面的报错指向完全错误的地方。
    throw new Error(`无法把 peer 包链进产物目录（${error.code}）：${error.message}`)
  }
  // 产物是 ESM，需要 package.json 的 "type": "module"（tarball 里有）
  return { lib: pathToFileURL(join(pkgRoot, 'lib', 'index.js')).href, label: `npm ${target}`, cleanup: staging }
}

/**
 * 「用户完整形状」（HANDOFF 第五节）：
 *   DSH_HOME 在工作区内 × 技能全是 junction × 两个工作区 × 其中一条**磁盘名与实际名不一致**
 * 返回每一项操作的通过情况。
 */
async function accept(libUrl) {
  const { SkillsManagerGateway } = await import(libUrl)
  const { Context } = await load('cordis/lib/index.js')
  const { SkillRegistry } = await load('dsh-skill/lib/index.js')
  const fsProvider = await load('dsh-skill-filesystem/lib/index.js')

  const base = await mkdtemp(join(tmpdir(), 'accept-'))
  const external = await mkdtemp(join(tmpdir(), 'accept-ext-'))
  const workspace = join(base, 'DSH')
  const nested = join(workspace, 'temp')
  await mkdir(join(workspace, '.git'), { recursive: true })
  await mkdir(nested, { recursive: true })
  const dshHome = join(workspace, '.dsh')          // ← DSH_HOME 就在工作区里
  const skillsRoot = join(dshHome, 'skills')
  const agentsHome = join(base, 'agents-home')
  await mkdir(skillsRoot, { recursive: true })

  // 三条技能，全是 junction；其中一条磁盘名 != frontmatter name
  const skills = [
    { disk: 'alpha', name: 'alpha' },
    { disk: 'beta', name: 'beta' },
    { disk: 'disk-gamma', name: 'gamma-alias' },   // ← 名字不一致
  ]
  for (const s of skills) {
    await mkdir(join(external, s.disk), { recursive: true })
    await writeFile(join(external, s.disk, 'SKILL.md'),
      `---\nname: ${s.name}\ndescription: ${s.name} 的说明\n---\n\n${s.name} 正文。\n`)
    await symlink(join(external, s.disk), join(skillsRoot, s.disk), 'junction')
  }
  // ⚠️ 形态覆盖必须够宽，否则这份「发布前唯一对照」会漏掉整类缺陷。
  // 曾经的版本只有上面的 junction 目录，于是「目录名叫 `odd.md`」与「旧机制残留」
  // 这两种形状一条都没覆盖到——而它们正是本轮两条 Critical 的现场（审查指出）。
  //   · `odd.md/`：宿主**目录分支优先**，所以 `.md` 结尾的目录是合法技能（曾让整页打不开）
  //   · `flat.md`：根级扁平技能（另一种形态）
  //   · `legacy/`：旧机制残留（只有 `.disabled`，宿主看不见它）
  await mkdir(join(skillsRoot, 'odd.md'), { recursive: true })
  // ⚠️ 正文里要写**技能名**（`odd-md-dir 正文`），因为下面的读正文断言按技能名匹配。
  // 第一版写成 `odd 正文`，于是三条读正文假红——验收脚本自己的夹具 bug。
  await writeFile(join(skillsRoot, 'odd.md', 'SKILL.md'),
    '---\nname: odd-md-dir\ndescription: 目录名以 .md 结尾\n---\n\nodd-md-dir 正文。\n')
  await writeFile(join(skillsRoot, 'flat-file.md'),
    '---\nname: flat-file\ndescription: 根级扁平\n---\n\nflat-file 正文。\n')
  await mkdir(join(skillsRoot, 'legacy'), { recursive: true })
  await writeFile(join(skillsRoot, 'legacy', 'SKILL.md.disabled'),
    '---\nname: legacy\ndescription: 旧机制残留\ndisable-model-invocation: true\n---\n\nlegacy 正文。\n')

  const ctx = new Context()
  await ctx.plugin(SkillRegistry)
  const fiber = ctx.plugin({
    apply: fsProvider.apply, inject: fsProvider.inject, name: fsProvider.name, Config: fsProvider.Config,
    // ⚠️ `watch: true`：真机就是这个配置，而「我们改了盘、宿主重新发现」这条路依赖 watcher
  // （恢复旧机制残留就是一个实例）。用 `watch: false` 跑会让那条检查永远等不到失效，
  // 从而把一个**正确**的实现报成失败。
}, { dshHome, agentsHome, watch: true })
  await fiber
  const hostCtx = {
    get: (n) => ctx.get(n),
    loader: { entries: () => [{ options: { name: '@deepseek-ai/dsh-skill-filesystem', config: { dshHome, agentsHome } } }] },
  }

  const results = []
  const check = (label, ok, detail = '') => results.push({ label, ok, detail })

  try {
    const listed = await SkillsManagerGateway.prototype.list.call({ ctx: hostCtx }, { workspaces: [workspace, nested] })
    // 宿主看得见的：alpha / beta / disk-gamma（junction 目录）+ odd.md（目录名以 .md 结尾）
    // + flat-file（根级扁平）。legacy 是旧机制残留，宿主看不见、只有我们能补出来。
    const expected = ['alpha', 'beta', 'gamma-alias', 'odd-md-dir', 'flat-file', 'legacy']
    check(`列出全部 ${expected.length} 条技能`,
      listed.skills.length === expected.length && expected.every((n) => listed.skills.some((r) => r.name === n)),
      `实际 ${listed.skills.length} 行：${JSON.stringify(listed.skills.map((r) => r.name).sort())}`)
    check('全部定位到根与磁盘条目',
      listed.skills.every((r) => r.root && r.entry),
      listed.skills.filter((r) => !r.root || !r.entry).map((r) => r.name).join(',') || '全部可定位')

    /**
     * 一行在磁盘上的**真身**（外部库或技能根里的那个文件）。
     * junction 技能的本体在外部库；其余（odd.md / flat-file / legacy）就在技能根里。
     *
     * ⚠️ `row.entry` 只有新版产物才给；旧版（1.6.5 及更早）只给 `name`，而它恰恰就是
     * 「按技能名拼路径」的那个版本。所以这里按技能名回填一次，让脚本能跑完——
     * 把新旧差异体现在**逐项结果**里，而不是让脚本先崩掉（崩掉什么都证明不了）。
     */
    const entryOf = (row) => row.entry ?? skills.find((s) => s.name === row.name)?.disk ?? row.name
    const fileOf = (row) => {
      const entry = entryOf(row)
      const inRoot = row.root === skillsRoot || entry === 'odd.md' || entry === 'flat-file.md' || entry === 'legacy'
      const base = inRoot ? skillsRoot : join(external, entry)
      return row.kind === 'bundle' ? join(base, entry, 'SKILL.md') : join(base, entry)
    }

    // ① 读正文（名字不一致、.md 目录、扁平三种尤其关键）
    for (const row of listed.skills) {
      try {
        const d = await SkillsManagerGateway.prototype.detail.call({ ctx: hostCtx }, { ...row, projectPath: row.cwd })
        check(`读正文：${row.name}`, new RegExp(`${row.name} 正文`).test(d.skill.content))
      } catch (error) { check(`读正文：${row.name}`, false, String(error.message).slice(0, 60)) }
    }

    // ② 停用 → 断言**盘上的真相**。旧机制残留单独走「恢复」那条路（见 ⑤）。
    // ⚠️ 先留一份**原始字节**（在动它之前）：下面「逐字节还原」要比的是这个。
    // 第一版把快照取在停用**之后**，于是比的是「停用态 vs 启用态」——那当然不等，
    // 三条全部假红。这是验收脚本自己的 bug，不是产物的。
    const originals = new Map()
    for (const row of listed.skills) {
      if (row.migrated === true) continue
      const file = fileOf(row)
      originals.set(row.name, await readFile(file, 'utf8').catch(() => undefined))
    }
    for (const row of listed.skills) {
      if (row.migrated === true) continue
      try {
        const file = fileOf(row)
        await SkillsManagerGateway.prototype.setEnabled.call({ ctx: hostCtx },
          { ...row, projectPath: row.cwd, enabled: false })
        // ⚠️ 先看**文件名**再看内容：旧机制（改名成 .disabled）会让 SKILL.md 直接不存在。
        // 先读内容的话，那种情况会报一句 ENOENT，看起来像脚本出错，而不是「它改了名」。
        const renamed = existsSync(`${file}.disabled`)
        check(`停用不改文件名：${row.name}`, !renamed, renamed ? '旧机制把 SKILL.md 改名成了 .disabled' : '')
        if (renamed) { check(`停用落到盘上：${row.name}`, false, '文件被改名，字段没写'); continue }
        const text = await readFile(file, 'utf8')
        const ok = /disable-model-invocation:\s*true/.test(text) && /user-invocable:\s*false/.test(text)
        check(`停用落到盘上：${row.name}`, ok, ok ? '' : '两个调用面字段没写全')
      } catch (error) {
        check(`停用：${row.name}`, false, String(error.message).slice(0, 70))
        check(`停用不改文件名：${row.name}`, false, '未能完成停用')
        check(`停用落到盘上：${row.name}`, false, '未能完成停用')
      }
    }

    // ③ 停用后仍看得见（新机制的关键差异）
    const afterOff = await SkillsManagerGateway.prototype.list.call({ ctx: hostCtx }, { workspaces: [workspace, nested] })
    check('停用后仍列在面板里', afterOff.skills.length === expected.length,
      `实际 ${afterOff.skills.length} 行（旧机制会让它们从目录里消失）`)
    const normalRows = afterOff.skills.filter((r) => r.migrated !== true)
    check('停用态是派生出来的', normalRows.every((r) => r.enabled === false),
      normalRows.filter((r) => r.enabled !== false).map((r) => r.name).join(',') || '全部为已停用')

    // ④ 启用回来 + 逐字节还原（比的是**动它之前的原始字节**）
    for (const row of listed.skills) {
      if (row.migrated === true) continue
      const file = fileOf(row)
      try {
        await SkillsManagerGateway.prototype.setEnabled.call({ ctx: hostCtx },
          { ...row, projectPath: row.cwd, enabled: true })
        if (!existsSync(file)) {
          check(`启用后逐字节还原：${row.name}`, false, '启用后那个文件仍不存在（没能恢复）')
          continue
        }
        const after = await readFile(file, 'utf8')
        check(`启用后逐字节还原：${row.name}`, after === originals.get(row.name),
          after === originals.get(row.name) ? '' : '启用没有把文件还原成动它之前的样子')
      } catch (error) { check(`启用：${row.name}`, false, String(error.message).slice(0, 70)) }
    }

    // ⑤ 旧机制残留的「恢复」必须**真的把文件名改回来**（写字段对它毫无意义：宿主看不见那个文件）
    const legacy = listed.skills.find((r) => r.migrated === true)
    if (legacy === undefined) {
      check('旧机制残留被列出来', false, '没有扫到 legacy 那条')
    } else {
      check('旧机制残留被列出来', true)
      check('残留的 enabled 恒为已停用', legacy.enabled === false)
      try {
        await SkillsManagerGateway.prototype.setEnabled.call({ ctx: hostCtx },
          { ...legacy, projectPath: legacy.cwd, enabled: true })
        check('恢复残留：SKILL.md 真的出现了', existsSync(join(skillsRoot, 'legacy', 'SKILL.md')),
          '写字段对它无效——必须 rename')
        check('恢复残留：.disabled 消失', !existsSync(join(skillsRoot, 'legacy', 'SKILL.md.disabled')))
        // ⚠️ 恢复之后要**等一下宿主重新发现**：rename 是我们做的外部文件改动，宿主的发现缓存
        // 靠它的 watcher 失效（真机同样如此，实测 ~500ms）。立刻 list 会读到**还没失效**的旧缓存
        // ——第一版就是这样假红的（报 `{}`），不是产物的问题。
        // 用真机同款配置（watch: true）跑，等一小会儿，模拟用户「恢复完再看一眼」。
        let revived
        let lastNames = []
        for (let attempt = 0; attempt < 6; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 250))
          const afterRestore = await SkillsManagerGateway.prototype.list.call({ ctx: hostCtx }, { workspaces: [workspace, nested] })
          lastNames = afterRestore.skills.map((r) => `${r.name}(m=${r.migrated === true},e=${r.enabled})`)
          revived = afterRestore.skills.find((r) => r.name === 'legacy')
          if (revived !== undefined && revived.migrated !== true && revived.enabled === true) break
        }
        check('恢复之后不再是残留、且可调用',
          revived !== undefined && revived.migrated !== true && revived.enabled === true,
          `看到的是：${JSON.stringify(lastNames)}`)
      } catch (error) { check('恢复残留', false, String(error.message).slice(0, 70)) }
    }

    // ⑥ 删除只删链接，外部库必须完好
    const doomed = listed.skills.find((r) => r.name === 'alpha')
    try {
      if (doomed === undefined) throw new Error('找不到 alpha')
      await SkillsManagerGateway.prototype.removeSkill.call({ ctx: hostCtx }, { ...doomed, projectPath: doomed.cwd })
      check('删除只删链接：alpha', !existsSync(join(skillsRoot, 'alpha')))
      check('删除不伤外部库', existsSync(join(external, 'alpha', 'SKILL.md')))
      check('删除不误伤邻居', existsSync(join(skillsRoot, 'beta')) && existsSync(join(external, 'beta', 'SKILL.md')))
    } catch (error) { check('删除：alpha', false, String(error.message).slice(0, 70)) }
  } finally {
    await fiber.dispose?.()
    await rm(base, { recursive: true, force: true })
    await rm(external, { recursive: true, force: true })
  }
  return results
}

// ── 主流程 ────────────────────────────────────────────────────────────────
const prepared = await prepare(target)
console.log(`\n=== 验收目标：${prepared.label} ===\n`)
const results = await accept(prepared.lib)
const passed = results.filter((r) => r.ok).length
for (const r of results) {
  console.log(`${r.ok ? '  ✓' : '  ✗'} ${r.label}${r.detail && !r.ok ? '  ← ' + r.detail : ''}`)
}
console.log(`\n${prepared.label}：${passed}/${results.length} 通过`)
if (prepared.cleanup) await rm(prepared.cleanup, { recursive: true, force: true })
process.exit(passed === results.length ? 0 : 1)
