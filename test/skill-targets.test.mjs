// 安装目标（skillTargets）：把「可以装到哪里」这件事钉住。
//
// 背景（用户的原话：「用户没有选择的权力？」）：面板原来的「安装到」候选来自**实际发现**
// （约束 12），于是「想装到 `~/.dsh/skills`，但那里还没建」和「想给还没建技能目录的项目装一份」
// 这两种需求都无处可选。观察 ≠ 能力：能不能装，必须来自宿主支持的**全部**位置。
//
// 这一层的真值来自 `@deepseek-ai/dsh-skill-filesystem` 的 `roots(cwd)`（随宿主发布，
// 从宿主 app.asar 里核过）。本插件照抄那份规则，并从 loader 树里读**它真正在用的 config**。
// provider 改算法时这里要一起改——下面这些用例钉的是**语义**（rank、路径形状、只读性、
// 项目根怎么找、DSH_HOME 怎么解析），而不是内部实现。
import assert from 'node:assert/strict'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { skillTargetsView } from '../lib/skills-registry.js'

const PROVIDER = '@deepseek-ai/dsh-skill-filesystem'

/** 造一个 loader 替身：provider 条目带着它的 config（真值就从这里取）。 */
const ctxWith = (config) => ({
  loader: { entries: () => [{ options: { name: PROVIDER, config } }] },
})

const tempRoot = () => mkdtemp(join(tmpdir(), 'dsh-skill-targets-'))

test('六档位置都列出来，并按宿主 rank 排序', async () => {
  const base = await tempRoot()
  const dshHome = join(base, 'dsh-home')
  const agentsHome = join(base, 'agents-home')
  const custom = join(base, 'custom-skills')
  const bundled = join(base, 'bundled-skills')
  await mkdir(custom, { recursive: true })
  await mkdir(bundled, { recursive: true })

  const project = join(base, 'proj')
  await mkdir(join(project, '.git'), { recursive: true })
  await mkdir(join(project, 'packages', 'inner'), { recursive: true })

  const { targets } = await skillTargetsView(
    ctxWith({ dshHome, agentsHome, customSkillDirs: [custom], bundledSkillDir: bundled }),
    // 工作区给的是子目录：项目根必须往上找到 .git 那一层
    { workspaces: [join(project, 'packages', 'inner')] },
  )

  assert.deepEqual(targets.map((t) => t.source), [
    'project-dsh', 'project-agents', 'custom', 'user-dsh', 'user-agents', 'bundled',
  ])
  assert.deepEqual(targets.map((t) => t.rank), [100, 200, 300, 400, 500, 600])
  const bySource = Object.fromEntries(targets.map((t) => [t.source, t]))
  assert.equal(bySource['project-dsh'].root, join(project, '.dsh', 'skills'), '项目根要往上找到 .git 那一层')
  assert.equal(bySource['project-agents'].root, join(project, '.agents', 'skills'))
  assert.equal(bySource['project-dsh'].projectRoot, project)
  assert.equal(bySource['project-dsh'].projectPath, join(project, 'packages', 'inner'), '保留原始工作区路径用于显示项目名')
  assert.equal(bySource['user-dsh'].root, join(dshHome, 'skills'))
  assert.equal(bySource['user-agents'].root, join(agentsHome, 'skills'))
  assert.equal(bySource.custom.root, custom)
  assert.equal(bySource.bundled.root, bundled)
})

test('还没建的位置照样列出来，并标 exists=false', async () => {
  const base = await tempRoot()
  const { targets } = await skillTargetsView(
    ctxWith({ dshHome: join(base, 'nothing-here'), agentsHome: join(base, 'nor-here'), bundledSkillDir: join(base, 'bundled') }),
    { workspaces: [] },
  )
  const bySource = Object.fromEntries(targets.map((t) => [t.source, t]))
  assert.equal(bySource['user-dsh'].exists, false, '目录不存在也要列出来（这正是「想用 .dsh/skills」的场景）')
  assert.equal(bySource['user-agents'].exists, false)
  // 对照：存在的目录要标 true，否则面板会把已经能用的位置说成「将创建」。
  const existing = await tempRoot()
  await mkdir(join(existing, 'skills'), { recursive: true })   // 根是 <home>/skills，不是 <home>
  const second = await skillTargetsView(ctxWith({ dshHome: existing, agentsHome: existing }), { workspaces: [] })
  const userDsh = second.targets.find((t) => t.source === 'user-dsh')
  assert.equal(userDsh.exists, true)
})

test('bundled 只读，其余可写', async () => {
  const base = await tempRoot()
  const { targets } = await skillTargetsView(ctxWith({ dshHome: base, agentsHome: base, bundledSkillDir: join(base, 'bundled') }), { workspaces: [] })
  const bySource = Object.fromEntries(targets.map((t) => [t.source, t]))
  assert.equal(bySource.bundled.writable, false, 'bundled 随包发布，装进去会被升级覆盖')
  for (const source of ['user-dsh', 'user-agents']) assert.equal(bySource[source].writable, true)
  assert.equal(bySource['user-dsh'].scope, 'global')
})

test('includeDefaultRoots=false 时不列默认位置（与 provider 的 roots 一致）', async () => {
  const base = await tempRoot()
  const custom = join(base, 'only-custom')
  const { targets } = await skillTargetsView(
    ctxWith({ includeDefaultRoots: false, dshHome: base, agentsHome: base, customSkillDirs: [custom], bundledSkillDir: join(base, 'b') }),
    { workspaces: [base] },
  )
  assert.deepEqual(targets.map((t) => t.source), ['custom', 'bundled'],
    '关掉默认根之后只剩自定义目录与内置目录——不能因为「我们觉得应该有」就补上')
})

test('DSH_HOME 走环境变量（与 dsh-home-paths 的 resolveDshHome 同语义）', async () => {
  const previous = process.env.DSH_HOME
  const base = await tempRoot()
  process.env.DSH_HOME = base
  try {
    // config 不给 dshHome → 应该取 DSH_HOME
    const { targets } = await skillTargetsView(ctxWith({ agentsHome: base }), { workspaces: [] })
    assert.equal(targets.find((t) => t.source === 'user-dsh').root, join(base, 'skills'))
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
  // 没有配置也没有环境变量时退回 ~/.dsh（绝不写死某个磁盘路径）
  const { targets: fallback } = await skillTargetsView({ loader: { entries: () => [] } }, { workspaces: [] })
  const userDsh = fallback.find((t) => t.source === 'user-dsh')
  if (userDsh) assert.equal(userDsh.root, resolve(join(homedir(), '.dsh', 'skills')))
})

test('同一个项目根只列一次，且不因找不到 provider 条目而失败', async () => {
  const base = await tempRoot()
  const project = join(base, 'proj')
  await mkdir(join(project, '.git'), { recursive: true })
  // 两个工作区指向同一个项目（子目录 + 根）→ 项目位置只该出现一次
  const { targets } = await skillTargetsView(ctxWith({ dshHome: base, agentsHome: base }), {
    workspaces: [project, join(project, 'sub')],
  })
  assert.equal(targets.filter((t) => t.source === 'project-dsh').length, 1)
  assert.equal(targets.filter((t) => t.source === 'project-agents').length, 1)

  // loader 树里没有 provider 条目（旧宿主/替身）：退回环境变量与默认值，不抛。
  const { targets: bare } = await skillTargetsView(undefined, { workspaces: [] })
  assert.ok(Array.isArray(bare))
  assert.equal(bare.some((t) => t.source === 'user-agents'), true)
})
