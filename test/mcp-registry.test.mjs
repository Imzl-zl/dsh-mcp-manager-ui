import assert from 'node:assert/strict'
import test from 'node:test'
import { toolInventory } from '../lib/mcp-registry.js'

const MCP_PLUGIN_NAME = '@deepseek-ai/dsh-mcp-client'

// toolInventory 只看两个宿主服务：loader 的条目清单与 tools 的 schema 清单。
function fixtureCtx(serverNames, schemas) {
  return {
    loader: {
      entries: () => serverNames.map((serverName, index) => ({
        options: { id: `entry-${index}`, name: MCP_PLUGIN_NAME, config: { serverName } },
      })),
    },
    tools: { schemas: () => schemas },
  }
}

test('tool counts and revisions keep a prototype-shaped serverName as an ordinary key', () => {
  // serverName 由用户配置，`SERVER_NAME_PATTERN` 允许这个形状；工具名约定是
  // `mcp__<serverName>__<tool>`。`counts["__proto__"] = 0` 在普通赋值下会被静默丢弃，
  // 读回来是 Object.prototype——面板就会把这条永远报成"未连接"。
  const ctx = fixtureCtx(['__proto__', 'alpha'], [{ name: 'mcp____proto____probe' }, { name: 'mcp__alpha__probe' }])
  const inventory = toolInventory(ctx)

  assert.equal(Object.hasOwn(inventory.counts, '__proto__'), true, 'counts 必须真的含这条 own property')
  assert.equal(inventory.counts['__proto__'], 1)
  assert.equal(typeof inventory.revisions['__proto__'], 'string')
  assert.equal(Object.hasOwn(inventory.revisions, '__proto__'), true)
  assert.equal(inventory.counts.alpha, 1, '其他条目的计数不受影响')
})

test('tool counts and revisions report every registered server, including one with no tools', () => {
  const ctx = fixtureCtx(['alpha', 'beta'], [{ name: 'mcp__alpha__one' }, { name: 'mcp__alpha__two' }])
  const inventory = toolInventory(ctx)

  assert.equal(inventory.counts.alpha, 2)
  assert.equal(inventory.counts.beta, 0, '没有工具的服务器仍要有一条 0 计数')
  assert.equal(typeof inventory.revisions.alpha, 'string')
  assert.equal(typeof inventory.revisions.beta, 'string', 'revision 也必须存在，否则列表会漏掉这条')
})
