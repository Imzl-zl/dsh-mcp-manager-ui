// 宿主侧 skills 读取层：把 ctx.skills 的目录投影成面板要的形状。
//
// 这一层不写盘。**唯一的读盘**是「这一行的调用权限」——它必须来自技能文件本身（宿主的 summary
// 是发现缓存，会滞后），所以那些字段在假路径下就是 null（不知道，见本文件最后一条用例）；
// 其余投影仍是纯函数，用手搓 ctx 即可测（沿用 workspace-host.test.mjs 的 createHostFixture 手法）。
//
// 关键设计约束（见 .tasks/toolbox-ui/SPEC.md 约束 12/13）：
//   - 不传 cwd 时宿主只给用户级/自定义/bundled 技能；项目技能必须显式传 cwd。
//     故「列出全部作用域」必须对每个工作区各查一次再合并。
//   - 宿主返回的 source 是唯一可靠的作用域依据（本机 ~/.dsh/skills 就不存在，
//     技能都在 ~/.agents/skills），UI 不得写死根路径。
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { listSkillViews } from '../lib/skills-registry.js'

/** 手搓一个只实现 list/get/snapshot 的 skills 服务替身。 */
function fakeSkills(byCwd) {
  const calls = []
  return {
    calls,
    async list(options = {}) {
      calls.push(options)
      return byCwd[options.cwd ?? ''] ?? []
    },
    async get(name, options = {}) {
      const found = (byCwd[options.cwd ?? ''] ?? []).find((skill) => skill.name === name)
      return found === undefined ? undefined : { ...found, content: 'body of ' + name }
    },
    async snapshot(options = {}) {
      return { skills: await this.list(options), complete: true }
    },
  }
}

const skill = (over = {}) => ({
  name: 'zhanggui',
  description: '端到端拥有一个开发请求',
  invocation: { modelInvocable: true, userInvocable: true },
  source: 'user-agents',
  provider: 'filesystem',
  path: '/home/u/.agents/skills/zhanggui/SKILL.md',
  ...over,
})

function ctxWith(skills) {
  return { get: (name) => (name === 'skills' ? skills : undefined) }
}

test('does not duplicate global skills when a project query returns the merged view', async () => {
  // 宿主在传 cwd 时返回的是「项目根 + 用户根 + bundled」的**完整合并视图**——
  // provider 的 roots(cwd) 把项目根 push 进 cwd 分支，而用户根与 bundled 根的 push
  // 在该分支之外无条件执行（dsh-skill-filesystem/lib/index.js）。
  // 所以项目查询的结果里**已经包含**全局技能；直接 concat 会让全局技能在每个项目里
  // 各重复一份。面板必须只取该项目真正新增的那些。
  const globalSkill = skill()
  const projectSkill = skill({ name: 'proj-only', source: 'project-dsh' })
  const skills = fakeSkills({
    '': [globalSkill],
    '/proj/a': [globalSkill, projectSkill], // ← 宿主的真实形状：合并视图
  })
  const rows = await listSkillViews(ctxWith(skills), { workspaces: ['/proj/a'] })

  assert.deepEqual(
    rows.map((row) => row.name).sort(),
    ['proj-only', 'zhanggui'],
    '全局技能不得因为项目查询也返回它而重复出现',
  )
  assert.equal(rows.filter((row) => row.name === 'zhanggui').length, 1)
})

test('lists every scope by querying once per workspace plus the unscoped root', async () => {
  // 不传 cwd 只有用户级技能；项目技能必须显式传该项目 cwd —— 这正是宿主 provider
  // 的 roots(cwd) 行为（includeDefaultRoots && cwd !== void 0 才加入项目根）。
  const skills = fakeSkills({
    '': [skill()],
    '/proj/a': [skill({ name: 'proj-only', source: 'project-dsh' })],
  })
  const rows = await listSkillViews(ctxWith(skills), { workspaces: ['/proj/a'] })

  assert.deepEqual(
    rows.map((row) => row.name).sort(),
    ['proj-only', 'zhanggui'],
  )
  // 两个作用域各查一次：一次无 cwd、一次带项目 cwd。
  assert.deepEqual(skills.calls.map((call) => call.cwd), [undefined, '/proj/a'])
})

