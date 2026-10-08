// 市场远端搜索（skills.sh）—— row 14。
//
// 这一层的价值全在**失败时的行为**：它是本插件第二个（也是最后一个）网络依赖，而 SPEC
// 约束 11 要求「市场首屏必须离线可用（内置目录），远端搜索失败必须**静默降级**」。
// 所以测试重点不是「能不能搜到」，而是：
//   · 白名单过滤（约束 9）—— skills.sh 的 source 字段**实测含仿冒同名**；
//   · 超时 / 缓存 / 净降级 —— 网络坏了市场照常可用；
//   · 不把远端数据当成可信输入（它要拼进路径/写进目录，必须校验形态）。
//
// 已用真实请求核实的 API 行为（2026-10-08 实测，非文档）：
//   GET https://skills.sh/api/search?q=<≥2字符>&limit=1..200
//   → 200 {"query","searchType","searchVersion","skills":[{"id","source","skillId","name","installs"}],"count",…}
//   · limit=0 → 夹到 1；limit=500 → 夹到 200；不传 limit → 100（上限 200）
//   · q 少于 2 字符 → **400** {"error":"Query must be at least 2 characters"}
//   · q=superpowers 实测返回 **9 个不同 source** 的同名技能（obra/superpowers 与
//     101-skills/superpowers、qu-skills/superpowers 等），正是约束 9 说的仿冒同名
//   · 出现过非 owner/repo 形态的 source（`open.feishu.cn`，裸主机名）
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SKILLS_SH_API,
  MIN_QUERY_LENGTH,
  MAX_LIMIT,
  DEFAULT_LIMIT,
  isGithubSource,
  searchRemoteSkills,
  resetSkillsSearchCache,
} from '../lib/skills-remote.js'

/** 造一个 only-network 的假 fetch：记录调用，返回给定的 JSON。 */
function fakeFetch(payload, options = {}) {
  const calls = []
  const impl = async (url, init) => {
    calls.push({ url, init })
    if (options.throws) throw options.throws
    return {
      ok: options.ok ?? true,
      status: options.status ?? 200,
      async json() { return payload },
    }
  }
  impl.calls = calls
  return impl
}

const sample = (over = {}) => ({
  id: 'obra/superpowers/test-driven-development',
  source: 'obra/superpowers',
  skillId: 'test-driven-development',
  name: 'test-driven-development',
  installs: 243329,
  ...over,
})

test('queries the documented endpoint with a clamped limit', async () => {
  resetSkillsSearchCache()
  const fetchImpl = fakeFetch({ skills: [sample()], count: 1 })
  await searchRemoteSkills({ query: 'tdd', limit: 999, fetchImpl, allowlist: new Set(['obra/superpowers']) })

  assert.equal(fetchImpl.calls.length, 1)
  const url = new URL(fetchImpl.calls[0].url)
  assert.equal(url.origin + url.pathname, SKILLS_SH_API)
  assert.equal(url.searchParams.get('q'), 'tdd')
  // 上限 200 是实测出来的（传 500 也只回 200），夹住可以少一次无效往返。
  assert.equal(url.searchParams.get('limit'), String(MAX_LIMIT))
})

test('a query shorter than two characters never reaches the network', async () => {
  // 实测：q 少于 2 字符直接 **400**（{"error":"Query must be at least 2 characters"}）。
  // 搜索框是随打随搜的，1 个字符时发请求等于每次输入都白挨一个 400，还会污染缓存。
  resetSkillsSearchCache()
  const fetchImpl = fakeFetch({ skills: [] })
  for (const query of ['', 'a', ' ']) {
    const result = await searchRemoteSkills({ query, fetchImpl, allowlist: new Set() })
    assert.deepEqual(result.skills, [])
    assert.equal(result.skipped, 'query-too-short')
  }
  assert.equal(fetchImpl.calls.length, 0, '不足 2 字符不得发起请求（实测会 400）')
})

test('filters results down to the allowlisted owners', async () => {
  // SPEC 约束 9 的核心：实测 q=superpowers 返回 9 个不同 source 的同名技能，
  // 其中只有 obra/superpowers 是我们核实过的那一个。白名单是**硬过滤**——
  // 仿冒同名混进市场会直接损害用户（装到别人的同名技能）。
  resetSkillsSearchCache()
  const payload = {
    skills: [
      sample({ source: 'obra/superpowers', name: 'superpowers', id: 'obra/superpowers/superpowers' }),
      sample({ source: '101-skills/superpowers', name: 'superpowers', id: '101-skills/superpowers/superpowers' }),
      sample({ source: 'qu-skills/superpowers', name: 'superpowers', id: 'qu-skills/superpowers/superpowers' }),
      sample({ source: 'anthropics/skills', name: 'pdf', id: 'anthropics/skills/pdf' }),
    ],
    count: 4,
  }
  const result = await searchRemoteSkills({
    query: 'superpowers',
    fetchImpl: fakeFetch(payload),
    allowlist: new Set(['obra/superpowers', 'anthropics/skills']),
  })
  assert.deepEqual(result.skills.map((row) => row.source).sort(), ['anthropics/skills', 'obra/superpowers'])
  // 被过滤掉的条数要能报出来，便于 UI 说明「其余来自未核实来源」。
  assert.equal(result.filtered, 2)
})

