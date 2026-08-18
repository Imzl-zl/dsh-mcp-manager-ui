
/**
 * 单一连接判定：MCP 是否“已连接”只由工具注册结果决定。
 * fiber 处于 ACTIVE 只能说明 mcp-client 插件在跑，不能说明握手成功
 * （failOnStartupError=false 时 ECONNREFUSED 也会让 fiber 保持 ACTIVE）。
 *
 * @param row - summarize() 产出的行（phase 已归一化为语义名）。
 * @param lastLog - 该 server 最近一条 mcp-client 日志（可为 null）。
 * @returns 'connected' | 'failed' | 'waiting' | 'loading' | 'stopped' | 'disabled'
 */
export function deriveMcpPhase(row, lastLog) {
  if (!row.enabled) return 'disabled'
  if (row.toolCount > 0) return 'connected'
  if (row.toolCountAmbiguous) return 'unknown'
  if (row.phase === 'failed') return 'failed'
  if (row.phase === 'loading' || row.phase === 'waiting') return 'loading'
  if (row.phase !== 'connected') return 'stopped'
  // mcp-client 的 apply() 会等待首次连接和 tools/list 结束后才让 fiber ACTIVE。
  // 因此 ACTIVE 且 0 工具已经是“不可用”的终态证据，不应继续显示连接中。
  return 'failed'
}

/**
 * 把 logger Message 格式化为可展示文本。
 * 复用 Cordis Logger.format 的语义：首个参数为 Error 时输出 stack，
 * 否则按 % 占位符拼接。这里做简化实现（不引用 reggol），保持零依赖。
 */
export function formatMcpLog(message) {
  const args = message.args || []
  if (args.length && args[0] instanceof Error) {
    return args[0].stack || args[0].message
  }
  if (typeof args[0] === 'string') {
    return args.join(' ')
  }
  return args.map((value) => (value && typeof value === 'object' ? JSON.stringify(value) : String(value))).join(' ')
}
