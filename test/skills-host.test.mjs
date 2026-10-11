// 宿主服务 skillsManager（row 7）。
//
// 这是 skills 能力面的宿主入口：一个**独立**的 TypertRemoteService，serviceKey='skillsManager'。
//
// 两条硬约束（SPEC 约束 15/16，都有已验证的失败模式）：
//
// 1. **`skills` 不得进现有 gateway 的 static inject。** Cordis 的 inject 是**依赖声明**：
//    服务缺失时该 fiber 只是保持不激活并等待，**不报错也不激活**（cordis 的 notify() →
//    fiber._refresh()）。宿主的内置插件 dsh-skill 是可被用户禁用的，一旦把 skills 加进现有
//    gateway 的 inject，那些 profile 会连 **MCP 面板一起失效**——不可接受的回归。
//    正解：SkillsManagerGateway 作独立子插件、自带 inject=["skills"]，其未满足只影响技能面。
//
// 2. **不得新增 cordis.patch.yml 条目。** 只有一条 `- id: mcp-manager-ui / name: <包名>`，
//    而 test/package-contract.test.mjs:59-60 断言该 id 与 name **各出现恰好 1 次**。
//    所以第二个服务必须在同一 patch 条目内挂载（`ctx.plugin(...)`，cordis/lib/index.js:1619）。
//
// 3. **管理动作不依赖会话**（SPEC 约束 14）：面板的读取与文件操作都不得要求存在活动会话
//    （官方 ctx.remote.skills.list 需要真实 sessionId，会激活冷 Agent，故本插件走自己的 RPC）。
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readdir, writeFile, rm } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SkillsManagerGateway } from '../lib/index.js'
import { skillRowKey } from '../lib/skills-registry.js'

const hostIndex = readFileSync(fileURLToPath(new URL('../lib/index.js', import.meta.url)), 'utf8')