test('keeps same-named skills from different scopes as separate rows', async () => {
  // 同名跨作用域必须能区分：DSH 自己按 rank 裁决谁生效，但面板要能分别操作。
  const skills = fakeSkills({
    '': [skill()],
    '/proj/a': [skill({ source: 'project-dsh', path: '/proj/a/.dsh/skills/zhanggui/SKILL.md' })],
  })
  const rows = await listSkillViews(ctxWith(skills), { workspaces: ['/proj/a'] })

  const zhanggui = rows.filter((row) => row.name === 'zhanggui')
  assert.equal(zhanggui.length, 2, '同名跨作用域必须各占一行，不能合并')
  assert.deepEqual(
    zhanggui.map((row) => row.scope).sort(),
    ['global', 'project'],
  )
})

test('reports the scope and rank from the host source rather than guessing a path', async () => {
  // 本机实测 ~/.dsh/skills(rank 400) 不存在、技能都在 ~/.agents/skills(rank 500)，
  // 所以「全局」不等于某个写死的路径——必须照实投影 source。
  const skills = fakeSkills({ '': [skill({ source: 'user-dsh' }), skill({ name: 'b', source: 'bundled' })] })
  const rows = await listSkillViews(ctxWith(skills), {})

  assert.equal(rows.find((row) => row.name === 'zhanggui').source, 'user-dsh')
  assert.equal(rows.find((row) => row.name === 'b').source, 'bundled')
  assert.equal(rows.every((row) => row.scope === 'global'), true)
})

test('derives the skill root from the host resourceBase, for both skill shapes', async () => {
  // 启停/删除/导入都要按 (name, scope, root) 精确定位，而 **ctx.skills 不暴露 roots()**
  // （实测：公开方法只有 registerProvider/register/list/snapshot/get/collect/... ）。
  // 根目录只能从 summary 的 resourceBase 推——已用**真实 cordis Context + 真实宿主包**实测：
  //   目录捆绑：path = <技能目录>/SKILL.md，resourceBase.path = <技能目录> → 根 = dirname(base)
  //   扁平文件：path = <根>/<name>.md，    resourceBase.path = <根>       → 根 = base
  // 判别式是「path 是否恰为 <base>/SKILL.md」，与宿主 discoverRoot 的两种 locator 一一对应。
  // （首版曾用「dirname(path) === base」判别——两种情况都成立，不是判别式。）
  const skills = fakeSkills({
    '': [
      skill({
        name: 'bundle-skill',
        path: '/u/.agents/skills/bundle-skill/SKILL.md',
        resourceBase: { kind: 'directory', path: '/u/.agents/skills/bundle-skill' },
      }),
      skill({
        name: 'flat-skill',
        path: '/u/.agents/skills/flat-skill.md',
        resourceBase: { kind: 'directory', path: '/u/.agents/skills' },
      }),
    ],
  })
  const rows = await listSkillViews(ctxWith(skills), {})

  const bundle = rows.find((row) => row.name === 'bundle-skill')
  assert.equal(bundle.root, '/u/.agents/skills', '目录捆绑：根是其技能目录的父目录')
  assert.equal(bundle.kind, 'bundle')

  const flat = rows.find((row) => row.name === 'flat-skill')
  assert.equal(flat.root, '/u/.agents/skills', '扁平文件：根就是 resourceBase 自身')
  assert.equal(flat.kind, 'flat')
})

