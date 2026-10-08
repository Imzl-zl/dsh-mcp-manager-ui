// 宿主侧 skills 读取层：把 ctx.skills 的目录投影成面板要的形状。
//
// 这一层是纯函数 + 薄封装，不碰文件系统、不写盘——所以用手搓 ctx 即可测（沿用
// workspace-host.test.mjs 的 createHostFixture 手法），不需要真宿主。
//
// 关键设计约束（见 .tasks/skills-manager/SPEC.md 约束 12/13）：
//   - 不传 cwd 时宿主只给用户级/自定义/bundled 技能；项目技能必须显式传 cwd。
//     故「列出全部作用域」必须对每个工作区各查一次再合并。
//   - 宿主返回的 source 是唯一可靠的作用域依据（本机 ~/.dsh/skills 就不存在，
//     技能都在 ~/.agents/skills），UI 不得写死根路径。
import assert from 'node:assert/strict'
import test from 'node:test'
import { listSkillViews, projectSkillRow, revisionOfSkillRows } from '../lib/skills-registry.js'

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

test('exposes the invocation policy so the panel can tell model-only from user-only', async () => {
  const skills = fakeSkills({
    '': [skill({ invocation: { modelInvocable: false, userInvocable: true } })],
  })
  const [row] = await listSkillViews(ctxWith(skills), {})
  assert.equal(row.modelInvocable, false)
  assert.equal(row.userInvocable, true)
})

test('loads one skill body through the host and reports it as missing when unknown', async () => {
  const skills = fakeSkills({ '': [skill()] })
  const ctx = ctxWith(skills)

  const found = await projectSkillRow(ctx, { name: 'zhanggui' })
  assert.equal(found.content, 'body of zhanggui')

  const missing = await projectSkillRow(ctx, { name: 'no-such-skill' })
  assert.equal(missing, undefined, '未知技能必须返回 undefined，不是抛错也不是空对象')
})

test('degrades to an empty list when no skills service is mounted', async () => {
  // 宿主可能没挂 dsh-skill（用户可禁用该内置插件）。读取层不得因此抛错——
  // 抛错会让整个面板打不开，而降级为空列表只影响技能这一块。
  const rows = await listSkillViews({ get: () => undefined }, { workspaces: [] })
  assert.deepEqual(rows, [])
})

test('produces a stable content revision that changes when the catalog changes', async () => {
  const before = fakeSkills({ '': [skill()] })
  const same = fakeSkills({ '': [skill()] })
  const changed = fakeSkills({ '': [skill({ description: '改了描述' })] })

  const revA = revisionOfSkillRows(await listSkillViews(ctxWith(before), {}))
  const revB = revisionOfSkillRows(await listSkillViews(ctxWith(same), {}))
  const revC = revisionOfSkillRows(await listSkillViews(ctxWith(changed), {}))

  assert.equal(revA, revB, '内容相同则 revision 相同（面板据此避免无变化重渲染）')
  assert.notEqual(revA, revC, '描述变化必须改变 revision')
})

test('the revision is a pure function of rows, so listing the host happens once', async () => {
  // 指纹若自己去查宿主，面板每拉一次就要查两遍：既浪费，又会在两次查询之间
  // 被其它改动撕开（指纹与实际渲染的行对不上 → 漏刷新）。这条钉住「指纹是纯函数」。
  const skills = fakeSkills({ '': [skill()] })
  const rows = await listSkillViews(ctxWith(skills), {})
  const callsAfterList = skills.calls.length
  revisionOfSkillRows(rows)
  revisionOfSkillRows(rows)
  assert.equal(skills.calls.length, callsAfterList, '算指纹不得再查宿主')
})