test('rejects sources that are not owner/repo shaped', async () => {
  // 实测出现过 `open.feishu.cn`（裸主机名）这类值。它们无法对应到可抓取的仓库路径，
  // 放进来只会得到一条永远装不上的卡片。
  resetSkillsSearchCache()
  const payload = {
    skills: [
      sample({ source: 'open.feishu.cn', name: 'feishu', id: 'open.feishu.cn/feishu' }),
      sample({ source: 'obra/superpowers', name: 'ok', id: 'obra/superpowers/ok' }),
    ],
    count: 2,
  }
  const result = await searchRemoteSkills({
    query: 'skill',
    fetchImpl: fakeFetch(payload),
    allowlist: new Set(['open.feishu.cn', 'obra/superpowers']),
  })
  // 即便白名单里写了它，形态不合法也必须拒绝——白名单与形态校验是两道独立的闸。
  assert.deepEqual(result.skills.map((row) => row.source), ['obra/superpowers'])
})

test('isGithubSource accepts real shapes and rejects the odd ones seen live', () => {
  for (const good of ['obra/superpowers', 'anthropics/skills', 'my-org/my_repo.v2', 'a1/b2']) {
    assert.equal(isGithubSource(good), true, good + ' 应被接受')
  }
  for (const bad of ['open.feishu.cn', 'smithery.ai/x', '', '/leading', 'trailing/', 'a/b/c', 'a b/c', null, undefined, 42]) {
    assert.equal(isGithubSource(bad), false, JSON.stringify(bad) + ' 应被拒绝')
  }
})

test('degrades silently to an empty result when the network fails', async () => {
  // SPEC 约束 11：远端搜索失败必须**静默降级**——市场仍要能用内置目录。
  // 抛错会让整个市场页打不开，代价远大于「搜不到远端」。
  resetSkillsSearchCache()
  const failures = [
    new Error('network down'),
    Object.assign(new Error('timeout'), { name: 'TimeoutError' }),
  ]
  for (const error of failures) {
    const result = await searchRemoteSkills({ query: 'tdd', fetchImpl: fakeFetch(null, { throws: error }), allowlist: new Set() })
    assert.deepEqual(result.skills, [])
    assert.equal(typeof result.degraded, 'string', '要能告诉 UI 这是降级结果')
  }
})

test('degrades on a non-ok response and on malformed json', async () => {
  resetSkillsSearchCache()
  const notOk = await searchRemoteSkills({
    query: 'tdd', fetchImpl: fakeFetch(null, { ok: false, status: 503 }), allowlist: new Set(),
  })
  assert.deepEqual(notOk.skills, [])
  assert.equal(typeof notOk.degraded, 'string')

  resetSkillsSearchCache()
  const malformed = await searchRemoteSkills({
    query: 'tdd',
    fetchImpl: async () => ({ ok: true, status: 200, async json() { throw new Error('not json') } }),
    allowlist: new Set(),
  })
  assert.deepEqual(malformed.skills, [])
  assert.equal(typeof malformed.degraded, 'string')
})

test('tolerates a response whose skills field is missing or not an array', async () => {
  for (const payload of [{}, { skills: null }, { skills: 'nope' }, { error: 'Query must be at least 2 characters' }]) {
    resetSkillsSearchCache()
    const result = await searchRemoteSkills({ query: 'tdd', fetchImpl: fakeFetch(payload), allowlist: new Set() })
    assert.deepEqual(result.skills, [], JSON.stringify(payload) + ' 不得导致抛错')
  }
})

test('passes an abort signal so a hung request cannot stall the market', async () => {
  // 超时靠 AbortSignal.timeout（与既有 checkForUpdate 同一手法）：没有它，一个挂住的
  // 请求会让市场的「搜索补充」永远转圈。
  resetSkillsSearchCache()
  const fetchImpl = fakeFetch({ skills: [] })
  await searchRemoteSkills({ query: 'tdd', fetchImpl, allowlist: new Set() })
  assert.notEqual(fetchImpl.calls[0].init?.signal, undefined, '必须带 abort signal')
})