test('resolves the root when the skill directory is a link (the two host fields disagree)', async () => {
  // ⚠️ 真机缺陷（issue #5，2026-10-11 复现）：技能目录本身是符号链接/junction 时，
  // 面板那一行显示「位置（未报告）/调用权限未知」，悬浮提示还冤枉 frontmatter。
  //
  // 根因是两个字段来自**不同的路径口径**（宿主源码，已核对）：
  //   resourceBase.path = locator.directory      —— 展示路径（配置原样，链接就是链接）
  //   path              = fs.processPath(target) —— realpath（fs-local 里就是 targetKey）
  // 链接目录下两者必然分叉，字面比较落进「形态不认识」→ 根推不出来 → 整行不可操作。
  // 宿主自己的用例也钉着这个分叉（skill-filesystem.spec.ts 的 linked-dir 那条）。
  //
  // 这条用**真实文件系统语义**（真建链接目录 + 真 realpath），不是手搓字符串——
  // 手搓一对「看起来像」的路径证明不了 realpath 之后它们会相等。
  //
  // Windows 上真正的 file symlink 需要特权（实测 EPERM），而目录 junction 不需要；
  // POSIX 上 type 参数被忽略，建的是普通符号链接（与 skills-file-ops.test.mjs 同一手法）。
  const base = await mkdtemp(join(tmpdir(), 'dsh-skills-link-'))
  const external = await mkdtemp(join(tmpdir(), 'dsh-skills-ext-'))
  const root = join(base, '.dsh', 'skills')
  await mkdir(root, { recursive: true })
  await mkdir(join(external, 'linked-skill'), { recursive: true })
  await writeFile(
    join(external, 'linked-skill', 'SKILL.md'),
    '---\nname: linked-skill\ndescription: 链接技能\n---\n\n正文\n',
  )
  try {
    await symlink(join(external, 'linked-skill'), join(root, 'linked-skill'), 'junction')
  } catch (error) {
    // 环境连 junction 都不给建：这条用例无法表达它的意图，明说而不是静默放过。
    await rm(base, { recursive: true, force: true })
    await rm(external, { recursive: true, force: true })
    throw new Error(`本环境无法创建链接（${error.code}），该用例未能执行`)
  }
  try {
    const displayBase = join(root, 'linked-skill')
    const realFile = await realpath(join(displayBase, 'SKILL.md'))
    // 前提：磁盘上文件确实存在且宿主的两个字段确实分叉（否则这条用例测不到东西）。
    assert.notEqual(displayBase, await realpath(displayBase), '前提：该技能目录确实是链接')

    const skills = fakeSkills({
      '': [skill({
        name: 'linked-skill',
        // 宿主真实的形状：base 是展示路径，path 是 realpath。
        resourceBase: { kind: 'directory', path: displayBase },
        path: realFile,
      })],
    })
    const [row] = await listSkillViews(ctxWith(skills), {})

    assert.equal(row.root, root, '链接目录下根必须推得出来，且用**展示路径**（要喂给 fs、也要与目标集合对上）')
    assert.equal(row.kind, 'bundle')
    // 这一行必须真的可操作：调用权限来自文件本身，读得到就不是 null。
    assert.equal(row.modelInvocable, true, '根定位到之后，调用权限要从文件里读出来，不能再是「未知」')
    assert.equal(row.userInvocable, true)
  } finally {
    await rm(base, { recursive: true, force: true })
    await rm(external, { recursive: true, force: true })
  }
})

test('one physical skill file is one row, even when two roots resolve to the same directory', async () => {
  // ⚠️ 真机缺陷（issue #5，2026-10-11 复现）：`DSH_HOME=D:\DSH\.dsh` 而工作区 `D:\DSH`
  // 本身是 git 根，于是 project-dsh 的根 = `<DSH_HOME>/skills` = user-dsh 的根——同一个物理
  // 目录被两种 source 各报一份。实测同一个文件被列成 N+1 行（全局 1 + 每个工作区 1），
  // 名字相同 → 面板互判「被遮蔽」，用户看到一整份重复的技能。
  //
  // 去重判据必须是**物理位置**（宿主给的 path 就是 realpath），不是字符串也不只是 source。
  const skills = fakeSkills({
    '': [skill({ name: 'decision-notes', path: 'D:/DSH/.dsh/skills/decision-notes/SKILL.md' })],
    // 项目查询返回合并视图；同一个文件在这里被换了个 source 再报一次。
    'D:/DSH': [skill({ name: 'decision-notes', source: 'project-dsh', path: 'D:/DSH/.dsh/skills/decision-notes/SKILL.md' })],
    'D:/DSH/temp': [skill({ name: 'decision-notes', source: 'project-dsh', path: 'D:/DSH/.dsh/skills/decision-notes/SKILL.md' })],
  })
  const rows = await listSkillViews(ctxWith(skills), { workspaces: ['D:/DSH', 'D:/DSH/temp'] })

  const same = rows.filter((row) => row.name === 'decision-notes')
  assert.equal(same.length, 1, '同一个物理文件只能占一行（原先会出 3 行）')
  // 留下的是 rank 更前的那份：它才是宿主实际采纳、模型真正收到的条目。
  assert.equal(same[0].source, 'project-dsh', '同一文件两处报时，留 rank 更小（真正生效）的那份')
})

