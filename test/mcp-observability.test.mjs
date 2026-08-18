import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveMcpPhase, formatMcpLog } from '../lib/mcp-observability.js'

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
