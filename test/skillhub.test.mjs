// skillhub.cn 直连客户端：把「上游形状」与「面板要的形状」之间的那层映射钉住。
//
// 全部用例都注入假 fetch（**不真联网**）：真实网络会让用例变慢、变脆，而且上游改字段时
// 我们想要的信号是「映射错了」而不是「网络超时了」。真机联调另有一条烟测路径（见 SPEC）。
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { downloadHubArchive, hubCategories, hubSkillDetail, normalizeHubSkill, searchHubSkills } from '../lib/skillhub.js'

/** 假 fetch：记录请求，按 URL 返回预置响应。 */
const fakeFetch = (routes) => {
  const calls = []
  const impl = async (url, init) => {
    calls.push({ url: String(url), init })
    for (const [match, responder] of routes) {
      if (String(url).includes(match)) return responder(String(url), init)
    }
    return { ok: false, status: 404, headers: new Map(), json: async () => ({}), text: async () => '' }
  }
  impl.calls = calls
  return impl
}

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  json: async () => body,
})

test('搜索：只取面板要的字段，并把上游的命名差异一次消化掉', () => {
  // 字段名取自真机抓到的响应（keyword=pdf）。
  const raw = {
    slug: 'pdf-image-text-extractor',
    name: 'PDF和图片文字提取',
    description: 'English fallback',
    description_zh: '中文说明优先',
    category: 'office-efficiency',
    subCategories: [{ key: 'office-doc', name: '文档处理' }, { key: 'office-pdf', name: 'PDF 处理' }],
    labels: { requires_api_key: 'true', pricing_type: 'free' },
    downloads: 200470, stars: 185, installs: 378,
    ownerName: 'user_5f9c21aa',
    verified: false,
    source: 'community',
    version: '1.0.13',
    iconUrl: 'https://example.com/i.png',
    // 上游的 homepage 是 api.skillhub.cn/<owner>/<slug>，文档明说不要用它当页面地址
    homepage: 'https://api.skillhub.cn/user_5f9c21aa/pdf-image-text-extractor',
  }
  const view = normalizeHubSkill(raw)
  assert.equal(view.summary, '中文说明优先', 'description_zh 优先')
  assert.equal(view.requiresApiKey, true, 'labels 是字符串 "true"，要按字符串判')
  assert.equal(view.pageUrl, 'https://skillhub.cn/skills/pdf-image-text-extractor', '页面地址由 slug 拼，不用 homepage')
  assert.deepEqual(view.subCategories, ['文档处理', 'PDF 处理'])
  assert.equal(view.source, 'skillhub', '来源标记固定，面板据此区分内置目录与外部源')
  assert.equal(view.downloads, 200470)

  // "false" 不能被当成真（JS 里 Boolean("false") === true，这是最容易错的一处）
  assert.equal(normalizeHubSkill({ slug: 'x', labels: { requires_api_key: 'false' } }).requiresApiKey, false)
  assert.equal(normalizeHubSkill({ slug: 'y' }).requiresApiKey, false, '没有 labels 时按「不需要」')
})

test('搜索：分页与排序参数按上游约定拼，且解析 total', async () => {
  const fetchImpl = fakeFetch([
    ['/api/skills?', () => jsonResponse({ code: 0, message: 'success', data: { total: 4265, skills: [{ slug: 'a' }] } })],
  ])
  const result = await searchHubSkills({ keyword: 'pdf', pageSize: 500 }, { fetch: fetchImpl })
  const url = new URL(fetchImpl.calls[0].url)
  assert.equal(url.origin + url.pathname, 'https://api.skillhub.cn/api/skills')
  assert.equal(url.searchParams.get('keyword'), 'pdf')
  assert.equal(url.searchParams.get('sortBy'), 'score', '有关键词时用智能打分')
  assert.equal(url.searchParams.get('pageSize'), '100', 'pageSize 上限 100，超了要夹住')
  assert.equal(result.total, 4265)
  assert.equal(result.skills[0].slug, 'a')

  // 纯浏览（无关键词）按热度更适合市场首屏
  const browse = fakeFetch([['/api/skills?', () => jsonResponse({ code: 0, data: { total: 0, skills: [] } })]])
  await searchHubSkills({}, { fetch: browse })
  assert.equal(new URL(browse.calls[0].url).searchParams.get('sortBy'), 'downloads')
})

test('详情：发布方认证 + 两份安全扫描都带出来（这是外部源唯一的信任信息）', async () => {
  const fetchImpl = fakeFetch([
    ['/api/v1/skills/tencent-docs', () => jsonResponse({
      slug: 'tencent-docs',
      latestVersion: { version: '1.0.41', changelog: 'New version' },
      publisher: { name: '腾讯文档团队', verified: true, certifiedName: '腾讯科技（深圳）有限公司' },
      securityReports: {
        keen: { status: 'benign', statusText: '安全，无风险', reportUrl: 'https://tix.qq.com/x' },
        sanbu: { status: 'benign', statusText: '安全，无风险', reportUrl: 'https://cloudsec.tencent.com/y' },
      },
      skill: { stats: { downloads: 1583106, stars: 317, installs: 8107 }, summary_zh: '腾讯文档…' },
    })],
  ])
  const detail = await hubSkillDetail('tencent-docs', { fetch: fetchImpl })
  assert.equal(detail.version, '1.0.41')
  assert.equal(detail.publisher.verified, true)
  assert.equal(detail.publisher.certifiedName, '腾讯科技（深圳）有限公司', '认证主体才是「谁背的书」')
  assert.equal(detail.security.keen.status, 'benign')
  assert.equal(detail.security.sanbu.statusText, '安全，无风险')
  assert.equal(detail.stats.installs, 8107)
  assert.equal(detail.pageUrl, 'https://skillhub.cn/skills/tencent-docs')
  // 老版本上游可能缺 securityReports：不能因此崩，缺就是 null。
  const bare = fakeFetch([['/api/v1/skills/x', () => jsonResponse({ slug: 'x', skill: {} })]])
  assert.equal((await hubSkillDetail('x', { fetch: bare })).security.keen, null)
})