test('keeps same-named skills in different roots as separate rows (real shadowing)', async () => {
  // 与上一条成对：**不同文件**的同名技能是真实的跨作用域遮蔽，必须各占一行。
  // 去重如果按名字做，就会把用户真装了的那份藏起来（这正是 SPEC 约束 12 的边界）。
  const skills = fakeSkills({
    '': [skill({ name: 'zhanggui', path: 'C:/u/.agents/skills/zhanggui/SKILL.md' })],
    'C:/proj': [skill({ name: 'zhanggui', source: 'project-dsh', path: 'C:/proj/.dsh/skills/zhanggui/SKILL.md' })],
  })
  const rows = await listSkillViews(ctxWith(skills), { workspaces: ['C:/proj'] })

  assert.equal(rows.filter((row) => row.name === 'zhanggui').length, 2, '不同根里的同名技能必须各占一行')
  assert.deepEqual(rows.map((row) => row.scope).sort(), ['global', 'project'])
})

test('omits the root rather than guessing when the host gives no resourceBase', async () => {
  // 推不出根就**不填**，留给上层报错。猜一个根会让启停/删除作用在错误的目录上——
  // 那正是本层最危险的失败模式（误删用户的技能）。
  const skills = fakeSkills({ '': [skill({ resourceBase: undefined })] })
  const [row] = await listSkillViews(ctxWith(skills), {})
  assert.equal(row.root, undefined, '无 resourceBase 时不得猜一个根目录')
})

test('omits the root when the path shape matches neither known host locator', async () => {
  // ⚠️ 这条与上一条**必须都在**：上一条走的是「没有 resourceBase」的早退分支，
  // 根本到不了最后的「不猜」兜底。变异测试证明：只留上一条时，把兜底改成
  // `return { root: base }` 也能全绿——也就是「推不出就别猜」这条纪律其实没被测到。
  // 这里给一个**有 resourceBase 但形态不匹配**的输入，专门走到兜底分支。
  const skills = fakeSkills({
    '': [skill({
      name: 'weird',
      path: '/u/.agents/skills/some/deep/nested.md',
      resourceBase: { kind: 'directory', path: '/u/.agents/skills' },
    })],
  })
  const [row] = await listSkillViews(ctxWith(skills), {})
  assert.equal(row.root, undefined, '形态不认识时必须不填根，而不是套用 base')
  assert.equal(row.kind, undefined, '形态不认识时也不得填 kind')
})

test('the invocation policy comes from the skill file, so a host summary alone cannot decide it', async () => {
  // 面板要能区分「模型可调用 / 仅用户可调用」，但**真值不在宿主 summary 里**：那是发现缓存
  // （同一个文件改写后它继续报旧值，见 test/skills-host.test.mjs 的两条用例）。这里刻意给一个
  // 声称「模型不可调用」的 summary，而磁盘上并不存在这个文件（/home/u 是假路径）——行必须说
  // 「不知道」，而不是照抄 summary 的说法。正值方向（真的从文件里读出策略）由宿主用例钉住。
  const skills = fakeSkills({
    '': [skill({ invocation: { modelInvocable: false, userInvocable: true } })],
  })
  const [row] = await listSkillViews(ctxWith(skills), {})
  assert.equal(row.modelInvocable, null, 'summary 不是真值来源：读不到文件就说不知道')
  assert.equal(row.userInvocable, null)
})

test('degrades to an empty list when no skills service is mounted', async () => {
  // 宿主可能没挂 dsh-skill（用户可禁用该内置插件）。读取层不得因此抛错——
  // 抛错会让整个面板打不开，而降级为空列表只影响技能这一块。
  const rows = await listSkillViews({ get: () => undefined }, { workspaces: [] })
  assert.deepEqual(rows, [])
})

