// 文档双语的结构闸门。
//
// 为什么值得单测：中英两份文档的「对应关系」此前靠人眼核（PR 里号称机械核对，
// 实际核的是「锚点没变」而不是「锚点能解析」——于是 10 处文内死链全绿通过）。
// 这里把四条属性钉成确定性断言：
//   ① 文内锚点必须在**本文档内**解析（GitHub 按各自语言的标题生成锚点）；
//   ② 中英两份的标题层级序列一致（结构镜像）；
//   ③ .en.md 里的跨文档链接指向英文兄弟（英文读者不该被带进中文文档）；
//   ④ 所有相对链接的目标文件存在。
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const DOCS = fileURLToPath(new URL('../docs/', import.meta.url))
const DOCS_URL = new URL('../docs/', import.meta.url)
const PAIRS = [
  ['installation.md', 'installation.en.md'],
  ['skills.md', 'skills.en.md'],
  ['json-import.md', 'json-import.en.md'],
  ['project-mcp-lifecycle.md', 'project-mcp-lifecycle.en.md'],
  ['design.md', 'design.en.md'],
]

const read = (name) => readFileSync(DOCS + name, 'utf8')

/** GitHub 的锚点算法（够用近似）：小写、去标点（保留字母/数字/空格/连字符，CJK 保留）、空格转连字符。 */
const slug = (text) => text.toLowerCase()
  .replace(/[^\p{L}\p{N}\s-]/gu, '')
  .trim()
  .replace(/\s+/g, '-')

const headingsOf = (source) => source.split('\n')
  .map((line, index) => [/^(#{1,6})\s+(.*?)\s*$/.exec(line), index + 1])
  .filter(([match]) => match)
  .map(([match, line]) => ({ level: match[1].length, text: match[2], line, slug: slug(match[2]) }))

for (const [zh, en] of PAIRS) {
  test(`${en}: every in-file anchor resolves in this document`, () => {
    // 文内锚点按**各自语言**的标题生成：中文锚点解析不到英文标题（反之亦然）。
    // PR #6 最初的教训就是把中文锚点照抄进英文文档，目录整片死链。
    const headings = headingsOf(read(en))
    const slugs = new Set(headings.map((heading) => heading.slug))
    const dead = []
    read(en).split('\n').forEach((line, index) => {
      for (const match of line.matchAll(/\]\(#([^)]+)\)/g)) {
        if (!slugs.has(match[1])) dead.push(`L${index + 1}: #${match[1]}`)
      }
    })
    assert.deepEqual(dead, [], `${en} 的文内锚点解析不到（按英文标题重推）：${dead.join('、')}`)
  })

  test(`${zh} / ${en}: heading structure mirrors`, () => {
    // 标题层级序列必须一致（文本不同，形状相同）。加节/删节要同步两份。
    const zhLevels = headingsOf(read(zh)).map((heading) => heading.level)
    const enLevels = headingsOf(read(en)).map((heading) => heading.level)
    assert.deepEqual(enLevels, zhLevels, `${en} 与 ${zh} 的标题层级序列不一致`)
  })

  test(`${en}: cross-document links stay in English`, () => {
    // 英文文档里的跨文档链接必须指向英文兄弟——把英文读者带进中文文档是半截翻译。
    // 唯一例外是开头那行语言切换链接（[中文](x.md)）。
    const wrong = []
    read(en).split('\n').forEach((line, index) => {
      if (index < 5 && /\[中文\]\(/.test(line)) return
      for (const match of line.matchAll(/\]\(([^)#]+\.md)(#[^)]*)?\)/g)) {
        if (!match[1].endsWith('.en.md')) wrong.push(`L${index + 1}: -> ${match[1]}${match[2] ?? ''}`)
      }
    })
    assert.deepEqual(wrong, [], `${en} 这些链接指向中文文档（改指 .en.md 兄弟）：${wrong.join('、')}`)
  })

  test(`${zh} / ${en}: every relative link target exists`, () => {
    for (const name of [zh, en]) {
      read(name).split('\n').forEach((line, index) => {
        for (const match of line.matchAll(/\]\(([^)#]+\.md)(#[^)]*)?\)/g)) {
          // 链接相对**文档所在目录**解析（docs/）：`../README.md` 即仓库根的 README。
          assert.ok(existsSync(fileURLToPath(new URL(match[1], DOCS_URL))),
            `${name} L${index + 1} 的链接目标不存在：${match[1]}`)
        }
      })
    }
  })
}
