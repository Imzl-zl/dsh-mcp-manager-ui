// 原型样式对 DSH 主题契约的自检。
//
// 为什么需要它：unified-design.html 是一份**独立可打开**的原型，所以它必须自带
// 令牌镜像（:root / body / body[data-ds-dark-theme] 里的 --dsw-* 字面值）。
// 但落地到 lib/client.js 时，那份镜像是宿主提供的，会被整块丢掉——真正要过
// test/theme-contract.test.mjs 的是**镜像之外**的规则区。
//
// 这个脚本就模拟那一步：剥掉令牌镜像，把剩下的规则喂给仓库自己的扫描器
// （scripts/theme-spec.mjs，与主题测试同一份实现），所以结论是权威判据给的，
// 而不是这里重新实现的一套规则。
//
//   node .tasks/toolbox-ui/prototype/check-prototype.mjs
import { readFileSync } from 'node:fs'
import {
  unpairedFullRound,
  unscaledRadii,
  neutralBordersBesideElevation,
  literalColors,
  literalMonoStacks,
  aliasContract,
  aliasHost,
} from '../../../scripts/theme-spec.mjs'

const html = readFileSync(new URL('./unified-design.html', import.meta.url), 'utf8')
const style = html.match(/<style>([\s\S]*?)<\/style>/)
if (!style) throw new Error('unified-design.html 里找不到 <style> 块')

/** 逐块重建样式表，丢掉令牌镜像。
 *
 * 这些块的 body 里没有嵌套花括号，所以 `[^{}]*` 逐块切分是安全的；
 * @media / @keyframes 的外壳会在此过程中被摊平，但那六个扫描器只看
 * 选择器与声明，不看 at 上下文。 */
function stripTokenMirror(css) {
  const kept = []
  const dropped = []
  for (const match of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const selector = match[1].trim().replace(/^[\s\S]*[;}]/, '').trim()
    const body = match[2]
    const sel = selector.split('\n').pop().trim()
    // 判据必须带冒号：镜像块是**声明** `--dsw-alias-bg-base: #fff`，
    // 而基础 body 规则只是**引用** `var(--dsw-alias-bg-base)`。用 includes 不带
    // 冒号会把后者一起剥掉——那正好是「绿而无效」的形态，规则区被悄悄缩小。
    const isMirror = sel === 'body[data-ds-dark-theme]'
      || (sel === ':root' && body.includes('--dsw-radius-panel:'))
      || (sel === 'body' && body.includes('--dsw-alias-bg-base:'))
    if (isMirror) { dropped.push(sel); continue }
    kept.push(`${sel}{${body}}`)
  }
  return { css: kept.join('\n'), dropped }
}

const { css: ported, dropped } = stripTokenMirror(style[1])

// 剥多了就是把要查的规则一起扔掉，于是全绿——这条断言专门防这种假绿。
const EXPECTED_MIRROR_BLOCKS = 3
if (dropped.length !== EXPECTED_MIRROR_BLOCKS) {
  console.error(`剥离了 ${dropped.length} 块令牌镜像，期望 ${EXPECTED_MIRROR_BLOCKS} 块（:root / body / body[data-ds-dark-theme]）。`)
  console.error(`实际剥离：${dropped.join('、')} —— 规则区已被缩小，后续结论无效。`)
  process.exit(1)
}

const checks = [
  ['全圆角是否都配了 corner-shape:round', unpairedFullRound(ported)],
  ['组件圆角是否都在共享刻度上', unscaledRadii(ported)],
  ['抬升面是否还叠了中性边框', neutralBordersBesideElevation(ported)],
  ['规则区是否残留字面色值', literalColors(ported)],
  ['是否用了字面等宽字体栈', literalMonoStacks(ported)],
  ['别名契约（--mcp-* 指向真实令牌）', aliasContract(ported)],
]

let failed = 0
console.log(`已剥离令牌镜像：${dropped.join('、')}`)
console.log(`规则区体积：${ported.length} 字符\n`)
for (const [label, result] of checks) {
  const list = Array.isArray(result) ? result : []
  const ok = list.length === 0
  if (!ok) failed += 1
  console.log(`${ok ? '✔' : '✘'} ${label}${ok ? '' : ` —— ${list.length} 处`}`)
  for (const item of list.slice(0, 8)) console.log(`    ${typeof item === 'string' ? item : JSON.stringify(item)}`)
}

const host = aliasHost(ported)
const hostOk = host === 'body'
if (!hostOk) failed += 1
console.log(`${hostOk ? '✔' : '✘'} 别名层唯一宿主是 body —— 实际：${host}`)

// 令牌镜像必须逐值与宿主一致：抽查几个最容易写错的
const mirror = style[1]
const spot = [
  ['--dsw-alias-brand-primary: #0f1115', '品牌色在浅色下是近黑，不是蓝'],
  ['--dsw-radius-panel: 28px', '面板圆角是 28px'],
  ['body[data-ds-dark-theme]', '深色选择器名'],
]
for (const [needle, why] of spot) {
  const ok = mirror.includes(needle)
  if (!ok) failed += 1
  console.log(`${ok ? '✔' : '✘'} ${why}`)
}

console.log(`\n${failed === 0 ? '全部通过' : `${failed} 项未通过`}`)
process.exit(failed === 0 ? 0 : 1)
