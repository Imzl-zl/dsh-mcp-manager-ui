// 市场远端搜索（skills.sh）—— 本插件**唯一**的对外网络依赖之一（另一个是 checkForUpdate）。
//
// 三条纪律，全部来自 SPEC 与实测：
//
// 1. **静默降级**（约束 11）：市场首屏必须离线可用（内置目录），远端搜索只是「补充」。
//    所以这里任何失败——网络断、超时、5xx、JSON 坏——都返回一个带 `degraded` 说明的
//    空结果，**绝不抛错**。抛错会让整个市场页打不开，代价远大于「搜不到远端」。
//
// 2. **白名单硬过滤**（约束 9）：skills.sh 的 `source` 字段**不可信**。实测 q=superpowers
//    返回 9 个不同 source 的同名技能（obra/superpowers 与 101-skills/superpowers、
//    qu-skills/superpowers、magentosh/superpowers 等）——仿冒同名混进市场会直接害到用户。
//    另外实测出现过非 owner/repo 形态的值（`open.feishu.cn` 裸主机名），它无法对应到可抓取的
//    仓库路径。所以「在白名单里」与「形态合法」是**两道独立的闸**，都要过。
//
// 3. **不把远端数据当可信输入**：它最终会被拼进安装路径、写进用户的技能目录。
//
// 已实测的 API 契约（2026-10-08，真实请求）：
//   GET https://skills.sh/api/search?q=<≥2 字符>&limit=1..200
//   → 200 {"query","searchType","searchVersion","skills":[{"id","source","skillId","name","installs"}],"count",…}
//   · limit=0 夹到 1；limit=500 夹到 200；不传 limit 得 100。上限 **200**。
//   · q 少于 2 字符 → **400** {"error":"Query must be at least 2 characters"}。
//     搜索框是随打随搜的，1 个字符就发请求等于每次输入都白挨一个 400，还会污染缓存——
//     所以这个判断放在**发请求之前**。

/** 搜索端点。免鉴权。 */
export const SKILLS_SH_API = 'https://skills.sh/api/search'

/** 实测下界：少于 2 字符服务端直接 400。 */
export const MIN_QUERY_LENGTH = 2

/** 不传 limit 时服务端的默认值（实测 100）。 */
export const DEFAULT_LIMIT = 100

/** 实测上界：传 500 也只返回 200 条。 */
export const MAX_LIMIT = 200

const TIMEOUT_MS = 8000

/**
 * 缓存：同一个查询短时间内不重复打网络。
 * 搜索框是随打随搜的，用户改一个字就会触发一次；没有缓存时一次输入能打出十几个请求。
 */
let cache = new Map()
const CACHE_TTL_MS = 5 * 60 * 1000

/** 清空缓存（测试接缝；运行时也可用于「强制重搜」）。 */
export function resetSkillsSearchCache() {
  cache = new Map()
}

/**
 * 该 source 是否是合法的 `owner/repo` 形态。
 *
 * 刻意不接受多级路径（`a/b/c`）：skills.sh 的 `id` 是三级（owner/repo/skill），
 * 而 `source` 是两级。两者混淆会让下游把 id 当 source 去拼路径。
 *
 * ⚠️ **光看「两段」不够**：`smithery.ai/x` 也恰好两段，但它不是 GitHub 仓库
 * （SPEC 约束 9 点名过 `smithery.ai/…` 这类非 GitHub 值）。所以 owner 段必须是
 * **GitHub 的命名法**（不含点），把带点的域名形态挡在外面——`open.feishu.cn`
 * （实测出现过）也因为段数/点号被拒。
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isGithubSource(value) {
  if (typeof value !== 'string') return false
  const parts = value.split('/')
  if (parts.length !== 2) return false
  // owner 段：GitHub 用户名/组织名只允许字母数字与连字符（不允许点）。
  // 这一条同时挡住 `smithery.ai/x`、`open.feishu.cn/x` 这类域名形态。
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(parts[0])) return false
  // repo 段：GitHub 仓库名允许点与下划线（如 my_repo.v2），但不含空白与其它符号。
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(parts[1])
}

/** 归一化查询串，使大小写与首尾空白不分裂缓存。 */
function normalizeQuery(query) {
  return String(query ?? '').trim().toLowerCase()
}

