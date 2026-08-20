import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveMcpPhase, formatMcpLog, sanitizeMcpLog } from '../lib/mcp-observability.js'

test('does not report connected when the fiber is active but tool discovery failed', () => {
  const phase = deriveMcpPhase({ phase: 'connected', enabled: true, toolCount: 0 }, {
    type: 'warn',
    text: 'mcp-client(mt-apk-bridge): connection attempt failed: ECONNREFUSED 127.0.0.1:8787',
  })
  assert.equal(phase, 'failed')
})

test('reports connected only after tools are registered', () => {
  assert.equal(deriveMcpPhase({ phase: 'connected', enabled: true, toolCount: 2 }, null), 'connected')
})

test('reports failed when an active MCP has no registered tools', () => {
  assert.equal(deriveMcpPhase({ phase: 'connected', enabled: true, toolCount: 0 }, null), 'failed')
})

test('ambiguous tool ownership reports unknown instead of success or failure', () => {
  assert.equal(deriveMcpPhase({ phase: 'connected', enabled: true, toolCount: 0, toolCountAmbiguous: true }, null), 'unknown')
})

test('disabled always reports disabled regardless of fiber or tools', () => {
  assert.equal(deriveMcpPhase({ phase: 'connected', enabled: false, toolCount: 3 }, null), 'disabled')
})

test('fiber failure without tools reports failed', () => {
  assert.equal(deriveMcpPhase({ phase: 'failed', enabled: true, toolCount: 0 }, null), 'failed')
})

test('non-connected fiber without tools reports stopped or loading', () => {
  assert.equal(deriveMcpPhase({ phase: 'stopped', enabled: true, toolCount: 0 }, null), 'stopped')
  assert.equal(deriveMcpPhase({ phase: 'loading', enabled: true, toolCount: 0 }, null), 'loading')
  assert.equal(deriveMcpPhase({ phase: 'waiting', enabled: true, toolCount: 0 }, null), 'loading')
})

test('formats logger messages without losing Error details', () => {
  assert.match(formatMcpLog({ name: 'mcp-client(mt-apk-bridge)', type: 'error', args: ['failed', new Error('ECONNREFUSED')] }), /failed Error: ECONNREFUSED/)
})

test('sanitizes credentials from MCP log text before Remote projection', () => {
  const secret = 'super-secret-token'
  const result = sanitizeMcpLog(`request failed https://example.test/mcp?token=${secret} Authorization: Bearer ${secret} --api-key ${secret} EXA_API_KEY=${secret}`)
  assert.doesNotMatch(result, new RegExp(secret))
  assert.match(result, /request failed/)
  assert.match(result, /__DSH_MCP_REDACTED__/)
})

test('sanitizes quoted JSON-shaped credentials from object logs', () => {
  const secret = 'json-super-secret'
  const objectLog = formatMcpLog({ args: [{ message: 'connection failed', API_KEY: secret, Authorization: `Bearer ${secret}`, args: ['--config', secret], headers: { 'X-Custom': secret } }] })
  const jsonLog = JSON.stringify({ API_KEY: secret, Authorization: `Bearer ${secret}`, args: ['--config', secret], env: { CUSTOM: secret } })
  for (const result of [sanitizeMcpLog(objectLog), sanitizeMcpLog(jsonLog)]) {
    assert.doesNotMatch(result, new RegExp(secret))
    assert.match(result, /__DSH_MCP_REDACTED__/)
  }
})

test('sanitizes quoted credentials with spaces before unquoted patterns run', () => {
  const secret = 'sk-live-secret'
  for (const input of [
    `connection failed authorization: 'Bearer ${secret}'`,
    `connection failed apiKey: "part one ${secret}"`,
    `connection failed --api-key '${secret} with-space'`,
    `failed {"args":["--config","value]${secret}"],"code":"EFAIL"}`,
  ]) {
    const result = sanitizeMcpLog(input)
    assert.doesNotMatch(result, new RegExp(secret))
    assert.match(result, /__DSH_MCP_REDACTED__/)
  }
})
