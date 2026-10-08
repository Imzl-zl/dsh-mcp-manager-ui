// 技能压缩包的安全解包。
//
// 压缩包是**不可信输入**，解包是典型高危动作，所以这组测试的重点不是「能不能解开」，
// 而是「恶意包会不会写到不该写的地方 / 撑爆磁盘」。
// 限额取值与主流 CLI（vercel-labs/skills）一致：10 MiB/文件、25 MiB 总量、1000 条目。
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import {
  detectArchiveFormat,
  extractArchive,
  safeEntryPath,
  MAX_ENTRIES,
  MAX_TOTAL_BYTES,
} from '../lib/skills-archive.js'
// 夹具与 skills-file-ops 的导入用例共用一份：zip 的外部属性决定「是不是符号链接」，
// 是安全断言的核心，两份拷贝里改漏一处就会静默失去覆盖。
import { makeTar, makeZip } from '../scripts/archive-fixtures.mjs'

async function makeTmp() {
  return await mkdtemp(join(tmpdir(), 'dsh-archive-'))
}

test('detects the archive format from magic bytes, not the file name', async () => {
  // 名字不可信（下载 URL 可以不带到扩展名——主流 CLI 明确支持这种），所以按魔数判定。
  assert.equal(detectArchiveFormat(makeZip([{ name: 'a/SKILL.md', data: 'x' }])), 'zip')
  assert.equal(detectArchiveFormat(gzipSync(makeTar([{ name: 'a', data: 'x' }]))), 'tar.gz')
  assert.equal(detectArchiveFormat(makeTar([{ name: 'a', data: 'x' }])), 'tar')
  assert.equal(detectArchiveFormat(Buffer.from('just text')), undefined)
})

test('extracts a zip skill bundle with its resources', async () => {
  const root = await makeTmp()
  try {
    const zip = makeZip([
      { name: 'my-skill/SKILL.md', data: '---\nname: my-skill\n---\n' },
      { name: 'my-skill/references/note.md', data: 'note' },
    ])
    const { format, files } = await extractArchive(zip, root)
    assert.equal(format, 'zip')
    assert.deepEqual(files.sort(), ['my-skill/SKILL.md', 'my-skill/references/note.md'])
    assert.match(await readFile(join(root, 'my-skill', 'SKILL.md'), 'utf8'), /name: my-skill/)
    assert.equal(await readFile(join(root, 'my-skill', 'references', 'note.md'), 'utf8'), 'note')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('extracts a deflate-compressed zip as well as a stored one', async () => {
  const root = await makeTmp()
  try {
    const zip = makeZip([{ name: 's/SKILL.md', data: 'hello '.repeat(50) }], { deflate: true })
    const { files } = await extractArchive(zip, root)
    assert.deepEqual(files, ['s/SKILL.md'])
    assert.equal(await readFile(join(root, 's', 'SKILL.md'), 'utf8'), 'hello '.repeat(50))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('extracts tar and tar.gz archives', async () => {
  const root = await makeTmp()
  try {
    const tar = makeTar([{ name: 't/SKILL.md', data: 'tar body' }])
    await extractArchive(tar, root)
    assert.equal(await readFile(join(root, 't', 'SKILL.md'), 'utf8'), 'tar body')

    const tarGz = gzipSync(makeTar([{ name: 'g/SKILL.md', data: 'gz body' }]))
    await extractArchive(tarGz, root)
    assert.equal(await readFile(join(root, 'g', 'SKILL.md'), 'utf8'), 'gz body')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('refuses a zip whose entry escapes the destination (zip slip)', async () => {
  // 最经典也最危险的解包漏洞：条目名带 .. 就能写到目标目录之外。
  const root = await makeTmp()
  const outside = join(root, '..', `escaped-${process.pid}.txt`)
  try {
    for (const name of ['../escaped.txt', '../../escaped.txt', '/tmp/escaped.txt', 'C:/escaped.txt', 'a/../../escaped.txt']) {
      const zip = makeZip([{ name, data: 'pwned' }])
      await assert.rejects(
        () => extractArchive(zip, join(root, 'dest')),
        /越出目标目录|绝对路径|盘符/,
        `条目 ${name} 必须被拒绝`,
      )
    }
    assert.equal(existsSync(outside), false, '越界文件不得被写出')
  } finally {
    await rm(outside, { force: true })
    await rm(root, { recursive: true, force: true })
  }
})

test('refuses symbolic links inside an archive', async () => {
  // 符号链接可让后续写入逃出目标目录，故整包拒绝。
  const root = await makeTmp()
  try {
    const zip = makeZip([{ name: 'link', data: '/etc/passwd', unixMode: 0xa1ff }])
    await assert.rejects(() => extractArchive(zip, root), /符号链接/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('refuses a tar entry that is a link rather than a regular file', async () => {
  const root = await makeTmp()
  try {
    const tar = makeTar([{ name: 'evil', data: '', typeFlag: '2' }])
    await assert.rejects(() => extractArchive(tar, root), /不支持的条目/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('enforces the entry-count limit so an archive cannot exhaust the disk', async () => {
  const root = await makeTmp()
  try {
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `d/f${i}.md`, data: 'x' }))
    await assert.rejects(
      () => extractArchive(makeZip(many), root, { maxEntries: 5 }),
      /条目数超过上限/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('enforces the total-size limit using actual extracted bytes, not the declared size', async () => {
  // 关键：zip 头里声明的大小是攻击者可控的，所以限额必须按**实际解出的字节**累计。
  const root = await makeTmp()
  try {
    const zip = makeZip([
      { name: 'a.md', data: 'x'.repeat(400) },
      { name: 'b.md', data: 'y'.repeat(400) },
    ])
    await assert.rejects(
      () => extractArchive(zip, root, { maxTotalBytes: 500 }),
      /总量超过上限/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('ships limits that match the mainstream CLI defaults', () => {
  // 与 vercel-labs/skills 的默认值一致，同一批包在两处行为可预期。
  assert.equal(MAX_TOTAL_BYTES, 25 * 1024 * 1024)
  assert.equal(MAX_ENTRIES, 1000)
})

test('rejects an unrecognized archive instead of guessing', async () => {
  const root = await makeTmp()
  try {
    await assert.rejects(() => extractArchive(Buffer.from('not an archive'), root), /无法识别/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('normalizes entry paths without letting traversal through', () => {
  assert.equal(safeEntryPath('a/b/SKILL.md'), 'a/b/SKILL.md')
  // Windows 打包的 zip 可能用反斜杠。
  assert.equal(safeEntryPath('a\\b\\SKILL.md'), 'a/b/SKILL.md')
  for (const bad of ['../x', '..\\x', '/x', 'C:\\x', 'a/../../x']) {
    assert.throws(() => safeEntryPath(bad), /越出目标目录|绝对路径|盘符/, `${bad} 必须被拒绝`)
  }
})