test('失败路径：HTTP 错误、业务 code、非 JSON、超时都转成一句可读的话', async () => {
  const http500 = fakeFetch([['/api/skills?', () => jsonResponse({}, 500)]])
  await assert.rejects(() => searchHubSkills({}, { fetch: http500 }), /HTTP 500/)

  const bizFail = fakeFetch([['/api/skills?', () => jsonResponse({ code: 4001, message: '无效 slug' })]])
  await assert.rejects(() => searchHubSkills({}, { fetch: bizFail }), /无效 slug/)

  const notJson = fakeFetch([['/api/skills?', () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => { throw new Error('bad') } })]])
  await assert.rejects(() => searchHubSkills({}, { fetch: notJson }), /不是 JSON/)

  const timeout = fakeFetch([['/api/skills?', () => { const error = new Error('timed out'); error.name = 'TimeoutError'; throw error; }]])
  await assert.rejects(() => searchHubSkills({}, { fetch: timeout }), /请求超时/)
})

test('下载：跟随 302 落到本地文件，并边下边数、超限即拒', async () => {
  // ⚠️ 前缀不能用 `dsh-skillhub-`：skillhub-install.test.mjs 的 stagingDirs() 按
  // `startsWith('dsh-skillhub-')` 过滤临时目录做前后对比，而 node --test 多文件并行——
  // 本文件窗口内建了又清的目录会被那条用例拍到，造成假红（CI 上实过一次：
  // actual [] vs expected ['dsh-skillhub-dl-…']）。用 dsh-hub- 系彻底不相交。
  const dir = await mkdtemp(join(tmpdir(), 'dsh-hub-dl-'))
  try {
    const payload = Buffer.from('PK\u0003\u0004 fake zip bytes')
    const fetchImpl = fakeFetch([['/api/v1/download?', () => ({
      ok: true,
      status: 200,
      url: 'https://skillhub-1388575217.cos.accelerate.myqcloud.com/skills/11288/tencent-docs/1.0.41.zip',
      headers: { get: (name) => (name.toLowerCase() === 'content-length' ? String(payload.length) : null) },
      body: ReadableStream.from([payload]),
    })]])
    const result = await downloadHubArchive('tencent-docs', { dir, fetch: fetchImpl })
    assert.equal(result.bytes, payload.length)
    assert.match(result.path, /tencent-docs-latest\.zip$/)
    assert.deepEqual(await readFile(result.path), payload, '落到盘上的就是上游给的字节')
    assert.match(fetchImpl.calls[0].url, /\/api\/v1\/download\?slug=tencent-docs/)

    // content-length 声明过大：直接拒绝，不下载
    const tooBig = fakeFetch([['/api/v1/download?', () => ({
      ok: true, status: 200, headers: { get: () => String(64 * 1024 * 1024) }, body: ReadableStream.from([payload]),
    })]])
    await assert.rejects(() => downloadHubArchive('x', { dir, fetch: tooBig }), /过大/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('分类：key → 当前语言标签，中英两份按语言挑', async () => {
  // 真实响应形状（2026-10-14 实测 api.skillhub.cn）：{count, items}，每分类 name + nameEn。
  // 曾经的错：读 body.data（形状从没对上，分类整个拿不到）+ 只读 name（英文界面漏中文）。
  const fetchImpl = fakeFetch([['/api/v1/categories', () => jsonResponse({
    count: 3,
    items: [
      { key: 'office-efficiency', name: '办公效率', nameEn: 'Office Efficiency' },
      { key: 'dev-programming', name: '开发编程', nameEn: 'Development' },
      { key: 'pay-skill', name: '付费技能', nameEn: 'Pay Skill' },
    ],
  })]])
  // 默认（中文）与 language 缺失时：name。
  assert.deepEqual(await hubCategories({ fetch: fetchImpl }), {
    'office-efficiency': '办公效率',
    'dev-programming': '开发编程',
    'pay-skill': '付费技能',
  })
  assert.deepEqual(await hubCategories({ fetch: fetchImpl, locale: 'zh' }), {
    'office-efficiency': '办公效率',
    'dev-programming': '开发编程',
    'pay-skill': '付费技能',
  })
  // 显式英文：nameEn；带地区的 en-* 也算。
  assert.deepEqual(await hubCategories({ fetch: fetchImpl, locale: 'en' }), {
    'office-efficiency': 'Office Efficiency',
    'dev-programming': 'Development',
    'pay-skill': 'Pay Skill',
  })
  assert.deepEqual((await hubCategories({ fetch: fetchImpl, locale: 'en-US' }))['dev-programming'], 'Development')

  // 缺 nameEn 的条目回落 name（上游个别分类可能没译）。
  const partial = fakeFetch([['/api/v1/categories', () => jsonResponse({
    count: 1,
    items: [{ key: 'x', name: '只有中文' }],
  })]])
  assert.deepEqual(await hubCategories({ fetch: partial, locale: 'en' }), { x: '只有中文' })

  // 形状不符：**抛错**，不静默返回 {}——没有分类的市场比一句报错难排查得多
  // （旧代码读 body.data，真实形状是顶层 items，于是分类整个不显示）。
  const weird = fakeFetch([['/api/v1/categories', () => jsonResponse({ code: 0, data: { unexpected: true } })]])
  await assert.rejects(() => hubCategories({ fetch: weird }), /分类响应形状不符/)
})
