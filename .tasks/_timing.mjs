// 实测「改完技能多久生效」——我要在公开 issue 里说这个数字，所以自己再量一次，
// 不能只引用之前写在注释里的结论。
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const PEERS = join(process.cwd(), 'node_modules', '@deepseek-ai')
const load = async (s) => await import(pathToFileURL(join(PEERS, s)).href)
const { Context } = await load('cordis/lib/index.js')
const { SkillRegistry, isModelInvocable } = await load('dsh-skill/lib/index.js')
const fsProvider = await load('dsh-skill-filesystem/lib/index.js')

const base = await mkdtemp(join(tmpdir(), 'timing-'))
const agentsHome = join(base, 'agents-home')
const root = join(agentsHome, 'skills')
const dshHome = join(base, 'dsh-home')
await mkdir(join(root, 'the-skill'), { recursive: true })
const file = join(root, 'the-skill', 'SKILL.md')
const ENABLED = '---\nname: the-skill\ndescription: 演示\n---\n\n正文\n'
const DISABLED = '---\nname: the-skill\ndescription: 演示\ndisable-model-invocation: true\n---\n\n正文\n'

const ctx = new Context()
await ctx.plugin(SkillRegistry)
const fiber = ctx.plugin({
  apply: fsProvider.apply, inject: fsProvider.inject, name: fsProvider.name, Config: fsProvider.Config,
}, { dshHome, agentsHome, watch: true })
await fiber

const modelSees = async () => (await ctx.skills.list({})).filter(isModelInvocable).some((s) => s.name === 'the-skill')

/** 写文件 → 轮询宿主，量到「模型面真的变了」为止。 */
const measure = async (content, want) => {
  await writeFile(file, content)
  const t0 = Date.now()
  for (;;) {
    const seen = await modelSees()
    if (seen === want) return Date.now() - t0
    if (Date.now() - t0 > 8000) return -1
    await new Promise((r) => setTimeout(r, 20))
  }
}
try {
  await writeFile(file, ENABLED)
  await new Promise((r) => setTimeout(r, 600))   // 让初始状态稳定
  const runs = []
  for (let i = 0; i < 4; i += 1) {
    runs.push(await measure(DISABLED, false))   // 关
    runs.push(await measure(ENABLED, true))     // 开
  }
  const ok = runs.filter((r) => r >= 0)
  console.log('每次「写盘 → 模型面真的改变」用时(ms):', runs.join(', '))
  console.log(`样本 ${ok.length}；最小 ${Math.min(...ok)} / 中位 ${ok.sort((a, b) => a - b)[Math.floor(ok.length / 2)]} / 最大 ${Math.max(...ok)}`)
  console.log('（watcher 的 stabilityThreshold 是 200ms，所以量级落在 100~300ms 是预期的）')
} finally {
  await fiber.dispose?.()
  await rm(base, { recursive: true, force: true })
}
