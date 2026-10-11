import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// updateHint 的产品约束：有新版才提示、24h 内缓存、失败静默、可被环境变量关闭。
// checkForUpdate(now, force) 已导出作为测试接缝：force 绕过进程内缓存，now 固定时钟。
//
// ⚠️ 数据源是**本包在 npm 上的 latest**，不是仓库的 `releases/latest`：同一个仓库里有两条产品线
// （老线那个包与 `dsh-toolbox-ui`——名字见 release.yml），而仓库只有**一个** latest 槽位，还要被
// 老线的「升级」按钮用（它读的正是那里，所以新线的 Release 必须一直是 pre-release）。新线若也读它，
// 就永远读到旧线的版本号 → 提示恒为「已是最新」：新版本发出去，用户什么也看不到。

function withFetch(stub, run) {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = async (...args) => { calls += 1; return stub(...args) }
  return Promise.resolve(run()).finally(() => {
    globalThis.fetch = original
    if (calls !== stub.expect) throw new Error(`fetch called ${calls} times, expected ${stub.expect}`)
  })
}

/** npm registry 的 `/<包名>/latest` 只有一个 version 字段（没有 release 页链接）。 */
const npmLatest = (version) => async () => ({ ok: true, json: async () => ({ name: 'dsh-toolbox-ui', version }) })

const packageName = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).name

test('updateHint RPC reports a newer version and points at that release page', async () => {
  const { McpManagerGateway } = await import('../lib/index.js')
  await withFetch(Object.assign(npmLatest('9.9.9'), { expect: 1 }), async () => {
    const result = await McpManagerGateway.prototype.updateHint.call({ ctx: {} })
    assert.equal(result.updateAvailable, true)
    assert.equal(result.latest, '9.9.9')
    // npm 不给我们页面链接，但**提示条要指得出「更新了什么」**——两条线的 tag 都是 vX.Y.Z，
    // 所以由版本号拼本仓库的 release 页（老线的 updateHint 也是这么做的）。
    assert.equal(result.url, 'https://github.com/Imzl-zl/dsh-toolbox-ui/releases/tag/v9.9.9')
  })
})

test('the update check asks npm for this very package, not the repo-wide release feed', async () => {
  // 这条守的是一个**真实错过的判断**：release.yml 的注释曾断言「本线自己的更新提示问的是自己包
  // 在 npm 上的 latest」，而代码问的是仓库的 `releases/latest`。仓库只有一个 latest 槽位，且
  // 被老线用 pre-release 钉在旧线版本上（见该 workflow 的说明），于是新线的提示**永远是哑的**。
  // 包名必须从 package.json 派生：写死任何一个都会在另一条线上静默错。
  const { checkForUpdate } = await import('../lib/index.js')
  const requested = []
  const original = globalThis.fetch
  globalThis.fetch = async (url) => { requested.push(String(url)); return { ok: true, json: async () => ({ version: '9.9.9' }) } }
  try {
    await checkForUpdate(Date.now(), true)
  } finally {
    globalThis.fetch = original
  }
  assert.deepEqual(requested, [`https://registry.npmjs.org/${packageName}/latest`],
    '必须问自己包在 npm 上的 latest：问仓库 feed 会被 pre-release 规则永远挡在旧线版本上')
})

test('checkForUpdate caches within the interval and refetches past it', async () => {
  const { checkForUpdate } = await import('../lib/index.js')
  const now = 1_000_000_000_000
  await withFetch(Object.assign(npmLatest('9.9.9'), { expect: 2 }), async () => {
    const first = await checkForUpdate(now, true)
    assert.equal(first.updateAvailable, true)
    const cached = await checkForUpdate(now + 1000)
    assert.equal(cached.latest, '9.9.9')
    const expired = await checkForUpdate(now + 24 * 60 * 60 * 1000 + 1)
    assert.equal(expired.updateAvailable, true)
  })
})

test('checkForUpdate treats an older release as up to date', async () => {
  const { checkForUpdate } = await import('../lib/index.js')
  await withFetch(Object.assign(npmLatest('0.0.1'), { expect: 1 }), async () => {
    const result = await checkForUpdate(Date.now(), true)
    assert.equal(result.updateAvailable, false)
    assert.equal(result.latest, '0.0.1')
  })
})

test('checkForUpdate never throws when the endpoint is unreachable', async () => {
  const { checkForUpdate } = await import('../lib/index.js')
  await withFetch(Object.assign(async () => { throw new Error('ECONNREFUSED') }, { expect: 1 }), async () => {
    const result = await checkForUpdate(Date.now(), true)
    assert.equal(result.updateAvailable, false)
    assert.equal(result.latest, null)
  })
})

test('checkForUpdate respects DSH_MCP_MANAGER_DISABLE_UPDATE_CHECK without any request', async () => {
  const { checkForUpdate } = await import('../lib/index.js')
  process.env.DSH_MCP_MANAGER_DISABLE_UPDATE_CHECK = '1'
  await withFetch(Object.assign(npmLatest('9.9.9'), { expect: 0 }), async () => {
    const result = await checkForUpdate(Date.now(), true)
    assert.equal(result.disabled, true)
    assert.equal(result.updateAvailable, false)
  })
})