test('MCP panel still activates on a real cordis Context when skills is absent', async () => {
  // SPEC 约束 16 的**行为级**验收（比断言 inject 数组强得多）：Cordis 的 inject 是依赖声明，
  // 服务缺失时 fiber 只保持不激活并等待、**不报错**，所以「inject 写错了」在静态断言之外
  // 还会表现为「静默失效」。这里用真 cordis Context 装载两个 gateway，在**不提供 skills**
  // 的环境里确认 mcpManager 照常激活——那正是这条约束要保住的东西。
  const { Context } = await import('@deepseek-ai/cordis')
  const { McpManagerGateway } = await import('../lib/index.js')
  const root = await mkdtemp(join(tmpdir(), 'dsh-inject-'))
  const patch = join(root, 'cordis.patch.yml')
  await writeFile(patch, '[]\n')
  try {
    const ctx = new Context()
    await ctx.plugin({
      name: 'host-stub',
      apply(inner) {
        inner.provide('loader', {
          entries: () => [{ options: { id: 'include', name: 'cordis:include', config: { path: pathToFileURL(patch).href } } }],
        })
        inner.provide('tools', { schemas: () => [] })
      },
    })
    // 刻意**不**提供 skills：模拟用户禁用了内置插件 dsh-skill。
    await ctx.plugin(McpManagerGateway, {})
    await ctx.plugin(SkillsManagerGateway, {})

    assert.notEqual(ctx.get('mcpManager'), undefined, '缺 skills 时 MCP 面板必须照常可用（否则是静默回归）')
    // 技能侧只是等待依赖，不抛错、也不激活——这正是「只影响技能这一块」。
    assert.equal(ctx.get('skillsManager'), undefined, '依赖未满足时技能服务应保持未激活')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

/** 造一个只提供 skills 服务的宿主替身。 */
function skillsHost(ctx = {}) {
  return { ...ctx, get: (name) => (name === 'skills' ? ctx.skills : ctx[name]) }
}

test('mounting the plugin exposes the skills service without a second patch entry', async () => {
  // SPEC 约束 15：第二个服务必须在**同一** patch 条目内挂载，即由现有插件自己
  // `ctx.plugin(SkillsManagerGateway)`。上面那条用例是手工 mount 的，**不覆盖**生产路径——
  // 只导出类而没挂载，生产里 skillsManager 就永远不存在（面板「技能服务未连接」）。
  // 这条走真实装载路径：只 mount 默认导出（= McpManagerGateway，与 patch 里那个 name 对应）。
  const { Context } = await import('@deepseek-ai/cordis')
  const pluginDefault = (await import('../lib/index.js')).default
  const root = await mkdtemp(join(tmpdir(), 'dsh-mount-'))
  const patch = join(root, 'cordis.patch.yml')
  await writeFile(patch, '[]\n')
  try {
    const ctx = new Context()
    await ctx.plugin({
      name: 'host-stub',
      apply(inner) {
        inner.provide('loader', {
          entries: () => [{ options: { id: 'include', name: 'cordis:include', config: { path: pathToFileURL(patch).href } } }],
        })
        inner.provide('tools', { schemas: () => [] })
        inner.provide('skills', {
          async list() { return [] },
          async get() { return undefined },
        })
      },
    })
    // 只装载插件本身——不手工挂任何子服务。
    await ctx.plugin(pluginDefault, {})

    assert.notEqual(ctx.get('mcpManager'), undefined, 'MCP 服务应已激活')
    assert.notEqual(ctx.get('skillsManager'), undefined,
      '装载插件本身就必须带出 skills 服务（由现有插件内部 ctx.plugin 挂载，而不是靠外部再挂一次）')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the handover probe never reports the plugin itself as a conflicting manager', async () => {
  // SPEC 约束 10 / D15：本插件自己的 loader `name` 恒等于 package.json.name
  // （cordis.patch.yml 的 `name:` 由 package-rename 钉住），所以自身判据是**包名**。
  //
  // ⚠️ 不能用 patch 的 `id` 排自身：新旧两个包共用 `id: mcp-manager-ui`，
  // 按 id 排会把旧包一起排掉 → 让位检测永不触发（下一条用例就是这个形态）。
  const ctx = {
    loader: {
      entries: () => [
        // 就是本插件自己：name 与 package.json.name 相同。
        { options: { id: 'mcp-manager-ui', name: 'dsh-toolbox-ui' } },
      ],
    },
  }
  const conflict = await SkillsManagerGateway.prototype.conflictingManager.call({ ctx })
  assert.equal(conflict, null,
    '只有自身条目时必须报告「无冲突」，否则面板会静默让位、完全打不开')
})

test('the handover probe sees the OLD package even though it shares our patch id', async () => {
  // 真机形态：新旧两包**同 id**（都是 `mcp-manager-ui`），旧包的 name 是 `dsh-mcp-manager-ui`。
  // 首版按 id 排自身，于是这一条被一起跳过、让位永不触发——而 desktop profile 恰恰装着旧包。
  const ctx = {
    loader: {
      entries: () => [
        { options: { id: 'mcp-manager-ui', name: 'dsh-toolbox-ui' } },
        { options: { id: 'mcp-manager-ui', name: 'dsh-mcp-manager-ui' } },
      ],
    },
  }
  const conflict = await SkillsManagerGateway.prototype.conflictingManager.call({ ctx })
  assert.notEqual(conflict, null, '旧包在场（哪怕与我们同 id）必须报告冲突，否则让位形同不存在')
  assert.equal(conflict.name, 'dsh-mcp-manager-ui')
})

test('the handover probe reports a genuinely different manager plugin', async () => {
  const ctx = {
    loader: {
      entries: () => [
        { options: { id: 'mcp-manager-ui', name: 'dsh-toolbox-ui' } },
        { options: { id: 'some-other-manager', name: 'dsh-mcp-manager-ui-legacy' } },
      ],
    },
  }
  const conflict = await SkillsManagerGateway.prototype.conflictingManager.call({ ctx })
  assert.notEqual(conflict, null, '另一个管理插件在场时必须报告冲突')
  assert.equal(conflict.id, 'some-other-manager')
})

test('the handover probe fails open, so a broken loader never hides the panel', async () => {
  // SPEC 约束 10：检测失败必须 fail-open（照常注册入口）。
  // 漏检最坏是两个按钮并存；误判则用户**完全打不开面板**——两者代价不对称。
  for (const broken of [
    { loader: { entries: () => { throw new Error('loader exploded') } } },
    { loader: undefined },
    { loader: { entries: () => 'not-an-array' } },
    {},
  ]) {
    const conflict = await SkillsManagerGateway.prototype.conflictingManager.call({ ctx: broken })
    assert.equal(conflict, null, '检测失败必须返回「无冲突」（fail-open），而不是抛错')
  }
})

test('the handover probe ignores unrelated loader entries', async () => {
  const ctx = {
    loader: {
      entries: () => [
        { options: { id: 'mcp-manager-ui', name: 'dsh-toolbox-ui' } },
        { options: { id: 'include', name: 'cordis:include' } },
        { options: { id: 'mcp-github', name: '@deepseek-ai/dsh-mcp-client' } },
        { options: { id: 'skills-fs', name: 'skill-filesystem' } },
      ],
    },
  }
  assert.equal(await SkillsManagerGateway.prototype.conflictingManager.call({ ctx }), null,
    '只有无关条目时必须报告无冲突')
})

test('the handover probe requires both mcp and manager in the name', async () => {
  // ⚠️ 这条专治「判据放宽」：把 `mcp && manager` 改成只查 manager（或只查 mcp），
  // 会让下面这些**无关插件**被判成冲突 → 用户面板完全打不开。
  // 一条必须同时含两段的判据，只能用「只含一段的名字」来测——用 `skill-filesystem`
  // 这类两段都不含的名字测不出放宽（那正是首版漏掉这个变异的原因）。
  const unrelated = [
    { id: 'pkg-manager', name: 'some-package-manager' },      // 只有 manager
    { id: 'mcp-client-x', name: '@deepseek-ai/dsh-mcp-client' }, // 只有 mcp
    { id: 'manager-only', name: 'plugin-manager' },
    { id: 'mcp-only', name: 'mcp-tools' },
  ]
  for (const entry of unrelated) {
    // ⚠️ 注意包装：loader 条目是 `{ options: { id, name, … } }`。
    // 首版这里写成 `[..., entry]`（少了 options 一层），于是被测代码读 `entry.options`
    // 得到 undefined、直接 continue ——用例因此**恒真**，判据放宽了也测不出来。
    // 变异测试当场发现：把 `mcp && manager` 改成只查 manager，这条用例照样绿。
    const ctx = {
      loader: {
        entries: () => [
          { options: { id: 'mcp-manager-ui', name: 'dsh-toolbox-ui' } },
          { options: entry },
        ],
      },
    }
    assert.equal(await SkillsManagerGateway.prototype.conflictingManager.call({ ctx }), null,
      `${entry.name} 不含 mcp+manager 两段，不得被判成冲突（否则面板打不开）`)
  }
})

test('the skills gateway registers under its own service key and injects only skills', () => {
  // serviceKey 同时是 Cordis 服务键与默认 wire namespace（dsh-typert-protocol 的
  // TypertRemoteService 构造签名是 (ctx, serviceKey, options?)）。MCP 用 mcpManager，
  // skills 用 skillsManager，两者互不影响。
  assert.equal(typeof SkillsManagerGateway, 'function')
  // 自带 inject=["skills"]：缺 dsh-skill 时只有技能面不激活，MCP 面板不受影响。
  assert.deepEqual(SkillsManagerGateway.inject, ['skills'])
})

test('the existing MCP gateway keeps exactly its original inject list', () => {
  // SPEC 约束 16 的回归闸门：把 skills 加进现有 gateway 的 inject 会让未挂载 dsh-skill 的
  // profile 连 MCP 面板一起失效（服务缺失时 fiber 只等待、不报错，所以是**静默**失效）。
  //
  // ⚠️ 这里必须断言**完整数组相等**，不能用「包含 loader, tools」这类子串判断——
  // 首版就是那么写的，于是 ["loader","tools","skills"] 依然匹配（子串仍成立），
  // 变异测试当场证明它抓不到。多一个元素就是回归，必须精确比较。
  const lists = [...hostIndex.matchAll(/static inject = \[([^\]]*)\]/g)]
    .map((match) => match[1].split(',').map((part) => part.trim().replace(/^["']|["']$/g, '')).filter(Boolean))
  assert.ok(lists.length >= 2, `应至少有两个 gateway 的 inject 声明，实际 ${lists.length}`)
  const mcpInject = lists.find((list) => list.includes('loader'))
  assert.ok(mcpInject, '找不到 MCP gateway 的 inject 声明')
  assert.deepEqual(mcpInject, ['loader', 'tools'],
    `现有 gateway 的 inject 必须**恰好**是 ["loader","tools"]（多一个 skills 就会连累 MCP 面板）`)
})

test('no second cordis.patch.yml entry was added for the skills service', () => {
  // 第二个服务必须在**同一** patch 条目内挂载：SPEC 约束 15 说该文件只有一条
  // `- id: mcp-manager-ui / name: <包名>`。
  //
  // ⚠️ 必须数**条目总数**，不能只数某个特定 id——首版只断言 `id: mcp-manager-ui` 出现 1 次，
  // 于是「新增一条别的 id 的条目」照样通过（变异测试抓到）。真正的约束是
  // 「不得为 skills 新增 patch 条目」，与那条新条目叫什么名字无关。
  const patch = readFileSync(fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)), 'utf8')
  const ids = [...patch.matchAll(/^\s*-\s*id:\s*(\S+)/gm)].map((match) => match[1])
  assert.deepEqual(ids, ['mcp-manager-ui'],
    `cordis.patch.yml 必须恰好只有一条挂载条目，实际：${JSON.stringify(ids)}`)
  // 名字也只能出现一次（内容层面）。
  // 挂载名等于包名——从 package.json 推导，改名只发生在一个地方。
  const packageName = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')).name
  assert.equal((patch.match(new RegExp('name: ' + packageName, 'g')) ?? []).length, 1)
})

test('lists skills without requiring an active session', async () => {
  // SPEC 约束 14：不得要求 sessionId。宿主替身里**故意不放任何 session 相关字段**，
  // 若实现偷偷依赖会话，这里会直接抛错而不是「恰好通过」。
  const ctx = skillsHost({
    skills: {
      async list() {
        return [{
          name: 'zhanggui',
          description: '端到端拥有一个开发请求',
          invocation: { modelInvocable: true, userInvocable: true },
          source: 'user-agents',
          provider: 'filesystem',
          path: '/home/u/.agents/skills/zhanggui/SKILL.md',
        }]
      },
    },
  })
  const result = await SkillsManagerGateway.prototype.list.call({ ctx }, {})
  assert.equal(result.skills.length, 1)
  assert.equal(result.skills[0].name, 'zhanggui')
  // 面板要按 source 显示**真实**作用域（本机 ~/.dsh/skills 就不存在，技能都在 ~/.agents/skills），
  // 所以 source 必须原样带出来，UI 不得写死根路径（SPEC 约束 12）。
  assert.equal(result.skills[0].source, 'user-agents')
})

test('degrades to an empty list when the skills service is missing', async () => {
  // 未挂载 dsh-skill 时，技能面必须降级而不是抛错（抛错会让整个面板打不开）。
  const ctx = skillsHost({})
  const result = await SkillsManagerGateway.prototype.list.call({ ctx }, {})
  assert.deepEqual(result.skills, [])
})

test('merges project skills per workspace without duplicating globals', async () => {
  // SPEC 约束 13：每个工作区各调一次 list({cwd}) 再合并。宿主传 cwd 时返回的是
  // 「项目+用户+bundled」完整合并视图，所以项目查询结果**已含全局**——直接 concat 会重复。
  const calls = []
  const globalSkills = [
    { name: 'zhanggui', description: 'g', source: 'user-agents', provider: 'filesystem', invocation: {} },
  ]
  const ctx = skillsHost({
    skills: {
      async list(options = {}) {
        calls.push(options.cwd)
        if (options.cwd === undefined) return globalSkills
        return [
          ...globalSkills,
          { name: 'proj-only', description: 'p', source: 'project-dsh', provider: 'filesystem', invocation: {} },
        ]
      },
    },
  })
  const result = await SkillsManagerGateway.prototype.list.call({ ctx }, { workspaces: ['/ws/a', '/ws/b'] })
  // 全局各查一次（不传 cwd），每个工作区各查一次。
  assert.equal(calls.filter((cwd) => cwd === undefined).length, 1)
  assert.deepEqual(calls.filter((cwd) => cwd !== undefined), ['/ws/a', '/ws/b'])
  const names = result.skills.map((row) => row.name).sort()
  assert.deepEqual(names, ['proj-only', 'proj-only', 'zhanggui'])
  // 全局技能只出现一次，不因两个工作区而重复。
  assert.equal(result.skills.filter((row) => row.name === 'zhanggui').length, 1)
})

test('surfaces disabled skills even when a whole root is disabled', async () => {
  // SPEC 约束 3：禁用后技能从宿主目录**消失**（改名后按固定路径读不到），
  // 所以必须自行扫描各 root 的 .disabled，否则面板无法展示它们、也无法提供「启用」。
  //
  // ⚠️ 待扫的根必须来自**能力**（skillTargetsView），不能从可见行反推：
  // 某个根里的技能**全被停用**时，可见行里根本没有那个根 → 它永远不被扫 → 面板零显示、
  // 也救不回来（首版就是这么写的；这条用例把「可见行为空」设成前提来钉住它）。
  // 顺带钉住：禁用行必须带 source —— 客户端的分组/作用域标签/药丸全靠它。
  const base = await mkdtemp(join(tmpdir(), 'dsh-skills-host-'))
  const agentsHome = join(base, 'agents-home')
  const skillsRoot = join(agentsHome, 'skills')
  await mkdir(join(skillsRoot, 'visible'), { recursive: true })
  await writeFile(join(skillsRoot, 'visible', 'SKILL.md'), '---\nname: visible\ndescription: v\n---\n\n正文\n')
  await mkdir(join(skillsRoot, 'hidden'), { recursive: true })
  await writeFile(join(skillsRoot, 'hidden', 'SKILL.md.disabled'), '---\nname: hidden\ndescription: h\n---\n\n正文\n')
  try {
    const ctx = {
      // 宿主目录里一个技能都看不见（全被停用了）
      get: (name) => (name === 'skills' ? { list: async () => [] } : undefined),
      loader: {
        entries: () => [{
          options: {
            name: '@deepseek-ai/dsh-skill-filesystem',
            config: { dshHome: join(base, 'dsh-home'), agentsHome },
          },
        }],
      },
    }
    const result = await SkillsManagerGateway.prototype.list.call({ ctx }, {})
    assert.deepEqual(result.skills, [], '宿主目录里看不到任何技能（前提）')
    assert.deepEqual(result.disabled.map((row) => row.name), ['hidden'], '全停用的根也必须被扫到')
    const [row] = result.disabled
    assert.equal(row.root, skillsRoot, '禁用行必须带它所在的根，否则无法启用')
    assert.equal(row.source, 'user-agents', '禁用行必须带来源：客户端的分组与作用域标签靠它')
    assert.equal(row.disabled, true)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('a stale enabled row and the freshly scanned .disabled file are ONE row (the disabled one)', async () => {
  // 真机复现的缺陷（2026-10-11）：面板刚把 SKILL.md 改名成 .disabled，宿主的发现缓存**仍然
  // 报「已启用」**，而我们现场扫盘已经看到 .disabled —— 同一个身份在 `skills` 与 `disabled`
  // 里各出现一次。客户端按 `source\0cwd\0name` 生成行 key，两行 key 相同 → React 重复 key：
  // **生产版不报警告**，只是把那一行重复渲染（实测 3 份）、把「被遮蔽」徽章挂到邻居身上，
  // 详情里的状态也停在旧值。所以契约是「一个身份一行，停用件优先」，在这两个数组的产出处成立。
  const base = await mkdtemp(join(tmpdir(), 'dsh-skills-stale-'))
  const agentsHome = join(base, 'agents-home')
  const skillsRoot = join(agentsHome, 'skills')
  const skillDir = join(skillsRoot, 'zhanggui')
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, 'SKILL.md.disabled'), '---\nname: zhanggui\ndescription: 磁盘上是停用那份\n---\n\n正文\n')
  try {
    const staleRow = {
      name: 'zhanggui',
      description: '缓存里那份（其实已经改名了）',
      source: 'user-agents',
      path: join(skillDir, 'SKILL.md'),
    }
    const ctx = {
      // 陈旧视图：宿主缓存仍把它当**已启用**返回 —— 这正是缺陷的输入
      get: (name) => (name === 'skills' ? { list: async () => [staleRow] } : undefined),
      loader: {
        entries: () => [{
          options: {
            name: '@deepseek-ai/dsh-skill-filesystem',
            config: { dshHome: join(base, 'dsh-home'), agentsHome },
          },
        }],
      },
    }
    const result = await SkillsManagerGateway.prototype.list.call({ ctx }, {})
    assert.deepEqual(result.skills.map((row) => row.name), [],
      '缓存里那条陈旧行必须被剔掉：它和停用件是同一个身份，同时出现就是客户端重复 key 的来源')
    assert.deepEqual(result.disabled.map((row) => row.name), ['zhanggui'], '停用件才是磁盘上的真相，必须留下')
    // 契约本身：两个数组的身份**互不相交**（客户端行 key 就是这个身份）。
    const keys = [...result.skills, ...result.disabled].map((row) => skillRowKey(row))
    assert.equal(new Set(keys).size, keys.length, `同一个身份只能出现一次，实际：${JSON.stringify(keys)}`)
    // 元组钉死：与客户端 lib/client.js 的 skillIdentity 必须是同一个字面量
    // （client-behavior 那条用例钉的是同一串）。
    assert.equal(skillRowKey(staleRow), 'user-agents\u0000\u0000zhanggui',
      '身份元组变了就要同时改客户端 skillIdentity —— 否则去重失效、重复 key 回归')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('reads one skill body from the referenced root, on demand', async () => {  // 同一个名字可以存在于多个根（同名跨作用域是合法配置）。detail 必须读**引用指向的那个根**，
  // 而不是宿主按 rank 给的胜者 —— 否则点「被遮蔽」那一行看到的是别人的正文（D8 的精确模型）。
  // 这里让 user-dsh（rank 400，胜者）与 user-agents（rank 500）各有一份，读后者。
  const base = await mkdtemp(join(tmpdir(), 'dsh-skills-detail-'))
  const agentsHome = join(base, 'agents-home')
  const dshHome = join(base, 'dsh-home')
  const agentsRoot = join(agentsHome, 'skills')
  const dshRoot = join(dshHome, 'skills')
  await mkdir(join(agentsRoot, 'zhanggui'), { recursive: true })
  await writeFile(join(agentsRoot, 'zhanggui', 'SKILL.md'), '---\nname: zhanggui\ndescription: 端到端拥有一个开发请求\n---\n\n# 掌柜\n\n正文\n')
  await mkdir(join(dshRoot, 'zhanggui'), { recursive: true })
  await writeFile(join(dshRoot, 'zhanggui', 'SKILL.md'), '---\nname: zhanggui\ndescription: 另一份\n---\n\n# 另一个根\n')
  try {
    const ctx = {
      get: () => undefined,
      loader: {
        entries: () => [{
          options: {
            name: '@deepseek-ai/dsh-skill-filesystem',
            config: { dshHome, agentsHome },
          },
        }],
      },
    }
    const found = await SkillsManagerGateway.prototype.detail.call({ ctx }, { name: 'zhanggui', source: 'user-agents', root: agentsRoot })
    assert.equal(found.skill.name, 'zhanggui')
    assert.match(found.skill.content, /正文/)
    assert.equal(found.skill.source, 'user-agents')
    const other = await SkillsManagerGateway.prototype.detail.call({ ctx }, { name: 'zhanggui', source: 'user-dsh', root: dshRoot })
    assert.match(other.skill.content, /另一个根/, '读的必须是引用指向的那个根，不是 rank 胜者')
    // 找不到要**报错**而不是返回空对象：面板要区分「没有这个技能」与「读失败」。
    await assert.rejects(
      () => SkillsManagerGateway.prototype.detail.call({ ctx }, { name: 'nope', source: 'user-agents', root: agentsRoot }),
      /nope/,
    )
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('importSkill lands in the referenced root and refuses a read-only one', async () => {
  // 网关层的导入路径（`skillsManager/importSkill`）：落点只认引用，只读根一律拒。
  // 这条补的是「变更类 RPC 零用例」的缺口——之前只有 skillHubInstall 被端到端跑过。
  const base = await mkdtemp(join(tmpdir(), 'dsh-import-rpc-'))
  const agentsHome = join(base, 'agents-home')
  const bundled = join(base, 'bundled')
  const source = join(base, 'to-import')
  await mkdir(source, { recursive: true })
  // 只读根也要先建出来：下面那条「内置根不得被写入」要靠 readdir 去**看**这个目录，
  // 不建就是 ENOENT——断言写在那儿却从来没跑到（真实动机是「拒绝了，就什么都没落下」）。
  await mkdir(bundled, { recursive: true })
  await writeFile(join(source, 'SKILL.md'), '---\nname: imported-by-rpc\ndescription: 来自 RPC 的导入\n---\n\n正文\n')
  const ctx = {
    get: () => undefined,
    loader: {
      entries: () => [{
        options: { name: '@deepseek-ai/dsh-skill-filesystem', config: { dshHome: join(base, 'dsh-home'), agentsHome, bundledSkillDir: bundled } },
      }],
    },
  }
  const root = join(agentsHome, 'skills')
  try {
    const result = await SkillsManagerGateway.prototype.importSkill.call({ ctx }, {
      source: 'user-agents',
      root,
      type: 'directory',
      path: source,
    })
    assert.equal(result.name, 'imported-by-rpc')
    assert.equal(existsSync(join(root, 'imported-by-rpc', 'SKILL.md')), true)
    // 只读根（bundled）：即使载荷里没有任何 writable 字段也必须被拒
    await assert.rejects(
      () => SkillsManagerGateway.prototype.importSkill.call({ ctx }, {
        source: 'bundled',
        root: bundled,
        type: 'directory',
        path: source,
      }),
      /只读/,
    )
    assert.deepEqual(await readdir(bundled), [], '内置根不得被写入')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})


