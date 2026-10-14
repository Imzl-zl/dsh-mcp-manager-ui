// skillhub.cn 的直连客户端（面板的第二个市场来源）。
//
// 为什么直连上游、不复用那个已经存在的插件：把 skillhub 接进 DSH 的那个第三方插件
// （@cocofhu/skillhub）走的是它**自己注册的同源路由** /skillhub —— 那是它的私有协议，
// 不是宿主契约（它换版本、被卸载，这条路就没了），而且那个插件同时握着装/重启 DSH 插件
// 的权限。上游本身是**公开且无鉴权**的，直接调即可：
//
//   GET {base}/api/skills?keyword=&category=&sortBy=&page=&pageSize=   搜索/列表
//   GET {base}/api/v1/skills/<slug>                                    详情（含发布方认证与安全扫描）
//   GET {base}/api/v1/download?slug=<slug>[&version=]                  302 跳转到 zip
//
// 三个端点都在真机上验过（搜索返回 code:0/data.skills、下载 302 →
// https://skillhub-…cos.accelerate.myqcloud.com/skills/<id>/<slug>/<version>.zip）。
//
// 面板本身不联网：这些请求全在**宿主侧**发出，所以 CORS 也不存在
// （那个第三方插件之所以要服务端代理，多半就是浏览器直连过不去）。
//
// ⚠️ 上游**没有 license 字段**。它给的是发布方企业认证（publisher.certifiedName）与
// 腾讯安全扫描结论（securityReports.keen/sanbu 的 status/statusText/reportUrl）。
// 所以这里**不做许可判定**，只做披露 + 显式确认——不编一个自己没把握的判定出来。
// 市场只剩这一个来源（自维护的「内置精选」目录与 skills.sh 搜索已于 2026-10-10 删除）。

import { createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

/** 上游基址。留环境变量是为了让内网/镜像也能用，测试则直接注入 fetch 替身。 */
const DEFAULT_BASE = 'https://api.skillhub.cn'
const HUB_BASE_ENV = 'DSH_SKILLHUB_BASE'
const DEFAULT_TIMEOUT_MS = 20000
/** 上游页面地址：**不要**用接口里的 homepage 字段（那是 api.skillhub.cn/<owner>/<slug>）。 */
const PAGE_BASE = 'https://skillhub.cn/skills/'
/** 单个 zip 的上限。真正的大小限制在 importSkill 解压那一步按实际字节再判一次。 */
const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024

function hubBase(options) {
  const configured = options?.baseUrl ?? process.env?.[HUB_BASE_ENV] ?? DEFAULT_BASE
  return String(configured).replace(/\/+$/, '')
}

/** 合并「外层取消信号」与「本次超时」：任一触发都该中断请求。 */
function requestSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs)
  if (signal === undefined || signal === null) return timeout
  return typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, timeout]) : timeout
}

