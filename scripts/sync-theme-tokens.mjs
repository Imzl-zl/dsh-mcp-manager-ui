// 从 DSH 宿主主题样式表里导出全部主题令牌名，供 scripts/theme-spec.mjs 做存在性校验。
//
// 为什么要这份快照：插件的别名层把 `--mcp-*` 映射到 DSH 令牌。映射写错名字（拼错档位、
// 用了一个全仓不存在但名字很像的令牌）时，`var()` 会取到空值 —— 面板当场变透明或丢色，
// 而这件事在 jsdom 里看不见、在真机上要逐个对照样式表才发现。所以"别名指向的令牌真的
// 存在吗"必须是一条可判定的规则，而判定它需要一份可信的令牌清单。
//
// 快照而不是运行时探测：宿主包（npm 上的 @deepseek-ai/dsh-*）只带 JS，不带 CSS，
// 装出来的依赖里查不到令牌；CI 也只有本仓库。所以清单以生成物的形式随仓库走，
// 由本脚本从**宿主源码树**重放。
//
// 重放方式（宿主源码树有更新时手工跑一次，diff 里能直接看出上游增删了哪些令牌）：
//
//   node scripts/sync-theme-tokens.mjs "D:/sudy/github/deepseek-harness"
//
// 已知边界（如实记在这里，不假装它是自动的）：上游加令牌不会自动让 CI 变红，
// 只有**删/改**令牌才会被现有用例抓到（别名指向消失的令牌时 theme-contract 失败）。
// 这条与本仓库 upstream-drift.yml 的取向一致：那套流程只测 npm 上的 JS 契约，
// 拿不到主题表，所以令牌漂移只能靠手工重放发现。
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 承载主题令牌的宿主样式表，相对宿主仓库根。 */
const THEME_SHEETS = [
  'packages/client/ui-theme/src/styles/design-platform.css',
  'packages/client/ui-theme/src/styles/base.css',
  'packages/client/ui-theme/src/styles/gradient-shadow-text.css',
  'packages/client/ui-theme/src/styles/corner-shape.css',
  'packages/client/ui-theme/src/styles/focus.css',
  'packages/client/ui-theme/src/styles/onboarding.css',
]

/** `--dsw-x: value` / `--ds-x: value` 形式的定义（只认自定义属性定义，不认引用）。 */
const DEFINITION = /^\s*(--(?:dsw|ds)-[a-z0-9-]+)\s*:/gim

/**
 * 从宿主主题样式表文本里抽出全部令牌名。
 * @param {string} css - 样式表文本。
 * @returns {string[]} 令牌名，已去重排序。
 */
export function themeTokensIn(css) {
  const found = new Set()
  for (const match of css.matchAll(DEFINITION)) found.add(match[1].toLowerCase())
  return [...found].sort()
}

/**
 * 读宿主主题样式表，收集全部令牌名。
 * @param {string} hostRoot - 宿主仓库根目录。
 * @returns {string[]} 令牌名，已去重排序。
 */
export function collectThemeTokens(hostRoot) {
  const found = new Set()
  for (const sheet of THEME_SHEETS) {
    for (const token of themeTokensIn(readFileSync(join(hostRoot, sheet), 'utf8'))) found.add(token)
  }
  return [...found].sort()
}

/** 渲染生成物源码。 */
function render(tokens, hostRoot) {
  return `// 生成物 —— 请勿手工编辑。改判据请改 scripts/theme-spec.mjs；改清单请重放：
//
//   node scripts/sync-theme-tokens.mjs <宿主仓库根>
//
// 来源：DSH 宿主仓库（${hostRoot}）的 ui-theme 样式表，共 ${tokens.length} 个令牌。
// 覆盖 --dsw-*（别名/圆角/阴影/字体角色）与 --ds-*（基础字体与动效）。
// 不覆盖 --dsh-*（ui-theme 自己的运行时变量，插件不消费）。
export const DSH_THEME_TOKENS = new Set([
${tokens.map((token) => `  '${token}',`).join('\n')}
])
`
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (invokedDirectly) {
  const hostRoot = process.argv[2]
  if (!hostRoot) {
    console.error('用法: node scripts/sync-theme-tokens.mjs <宿主仓库根>')
    process.exit(2)
  }
  const tokens = collectThemeTokens(hostRoot)
  const target = fileURLToPath(new URL('./dsh-theme-tokens.mjs', import.meta.url))
  writeFileSync(target, render(tokens, hostRoot))
  console.log(`已写入 ${tokens.length} 个令牌 -> ${target}`)
}
