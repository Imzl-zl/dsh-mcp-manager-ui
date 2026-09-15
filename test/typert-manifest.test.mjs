import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { validateTypertManifest } from '@deepseek-ai/dsh-typert-loader'
import { TYPERT } from '../lib/typert.js'

// 为什么单独有这条用例：`lib/typert.js` 是**宿主 loader 的输入**，它的形状由宿主校验，不由我们
// 校验。既有用例只保证 `lib/typert.js` 与 `lib/client.js` 两份产物彼此一致
// （client-lifecycle.test.mjs），宿主改了要求（例如 master 上 strict codec 从 `schema:`
// 改成 `create()`）不会让任何用例变红——后果却是用户升级 DSH 后面板整个不可用。
// 所以这里**用宿主自己的校验器验自己的产物**：形状要求一变，这里就红。
//
// `@deepseek-ai/dsh-typert-loader` 是 dev-only 依赖，不进 peer 列表：校验发生在宿主进程里，
// 插件运行时不 import 它。
test('lib/typert.js passes the host loader own validator', () => {
  // 校验器是公开导出（不是私有字段）。它若改名或搬走，本用例会以导入期错误失败——那表示
  // “去核对宿主新的校验面”，不一定表示插件坏了。
  assert.equal(typeof validateTypertManifest, 'function')
  const packageName = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).name
  // 直接调用而不包 doesNotThrow：失败时抛出的就是宿主校验器自己的诊断
  // （例如 `invocation "..." result codec has no create() factory`）。
  validateTypertManifest(packageName, TYPERT)
})
