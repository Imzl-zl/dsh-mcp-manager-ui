/**
 * 「按名字给对象建映射」的赋值原语——全仓**唯一**一份实现。
 *
 * 为什么不能用普通赋值：`target["__proto__"] = x` 走的是 `Object.prototype` 上的 setter，
 * 值不是对象时静默丢弃、是对象时把原型换掉，两种都表现为「写的人以为写成功，结果里没有这
 * 一条」。配置里叫 `__proto__` 的 serverName / env / headers 键在 `SERVER_NAME_PATTERN`
 * 下合法，实测后果是复制报「新增 1 条（__proto__）」而目标文件里根本没有它。
 *
 * 住在这里而不是某个领域模块里，是因为它跟 MCP 语义、YAML、日志都无关，而使用者横跨这几
 * 层：挂在 `mcp-config.js` 上会让零依赖的 `mcp-observability.js` 为了一个赋值原语去依赖
 * yaml 与整张目录表——依赖方向是反的。浏览器半的 `lib/client.js` 是独立 bundle（只
 * `require('react')`，不与宿主模块共享代码），它自带一份同形状的副本。
 */
export function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

export function setOwn(target, key, value) {
  Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true })
}