test('reads through the default Agent preset scope, so user skills are visible', async () => {
  // ⚠️ 这条抓的是一个**真机缺陷**（装上后技能列表只剩 1 个内置技能）：
  //   宿主 dsh-web-app **有意**把基础行 skill-filesystem 置为 disabled，改由每个 agent
  //   preset 各挂一份，于是文件系统 provider 注册进的是 **preset 的作用域层**；
  //   而 dsh-skill 的注册表按层合并（全局层 + 查看作用域链）。本插件的 RPC 跑在宿主层，
  //   不传 scope 时**只看得到 bundled 那一个**，用户装在 ~/.agents/skills 的全部不可见。
  //
  // 宿主的官方读法（dsh-api-session-controller 的 sessionSkillCatalog）就是借默认 preset
  // 的作用域：`agentPresets.acquireScope()` → `skills.list({ cwd, scope: lease.key })`。
  // 它的文档写着 “Resolve a live or standing preset scope **without creating an Agent**”，
  // 所以这不违反 SPEC 约束 14（面板不得依赖活动会话）。
  const seen = []
  const scopeKey = { preset: 'standard' }
  const skills = {
    async list(options = {}) {
      seen.push(options)
      // 模拟宿主的分层：只有带 scope 的读取才看得到 preset 层注册的用户技能。
      return options.scope === scopeKey ? [skill()] : [skill({ name: 'bundled-only', source: 'bundled' })]
    },
    async get() { return undefined },
  }
  let disposed = 0
  const ctx = {
    get(name) {
      if (name === 'skills') return skills
      if (name === 'agentPresets') {
        return {
          async acquireScope(id) {
            assert.equal(id, undefined, '不传 id 时宿主用 defaultId（当前默认 preset）')
            return {
              key: scopeKey,
              async [Symbol.asyncDispose]() { disposed += 1 },
            }
          },
        }
      }
      return undefined
    },
  }

  const rows = await listSkillViews(ctx, { workspaces: [] })

  assert.deepEqual(rows.map((row) => row.name), ['zhanggui'],
    '不带 preset 作用域时只能读到 bundled；带上才读得到用户技能')
  assert.ok(seen.length > 0 && seen.every((options) => options.scope === scopeKey),
    '每次 skills.list 都必须带上 preset 作用域，否则用户技能不可见')
  assert.equal(disposed, 1, '租约必须释放（宿主内部有 users 计数，不释放会留住那一代）')
})

test('releases the preset lease even when the catalog read throws', async () => {
  // 租约不释放会留住 preset 的那一代注册；读取失败时更不能漏。
  let disposed = 0
  const scopeKey = { preset: 'standard' }
  const ctx = {
    get(name) {
      if (name === 'skills') return { async list() { throw new Error('host exploded') } }
      if (name === 'agentPresets') {
        return { async acquireScope() { return { key: scopeKey, async [Symbol.asyncDispose]() { disposed += 1 } } } }
      }
      return undefined
    },
  }
  await assert.rejects(() => listSkillViews(ctx, { workspaces: [] }), /host exploded/)
  assert.equal(disposed, 1, '读取抛错时也必须释放租约')
})

test('falls back to the global read when no preset registry is present', async () => {
  // 旧宿主 / 没装 preset 注册表的部署：拿不到作用域不是错误，退回原来的全局读取。
  const seen = []
  const skills = {
    async list(options = {}) { seen.push(options); return [skill({ source: 'bundled' })] },
    async get() { return undefined },
  }
  const rows = await listSkillViews(ctxWith(skills), { workspaces: [] })
  assert.equal(rows.length, 1)
  assert.ok(seen.every((options) => options.scope === undefined), '拿不到就退化为不带 scope 的读取')
})

test('a broken preset registry does not break the skills pane', async () => {
  // preset 未注册/损坏时宿主会抛（agent-preset/not-found / invalid）。技能面必须仍然可用，
  // 只是少了 preset 层的技能——不能让整个面板因此打不开。
  const skills = { async list() { return [skill({ source: 'bundled' })] }, async get() { return undefined } }
  const ctx = {
    get(name) {
      if (name === 'skills') return skills
      if (name === 'agentPresets') return { async acquireScope() { throw new Error('agent-preset/not-found') } }
      return undefined
    },
  }
  const rows = await listSkillViews(ctx, { workspaces: [] })
  assert.equal(rows.length, 1, 'preset 取不到时退回全局读取，而不是抛错')
})
