// 逐个实跑目录里的 Python 条目，抓「装得上但跑不起来」的服务。
//
// 为什么需要它：静态检查（包是否存在、是否被 yank、字段是否齐全）**查不出**这类问题。
// 真实案例：`postgres-mcp` 在 PyPI 上正常存在、未 yank，任何存在性检查都通过，但实跑
// 立刻崩——它没 pin `mcp<2`，而 MCP Python SDK 已发 2.x 把 `FastMCP` 改名成 `MCPServer`。
// 同理 `ida-pro-mcp`。两个都撞说明这是**一类**问题，不该逐个碰运气。
//
// 用法：
//
//   node scripts/probe-python-servers.mjs
//
// 它只对 `uvx` / `uv` / `serena` 形态的条目跑 `--help`（不启动真实服务、不连数据库），
// 按退出信息归类。联网下载依赖，首次运行会慢。
//
// 判据是退出码与错误文本，不是「有没有输出」：有些服务器 `--help` 走 stderr。
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'

const run = promisify(execFile)
const SOURCE = '.tasks/mcp-servers-verified.yaml'

const raw = readFileSync(SOURCE, 'utf8')
const block = /```yaml\n([\s\S]*?)```/.exec(raw)
if (!block) throw new Error(`在 ${SOURCE} 里找不到 YAML 代码块`)
const entries = parse(block[1])

/** 只测 Python 生态的条目：uvx / uv / 预装的 serena。npx 与 HTTP 型不在此列。 */
const pythonEntries = entries.filter((entry) => entry.transport === 'stdio'
  && ['uvx', 'uv', 'serena'].includes(entry.command))

/** 把 `<占位符>` 换成无害值，否则会因缺参退出而掩盖真实问题。 */
function safeArgs(args = []) {
  return args.map((arg) => (arg.includes('<') ? process.cwd() : arg))
}

/** 按错误文本归类。 */
function classify(text) {
  if (/mcp\.server\.fastmcp|FastMCP was renamed/.test(text)) {
    return ['❌ 撞 mcp 2.x（FastMCP 改名）——需 pin mcp<2', '']
  }
  if (/No solution found|were yanked/.test(text)) return ['❌ 依赖无法解析（疑似 yank）', '']
  if (/unrecognized arguments|invalid choice/.test(text)) {
    return ['⚠️ 参数不被接受', text.split('\n').filter(Boolean).pop()?.slice(0, 80) ?? '']
  }
  if (/command not found|is not recognized/.test(text)) return ['⚠️ 命令不存在（需预装）', '']
  return ['⚠️ 其他错误', text.split('\n').filter(Boolean).pop()?.slice(0, 80) ?? '']
}

console.log(`待测 Python 条目：${pythonEntries.length} 条（${SOURCE}）\n`)

let broken = 0
for (const entry of pythonEntries) {
  const argv = [...safeArgs(entry.args), '--help']
  const command = entry.command === 'serena' ? 'uvx' : entry.command
  const args = entry.command === 'serena' ? ['--from', 'serena-agent', 'serena', ...argv] : argv
  let verdict = '✅ 启动成功'
  let detail = ''
  try {
    const { stdout, stderr } = await run(command, args, { timeout: 180000, windowsHide: true })
    detail = `${stdout}${stderr}`.split('\n')[0].slice(0, 60)
  } catch (error) {
    const text = `${error.stdout || ''}${error.stderr || ''}`
    // `--help` 正常退出时 execFile 不抛错；抛错即有问题（除非是 timeout 的正常驻留）。
    if (error.killed) {
      verdict = '✅ 启动成功（正常驻留）'
    } else {
      [verdict, detail] = classify(text)
      broken += 1
    }
  }
  console.log(`${verdict.padEnd(44)} ${entry.id.padEnd(20)} ${detail}`)
}

console.log(`\n有问题的条目：${broken} / ${pythonEntries.length}`)
if (broken) {
  console.log('修法：给该条目的 args 前置 `--with`、`mcp<2`（实测 `uvx --with \'mcp<2\' postgres-mcp` 可正常启动）。')
  process.exitCode = 1
}
