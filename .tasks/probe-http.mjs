// 探针：对目录里的 HTTP 型条目跑一次真实 MCP 握手（initialize），回答「现在还连得上吗」。
//
// 用法：
//
//   node .tasks/probe-http.mjs
//
// 目标与 headers 一律从 `lib/mcp-catalog.js` **派生**，不在这里手写。这张表曾经是手工的，
// 很快就漂移了：实测 29 个目标里 11 个目录已删、3 条从没探过、atlassian 还停在 v1/sse
// （目录早已是 v2/mcp）。手工清单和目录就是两份真相源，迟早对不上。
//
// 代理：Node 的 `fetch` 默认**不读**系统代理。`HTTP(S)_PROXY` 只有在进程启动前就设好
// `NODE_USE_ENV_PROXY=1`（或加了 `--use-env-proxy`）时才生效——**脚本内再赋值已经晚了**，
// Node 只在启动时读它（实测：脚本内设置仍 `UND_ERR_CONNECT_TIMEOUT`）。不处理的话，本机
// 所有走不通外网的条目会被一律报成 `fetch failed`，那是**假警报**：会把好条目误判成已失效，
// 比不探还糟。所以这里自己兜住——发现系统代理就带着该变量重启自己，并把这件事打印出来。
//
// 判据是「拿没拿到 serverInfo」，不是 HTTP 状态码：401 说明端点活着、只是要凭据（目录里
// 那些 OAuth 型的正常结果），status=0 才是真连不上，需要人来判。
import { spawnSync } from 'node:child_process'
import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { MCP_CATALOG } from '../lib/mcp-catalog.js'
import { evaluateExpression } from '../lib/env-expression.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_FILE = join(HERE, 'http-probe-dump.json')
const TIMEOUT_MS = 20000
const ATTEMPTS = 3

/** 重启自己的标记。没有它，「没有代理」的机器会无限重启。 */
const REEXEC_GUARD = 'DSH_MCP_PROBE_PROXIED'
const PROXY_ENV_KEYS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']

/** 读 Windows 系统代理（`Internet Settings` 里的 ProxyServer）。非 Windows 或读不到返回 null。 */
function windowsSystemProxy() {
  if (process.platform !== 'win32') return null
  const out = join(tmpdir(), `dsh-probe-reg-${process.pid}.txt`)
  let fd
  try {
    // 为什么绕道文件而不是管道：沙箱下用管道捕获子进程输出会被拒（EPERM），
    // 而重定向到文件在普通 shell 里同样可用——一种写法两边都能跑。
    fd = openSync(out, 'w')
    const result = spawnSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', 'ProxyServer'], {
      stdio: ['ignore', fd, 'ignore'],
      windowsHide: true,
    })
    closeSync(fd)
    fd = undefined
    if (result.status !== 0) return null
    const match = /ProxyServer\s+REG_SZ\s+(\S+)/.exec(readFileSync(out, 'utf8'))
    if (!match) return null
    const value = match[1]
    // 注册表里可能是不带协议的 `127.0.0.1:7890`；fetch 的代理设置需要完整 URL。
    return /^https?:\/\//.test(value) ? value : `http://${value}`
  } catch {
    // 读不到就直连——真连不上时下面会把 status=0 明确列出来，并给出设置代理的提示。
    return null
  } finally {
    if (fd !== undefined) closeSync(fd)
    try { unlinkSync(out) } catch { /* 临时文件本就可能没建出来 */ }
  }
}

/**
 * 确保 `fetch` 会走代理：必要时带 `NODE_USE_ENV_PROXY=1` 重启自己。
 * 顶层直接执行（不是函数调用），因为重启必须发生在任何网络请求之前。
 */
function ensureProxy() {
  if (process.env[REEXEC_GUARD]) return
  const fromEnv = PROXY_ENV_KEYS.map((key) => process.env[key]).find(Boolean)
  const proxy = fromEnv || windowsSystemProxy()
  // 没有可用代理就直连——真连不上时下面会把 status=0 明确列出来。
  if (!proxy) return
  // 两样都要齐：代理地址在环境里，且开关已开。只开开关（全局设了 NODE_USE_ENV_PROXY
  // 却没设 HTTPS_PROXY）等于没配代理，`fetch` 照样直连——实测那会静默产生 5 条假失败。
  const proxyActive = process.env.NODE_USE_ENV_PROXY === '1' || process.execArgv.includes('--use-env-proxy')
  if (proxyActive && fromEnv) return
  console.log(`[代理] 检测到 ${proxy}，带 NODE_USE_ENV_PROXY=1 重启探针（fetch 默认不读系统代理）\n`)
  const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: {
      ...process.env,
      HTTPS_PROXY: proxy,
      HTTP_PROXY: proxy,
      NODE_USE_ENV_PROXY: '1',
      [REEXEC_GUARD]: '1',
    },
  })
  process.exit(result.status ?? 1)
}

ensureProxy()