/** 把一条远端结果投影成市场卡片可用的形状。 */
function toRemoteEntry(row) {
  const installs = Number.isFinite(row?.installs) ? row.installs : 0
  return {
    // 远端条目没有内置目录的 id 约定，用 source + skillId 组一个稳定值（卡片 key 用）。
    id: `remote:${row.source}/${row.skillId || row.name}`,
    name: String(row.name || row.skillId || ''),
    source: String(row.source),
    summary: '',
    license: '',
    // ⚠️ 远端搜索**不做**许可核实（那是内置目录的职责，逐技能人工核过才有结论）。
    // 所以这里明确不可安装：UI 据此提示用户自行核实，而不是让一条没核过的技能
    // 看起来像内置目录里那些已核实的条目。
    installable: false,
    licenseReason: '该条目来自 skills.sh 搜索，未做许可核实，请先确认来源与许可',
    scripts: false,
    installs,
    remote: true,
  }
}

/**
 * 在 skills.sh 上搜索技能。
 *
 * **永不抛错**：任何失败都退化成 `{ skills: [], degraded }`。
 *
 * @param {{ query: string, limit?: number, allowlist?: Set<string>, fetchImpl?: Function,
 *   timeoutMs?: number, now?: number }} input
 * @returns {Promise<{ skills: object[], degraded?: string, filtered?: number, cached?: boolean,
 *   skipped?: string }>}
 */
export async function searchRemoteSkills(input = {}) {
  const {
    query,
    limit = DEFAULT_LIMIT,
    allowlist = new Set(),
    fetchImpl = globalThis.fetch,
    timeoutMs = TIMEOUT_MS,
    now = Date.now(),
  } = input

  const normalized = normalizeQuery(query)
  // 实测会 400，所以不足长度时**根本不发请求**。
  if (normalized.length < MIN_QUERY_LENGTH) {
    return { skills: [], skipped: 'query-too-short' }
  }

  const clamped = Math.max(1, Math.min(MAX_LIMIT, Number.isFinite(limit) ? Math.trunc(limit) : DEFAULT_LIMIT))
  const cacheKey = `${normalized}::${clamped}::${[...allowlist].sort().join(',')}`
  const hit = cache.get(cacheKey)
  if (hit !== undefined && now - hit.at < CACHE_TTL_MS) {
    return { ...hit.value, cached: true }
  }

  const url = `${SKILLS_SH_API}?q=${encodeURIComponent(normalized)}&limit=${clamped}`
  let body
  try {
    const response = await fetchImpl(url, {
      // 只声明接受的类型；不带任何凭据（免鉴权接口，带凭据既无必要也会泄露用户身份）。
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response?.ok) {
      return cacheAndReturn(cacheKey, now, { skills: [], degraded: `搜索服务不可用（HTTP ${response?.status ?? '?'}）` })
    }
    body = await response.json()
  } catch (error) {
    // 网络断 / 超时 / JSON 坏，全部走这里：静默降级，市场仍用内置目录。
    return cacheAndReturn(cacheKey, now, {
      skills: [],
      degraded: `搜索服务未响应（${error?.name || 'Error'}），仅显示内置目录`,
    })
  }

  const rows = Array.isArray(body?.skills) ? body.skills : []
  const kept = []
  let filtered = 0
  for (const row of rows) {
    const source = row?.source
    // 两道独立的闸：形态合法 + 在白名单里。任一不过都丢弃。
    if (!isGithubSource(source) || !allowlist.has(source)) {
      filtered += 1
      continue
    }
    const entry = toRemoteEntry(row)
    if (entry.name === '') {
      filtered += 1
      continue
    }
    kept.push(entry)
  }
  return cacheAndReturn(cacheKey, now, { skills: kept, filtered })
}

/** 写缓存并返回（缓存只存成功/降级的结果，不存异常）。 */
function cacheAndReturn(cacheKey, now, value) {
  cache.set(cacheKey, { at: now, value })
  return value
}