test('caches identical queries so typing does not re-hit the network', async () => {
  resetSkillsSearchCache()
  const fetchImpl = fakeFetch({ skills: [sample()], count: 1 })
  const options = { query: 'tdd', fetchImpl, allowlist: new Set(['obra/superpowers']) }
  const first = await searchRemoteSkills(options)
  const second = await searchRemoteSkills(options)

  assert.equal(fetchImpl.calls.length, 1, '同一查询第二次应命中缓存')
  assert.deepEqual(second.skills, first.skills)
  assert.equal(second.cached, true)
})

test('normalizes the query before caching so case and spacing do not split the cache', async () => {
  resetSkillsSearchCache()
  const fetchImpl = fakeFetch({ skills: [sample()], count: 1 })
  const allowlist = new Set(['obra/superpowers'])
  await searchRemoteSkills({ query: 'TDD', fetchImpl, allowlist })
  await searchRemoteSkills({ query: '  tdd  ', fetchImpl, allowlist })
  assert.equal(fetchImpl.calls.length, 1, '大小写与首尾空白应归一后再比缓存')
})

test('shapes each result into the fields the market card needs', async () => {
  resetSkillsSearchCache()
  const result = await searchRemoteSkills({
    query: 'tdd',
    fetchImpl: fakeFetch({ skills: [sample()], count: 1 }),
    allowlist: new Set(['obra/superpowers']),
  })
  const [row] = result.skills
  // 远端条目的形状要与内置目录**可共存于同一张卡片**（组件只认这几个字段）。
  assert.equal(row.name, 'test-driven-development')
  assert.equal(row.source, 'obra/superpowers')
  assert.equal(row.installs, 243329)
  // 远端条目标记为 remote，UI 据此说明「未纳入内置目录、来源来自 skills.sh」。
  assert.equal(row.remote, true)
  // 没有许可数据 ⇒ 不得假装可安装：远端搜索**不做**许可判定（那是内置目录的职责），
  // 所以 installable 必须缺省为不可安装，由 UI 提示用户去核实。
  assert.notEqual(row.installable, true, '远端条目不得默认可安装（未做许可核实）')
})

test('sends no credentials and no cookies', async () => {
  // 免鉴权接口：带上凭据既无必要，也会把用户身份泄露给第三方。
  resetSkillsSearchCache()
  const fetchImpl = fakeFetch({ skills: [] })
  await searchRemoteSkills({ query: 'tdd', fetchImpl, allowlist: new Set() })
  const init = fetchImpl.calls[0].init ?? {}
  assert.equal(init.headers?.authorization, undefined)
  assert.equal(init.headers?.cookie, undefined)
  assert.equal(init.credentials, undefined)
})

test('exposes the documented defaults', () => {
  assert.equal(SKILLS_SH_API, 'https://skills.sh/api/search')
  assert.equal(MIN_QUERY_LENGTH, 2)
  assert.equal(DEFAULT_LIMIT, 100)
  assert.equal(MAX_LIMIT, 200)
})

test('the host allowlist stays in sync with the catalog sources', async () => {
  // 白名单在 lib/index.js 里是常量，而「哪些来源可信」的真相源是内置目录
  // （.tasks/skills-verified.yaml → lib/skills-catalog.js）。两处不同步会出两种事故：
  //   · 白名单多一个来源 → 远端能搜出目录里没有（未核实）的来源；
  //   · 白名单少一个来源 → 目录里有的来源在远端搜索里**永远被过滤掉**（静默少结果）。
  // 所以这里直接比对两者，而不是靠注释承诺。
  const { SkillsManagerGateway } = await import('../lib/index.js')
  const { SKILL_CATALOG } = await import('../lib/skills-catalog.js')
  // 通过行为取样反推白名单：拿一批候选 source 去问，只有白名单里的才会留下。
  const candidates = [
    'anthropics/skills', 'github/awesome-copilot', 'obra/superpowers', 'wshobson/agents',
    'fake-owner/superpowers', '101-skills/superpowers', 'smithery.ai/x', 'open.feishu.cn',
  ]
  const payload = { skills: candidates.map((source) => ({ id: source + '/x', source, skillId: 'x', name: 'x', installs: 1 })), count: candidates.length }
  resetSkillsSearchCache()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, status: 200, async json() { return payload } })
  try {
    const result = await SkillsManagerGateway.prototype.searchRemote.call({ ctx: { get: () => undefined } }, { query: 'skill' })
    const allowed = result.skills.map((row) => row.source).sort()
    const catalogSources = [...new Set(SKILL_CATALOG.map((entry) => entry.source))].sort()
    assert.deepEqual(allowed, catalogSources,
      `远端白名单与内置目录来源不同集合：白名单放行 ${JSON.stringify(allowed)}，目录有 ${JSON.stringify(catalogSources)}`)
  } finally {
    globalThis.fetch = originalFetch
    resetSkillsSearchCache()
  }
})