/** 目录里的 `!!js` header 求值成真实值。复用宿主那份实现，不在这里另写一套语法。 */
function headersOf(entry) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': '2025-06-18',
  }
  for (const [name, value] of Object.entries(entry.headers || {})) headers[name] = evaluateExpression(value)
  return headers
}

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'dsh-market-probe', version: '1.0.0' },
  },
}

/** 从纯 JSON 或 SSE 分帧的响应里取 serverInfo。 */
function serverInfoOf(text) {
  for (const line of text.split(/\r?\n/)) {
    const payload = line.startsWith('data:') ? line.slice(5).trim() : line.trim()
    if (!payload.startsWith('{')) continue
    try {
      const body = JSON.parse(payload)
      if (body.result?.serverInfo) return `${body.result.serverInfo.name}@${body.result.serverInfo.version}`
    } catch { /* 非 JSON 的帧忽略 */ }
  }
  return null
}

async function probe(entry, attempt = 1) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(entry.url, {
      method: 'POST',
      signal: controller.signal,
      headers: headersOf(entry),
      body: JSON.stringify(INITIALIZE),
    })
    const text = await response.text()
    clearTimeout(timer)
    const serverInfo = serverInfoOf(text)
    return {
      id: entry.id,
      url: entry.url,
      attempt,
      status: response.status,
      ok: Boolean(serverInfo),
      serverInfo,
      wwwAuthenticate: response.headers.get('www-authenticate') || null,
    }
  } catch (error) {
    clearTimeout(timer)
    if (attempt < ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, 1200))
      return probe(entry, attempt + 1)
    }
    return {
      id: entry.id,
      url: entry.url,
      attempt,
      status: 0,
      ok: false,
      error: String(error.cause?.code || error.message || error),
    }
  }
}

/** 目录声明要凭据、而本机没设的环境变量。目录的 `!!js` 一定是总值形态，缺失时求值为空串。 */
function unsetCredentials(entry) {
  return (entry.envKeys || []).filter((name) => !process.env[name])
}

/**
 * 结论分类。`401` 与「声明了凭据但本机没设、于是 Authorization 变成空 Bearer」的 `400`
 * 是同一件事——端点活着、只差凭据，都是目录里需 OAuth/PAT 条目的**预期**结果。
 *
 * github 就是后者：目录里的 `!!js "Bearer " + (process.env.GITHUB_PERSONAL_ACCESS_TOKEN ?? "")`
 * 在没设变量时求值为 `"Bearer "`，服务器回 `400 Authorization header is badly formatted`
 * （连这个头都不发反而回 401）。这是探针忠实复现目录配置的结果，不是条目坏了，所以不能
 * 归进「需人工判读」——否则每次查一遍都会有一个固定的假警报。
 */
function classify(result, entry) {
  if (result.ok) return 'keyless'
  if (result.status === 401) return 'needs-credentials'
  if (result.status === 400 && unsetCredentials(entry).length) return 'needs-credentials'
  if (result.status === 0) return 'unreachable'
  return 'unexpected'
}

const httpEntries = MCP_CATALOG.filter((entry) => entry.transport === 'streamable-http')
console.log(`待探条目：${httpEntries.length} 条 HTTP 型（来自 lib/mcp-catalog.js）\n`)

const results = []
for (const entry of httpEntries) {
  const result = await probe(entry)
  const kind = classify(result, entry)
  const unset = unsetCredentials(entry)
  results.push({ ...result, kind, unsetCredentials: unset })
  const verdict = kind === 'keyless'
    ? `✅ 免密可用  ${result.serverInfo}`
    : kind === 'needs-credentials'
      ? `🔑 需凭据（端点活着${result.status === 400 ? '，空占位符被拒' : ''}）`
      : kind === 'unreachable'
        ? `❌ 连不上  ${result.error}`
        : `⚠️ status=${result.status}`
  console.log(`${result.id.padEnd(18)} ${verdict}`)
}

// 按结论分组收尾：需凭据是目录里 OAuth/PAT 条目的**预期**结果，不是故障；只有「连不上」
// 和未预期的状态码才需要人来看。
const keyless = results.filter((r) => r.kind === 'keyless')
const needAuth = results.filter((r) => r.kind === 'needs-credentials')
const broken = results.filter((r) => r.kind === 'unreachable' || r.kind === 'unexpected')

console.log(`\n汇总：免密可用 ${keyless.length} · 需凭据 ${needAuth.length} · 连不上或异常 ${broken.length}`)
if (broken.length) {
  console.log(`需人工判读：${broken.map((r) => `${r.id}(${r.status || r.error})`).join('、')}`)
  console.log('若这些是本机访问不到的域名，先确认代理是否生效（HTTPS_PROXY + NODE_USE_ENV_PROXY=1）。')
}

writeFileSync(OUT_FILE, `${JSON.stringify(results, null, 2)}\n`)
console.log(`\n已写入 ${OUT_FILE}`)

// 有连不上/异常的条目就以非零退出，让「查一遍」有个明确的红绿信号。
if (broken.length) process.exitCode = 1
