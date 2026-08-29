import assert from 'node:assert/strict'
import test from 'node:test'

// updateHint 的产品约束：有新版才提示、24h 内缓存、失败静默、可被环境变量关闭。
// checkForUpdate(now, force) 已导出作为测试接缝：force 绕过进程内缓存，now 固定时钟。

function withFetch(stub, run) {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = async (...args) => { calls += 1; return stub(...args) }
  return Promise.resolve(run()).finally(() => {
    globalThis.fetch = original
    if (calls !== stub.expect) throw new Error(`fetch called ${calls} times, expected ${stub.expect}`)
  })
}

const release = (tag) => async () => ({ ok: true, json: async () => ({ tag_name: tag, html_url: `https://example.com/releases/${tag}` }) })

test('updateHint RPC reports a newer release', async () => {
  const { McpManagerGateway } = await import('../lib/index.js')
  await withFetch(Object.assign(release('v9.9.9'), { expect: 1 }), async () => {
    const result = await McpManagerGateway.prototype.updateHint.call({ ctx: {} })
    assert.equal(result.updateAvailable, true)
    assert.equal(result.latest, '9.9.9')
    assert.equal(result.url, 'https://example.com/releases/v9.9.9')
  })
})

test('checkForUpdate caches within the interval and refetches past it', async () => {
  const { checkForUpdate } = await import('../lib/index.js')
  const now = 1_000_000_000_000
  await withFetch(Object.assign(release('v9.9.9'), { expect: 2 }), async () => {
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
  await withFetch(Object.assign(release('v0.0.1'), { expect: 1 }), async () => {
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
  await withFetch(Object.assign(release('v9.9.9'), { expect: 0 }), async () => {
    const result = await checkForUpdate(Date.now(), true)
    assert.equal(result.disabled, true)
    assert.equal(result.updateAvailable, false)
  })
})