async function hubFetch(fetchImpl, url, options = {}) {
  const doFetch = fetchImpl ?? globalThis.fetch
  if (typeof doFetch !== 'function') throw new Error('当前环境没有 fetch，无法访问 skillhub.cn')
  let response
  try {
    response = await doFetch(url, {
      headers: { accept: 'application/json' },
      signal: requestSignal(options.signal, options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })
  } catch (error) {
    // 超时与网络失败都归成一句可读的话：面板只显示这一句。
    const reason = error?.name === 'TimeoutError' || error?.name === 'AbortError' ? '请求超时' : String(error?.message || error)
    throw new Error('连接 skillhub.cn 失败：' + reason)
  }
  if (!response.ok) throw new Error('skillhub.cn 返回 HTTP ' + response.status)
  return response
}

async function hubJson(fetchImpl, url, options) {
  const response = await hubFetch(fetchImpl, url, options)
  let body
  try {
    body = await response.json()
  } catch {
    throw new Error('skillhub.cn 返回的不是 JSON（可能是被网络中间层改写了）')
  }
  // 上游用 {code:0,message,data} 包了一层；code !== 0 就是业务失败。
  if (body !== null && typeof body === 'object' && 'code' in body && body.code !== 0) {
    throw new Error('skillhub.cn 业务错误：' + String(body.message || body.code))
  }
  return body
}

/**
 * 按语言挑一条上游文案：中文（默认）用 `_zh` 变体，英文用发布方原文。
 *
 * 为什么要有这个：上游**每条都带两份**——`description` 是发布方自己写的，
 * `description_zh` 是平台给的中文版。原先一律取 `_zh`，于是英文界面下的市场
 * 全是中文。这里只改「挑哪一份」，不改任何字段的形状。
 *
 * 默认（不传 / 传 'zh'）与改前**逐字节一致**：仍优先 `_zh`。
 * 中文用户看到的东西一点没变——这就是「不要动中文默认」。
 *
 * ⚠️ 英文侧是**尽力而为**：发布方本来就用中文写的条目（实测 100 条里约 72 条），
 * `description` 也是中文，没有英文可给；那种情况下照常回落，不会给出空文案。
 *
 * @param {object} item - 上游条目。
 * @param {string} base - 字段基名（description / summary）。
 * @param {string} [locale] - 'en' 走原文，其它一律走 `_zh`。
 * @returns {string}
 */
function pickLocalized(item, base, locale) {
  const plain = item?.[base]
  const zh = item?.[`${base}_zh`]
  if (String(locale ?? '').toLowerCase().startsWith('en')) return String(plain || zh || '')
  return String(zh || plain || '')
}

/**
 * 把上游的条目映射成面板要的形状。
 *
 * 只取**面板真的会显示**的字段，并在这里把命名差异一次消化掉：
 * 文案由 {@link pickLocalized} 按语言挑（**默认中文优先，与改前一致**）、
 * `labels` 是「要不要 key / 免不免费」的唯一来源、
 * 下载量/星数/安装数分三个字段（面板按 `downloads` 排序）。
 *
 * @param {object} raw - data.skills[] 的一项。
 * @param {string} [locale] - 想要的文案语言；省略或非 'en' 时行为与改前一致。
 */
export function normalizeHubSkill(raw, locale) {
  const item = raw ?? {}
  const slug = String(item.slug ?? '')
  const labels = item.labels ?? {}
  return {
    source: 'skillhub',
    slug,
    name: String(item.name ?? item.displayName ?? slug),
    summary: pickLocalized(item, 'description', locale),
    category: String(item.category ?? ''),
    subCategories: (Array.isArray(item.subCategories) ? item.subCategories : []).map((sub) => String(sub?.name ?? sub?.key ?? '')).filter(Boolean),
    // 上游用字符串 "true"/"false" 表达（不是布尔）——直接当布尔用会把 "false" 判成真。
    requiresApiKey: String(labels.requires_api_key ?? '') === 'true',
    pricing: String(labels.pricing_type ?? ''),
    downloads: Number(item.downloads) || 0,
    stars: Number(item.stars) || 0,
    installs: Number(item.installs) || 0,
    owner: String(item.ownerName ?? ''),
    verified: item.verified === true,
    upstreamSource: String(item.source ?? ''),
    version: String(item.version ?? ''),
    iconUrl: String(item.iconUrl ?? ''),
    pageUrl: PAGE_BASE + slug,
  }
}

/**
 * 搜索 / 列表。
 * @param {object} input - { keyword?, category?, sortBy?, page?, pageSize? }
 * @returns {Promise<{ total: number, skills: object[] }>}
 */
export async function searchHubSkills(input = {}, options = {}) {
  const params = new URLSearchParams()
  if (input.keyword) params.set('keyword', String(input.keyword))
  if (input.category) params.set('category', String(input.category))
  if (input.source) params.set('source', String(input.source))
  // 有关键词时上游才启用智能打分；纯浏览时按热度更适合「市场首屏」。
  params.set('sortBy', String(input.sortBy ?? (input.keyword ? 'score' : 'downloads')))
  params.set('page', String(Math.max(1, Number(input.page) || 1)))
  params.set('pageSize', String(Math.min(100, Math.max(1, Number(input.pageSize) || 24))))
  const body = await hubJson(options.fetch, hubBase(options) + '/api/skills?' + params.toString(), options)
  const data = body?.data ?? {}
  return {
    total: Number(data.total) || 0,
    skills: (Array.isArray(data.skills) ? data.skills : []).map((raw) => normalizeHubSkill(raw, options.locale)),
  }
}

/**
 * 分类 key → 当前语言的标签。面板要显示「办公效率」而不是 `office-efficiency`。
 *
 * 真实响应形状（2026-10-14 对 api.skillhub.cn 实测）：`{count, items: [...]}`，
 * 每个分类**中英各一份**——`name`（中文）与 `nameEn`（英文），按语言挑，
 * 与 {@link pickLocalized} 同一把尺：默认中文优先，显式英文才取 nameEn，缺一侧回落另一侧。
 *
 * ⚠️ 曾经这里读的是 `body.data`：形状从没对上过（真实形状是顶层 `items`），
 * 分类标签**整个拿不到**——面板的市場只剩「全部」一个按钮；而且只读 `name`
 * 不读 `nameEn`，与 description/description_zh 是同一类错：上游给了两份，
 * 我们的映射只拿一份。形状不符时**抛错而不静默返回 {}**：一个没有分类的市場
 * 比一句报错难排查得多。
 *
 * @param {object} [options] - { locale?, fetch?, ... }；locale 以 'en' 开头才取 nameEn。
 * @returns {Promise<Record<string, string>>} 分类 key → 当前语言标签。
 */
export async function hubCategories(options = {}) {
  const body = await hubJson(options.fetch, hubBase(options) + '/api/v1/categories', options)
  const list = Array.isArray(body?.items) ? body.items : null
  if (list === null) {
    throw new Error('skillhub.cn 分类响应形状不符（缺 items 数组）：' + JSON.stringify(body).slice(0, 120))
  }
  const english = String(options.locale ?? '').toLowerCase().startsWith('en')
  const labels = {}
  for (const item of list) {
    const key = String(item?.key ?? item?.category ?? '')
    if (key === '') continue
    const zh = String(item?.name ?? item?.label ?? '')
    const en = String(item?.nameEn ?? item?.name_en ?? '')
    labels[key] = english ? (en || zh || key) : (zh || en || key)
  }
  return labels
}

/**
 * 详情：面板在「装之前」要展示的信任信息全在这里。
 *
 * 上游把这些放在三个不同的地方（`publisher` / `securityReports` / `skill.stats`），
 * 面板只认下面这一层——映射写在一处，UI 就不必知道上游的形状。
 */
export async function hubSkillDetail(slug, options = {}) {
  const body = await hubJson(options.fetch, hubBase(options) + '/api/v1/skills/' + encodeURIComponent(String(slug)), options)
  const skill = body?.skill ?? {}
  const publisher = body?.publisher ?? {}
  const reports = body?.securityReports ?? {}
  const report = (node) => (node === undefined || node === null ? null : {
    status: String(node.status ?? ''),
    statusText: String(node.statusText ?? ''),
    reportUrl: String(node.reportUrl ?? ''),
  })
  return {
    slug: String(body?.slug ?? slug),
    version: String(body?.latestVersion?.version ?? skill?.tags?.latest ?? ''),
    stats: {
      downloads: Number(skill?.stats?.downloads) || 0,
      stars: Number(skill?.stats?.stars) || 0,
      installs: Number(skill?.stats?.installs) || 0,
    },
    summary: pickLocalized(skill, 'summary', options.locale),
    publisher: {
      name: String(publisher.name ?? ''),
      verified: publisher.verified === true,
      // 认证主体（如「腾讯科技（深圳）有限公司」）：这才是「谁背的书」。
      certifiedName: String(publisher.certifiedName ?? ''),
    },
    // 安全扫描：上游同时给 keen 与 sanbu 两份，都带上——面板各显示一行结论 + 报告链接。
    security: { keen: report(reports.keen), sanbu: report(reports.sanbu) },
    pageUrl: PAGE_BASE + String(body?.slug ?? slug),
  }
}

/**
 * 下载技能包到本地文件，返回落盘路径。
 *
 * 只下载**不安装**：安装交给现有的 importSkill（它负责解压、挑技能根、防重名，
 * 并按实际字节再判一次大小上限）。这样外部源与「从本机目录导入」走的是**同一条**写入路径，
 * 落点也就能沿用面板那套「安装到」（全局/项目 × .dsh/.agents）。
 *
 * @param {string} slug
 * @param {object} options - { version?, dir, fetch?, signal?, timeoutMs? }
 * @returns {Promise<{ path: string, bytes: number }>}
 */
export async function downloadHubArchive(slug, options = {}) {
  const dir = options.dir
  if (typeof dir !== 'string' || dir === '') throw new Error('缺少下载目录')
  const params = new URLSearchParams({ slug: String(slug) })
  if (options.version) params.set('version', String(options.version))
  const response = await hubFetch(options.fetch, hubBase(options) + '/api/v1/download?' + params.toString(), options)

  const declared = Number(response.headers?.get?.('content-length'))
  if (Number.isFinite(declared) && declared > MAX_ARCHIVE_BYTES) {
    throw new Error('技能包过大（' + declared + ' 字节），已拒绝下载')
  }
  const version = String(options.version || '').replace(/[^0-9A-Za-z._-]/g, '') || 'latest'
  const target = join(dir, String(slug).replace(/[^0-9A-Za-z._-]/g, '_') + '-' + version + '.zip')
  let bytes = 0
  const source = Readable.fromWeb(response.body)
  source.on('data', (chunk) => {
    bytes += chunk.length
    // 声明值可以撒谎（或缺失），所以边下边数，超限立刻掐断。
    if (bytes > MAX_ARCHIVE_BYTES) source.destroy(new Error('技能包超过大小上限'))
  })
  await pipeline(source, createWriteStream(target))
  return { path: target, bytes }
}
