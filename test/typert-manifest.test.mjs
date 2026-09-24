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

// 为什么还要额外钉一条：本地 devDependency 的 loader 是**开发基线**，而它只校验两个渠道里
// 的**一个**键，看不见另一个——上面那条用例因此在基线 loader 上永远盖不住缺口：
//   · 基线 ≤ 0.1.5-rc.x：只校验 `schema`，看不见 `create()`（2026-09-21 就是这样红的）
//   · 基线 ≥ 0.1.6-alpha.2（含现在的 0.1.7-rc.1）：只校验 `create()`，看不见 `schema`——
//     而 `schema` 正是 0.1.5-rc.x 那条线（= 现在 `latest`、npx 默认装到的、大多数用户
//     实际在跑的）要的。所以 bump 基线反而把「缺 `schema`」换成了本地测不出的那一半。
// 这里把「strict codec 同时带 schema 与 create()」这条双渠道契约直接钉住：不依赖装了哪个
// 版本的 loader，也不等 CI。取舍理由见 docs/design.md「版本范围怎么定」。
test('every strict codec carries both the schema value and the create() factory', () => {
  const codecs = []
  for (const invocation of TYPERT.invocations) {
    if (invocation.invocation.codec !== undefined) codecs.push([invocation.id + ' receiver', invocation.invocation.codec])
    for (const parameter of invocation.parameters) codecs.push([invocation.id + ' parameter ' + parameter.wire, parameter.codec])
    codecs.push([invocation.id + ' result', invocation.result])
  }
  assert.ok(codecs.length > 0)
  for (const [subject, codec] of codecs) {
    assert.equal(codec.mode, 'strict', subject + ' 必须是 strict codec')
    // 0.1.5-rc.x 的 loader/registry 走这条（= 现在 `latest` 渠道，大多数用户实际在跑的）。
    assert.equal(typeof codec.schema?.parse, 'function', subject + ' 缺少 schema（0.1.5-rc.x 那条线会加载即拒）')
    // 0.1.6-alpha.2 起的 loader/registry 走这条（含当前基线 0.1.7-rc.1 与 `next`）。
    assert.equal(typeof codec.create, 'function', subject + ' 缺少 create() 工厂（0.1.6-alpha.2 起会加载即拒）')
    assert.equal(typeof codec.create().parse, 'function', subject + ' 的 create() 没有返回可用的 schema')
  }
})
