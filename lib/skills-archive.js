// 技能压缩包的安全解包。
//
// 为什么需要它：主流 skills CLI（vercel-labs/skills，事实标准）在「直接下载 URL」这条
// 路径上支持 .zip / .tar / .tar.gz / .tgz，用户从网上拿到的技能包也多是这几种。
//
// 但压缩包是**不可信输入**，解包是典型的高危动作，所以这里的纪律比别处严：
//   - zip slip：条目名含绝对路径或 `..` 一律拒绝，绝不写出目标目录。
//   - 符号链接/硬链接：拒绝，否则可以借链接写到根目录之外。
//   - zip bomb：按主流 CLI 的同一组默认限额卡住（见下），并在解压过程中累计校验，
//     不能只看压缩包自身声明的尺寸（那是攻击者可控的）。
//   - 只解压到调用方给的目录内，且返回实际写出的条目清单供上层校验。
//
// 限额取值与主流 CLI 的默认值一致（SKILLS_DOWNLOAD_MAX_BYTES / SKILLS_EXTRACT_MAX_BYTES /
// SKILLS_EXTRACT_MAX_FILES），这样同一批包在两处的行为可预期。

import { gunzipSync, inflateRawSync } from 'node:zlib'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, normalize, sep } from 'node:path'

/** 单个文件解压后的上限：10 MiB（与主流 CLI 的下载上限同值）。 */
export const MAX_FILE_BYTES = 10 * 1024 * 1024
/** 全部解压内容的上限：25 MiB（与主流 CLI 一致）。 */
export const MAX_TOTAL_BYTES = 25 * 1024 * 1024
/** 条目数上限：1000（与主流 CLI 一致）。 */
export const MAX_ENTRIES = 1000

/**
 * 压缩包**输入**字节的上限（注意不是解压后的总量）。
 *
 * 为什么需要：限额判定发生在解压**之后**（见 extractArchive 的 writeEntry），而调用方
 * 是先把整包 `readFile` 进内存的——没有这道闸，一个几十 MiB 的包在读进来时就已经
 * 占满了内存。取 32 MiB，与外部源下载那条的上限同源。
 */
export const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024

/**
 * 按魔数识别压缩格式。
 * @param {Buffer} buffer
 * @returns {'zip'|'tar.gz'|'tar'|undefined}
 */
export function detectArchiveFormat(buffer) {
  if (buffer.length < 4) return undefined
  // zip: 本地文件头或空档案的中央目录结尾
  if (buffer[0] === 0x50 && buffer[1] === 0x4b && (buffer[2] === 0x03 || buffer[2] === 0x05)) return 'zip'
  // gzip
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) return 'tar.gz'
  // tar: 'ustar' 出现在偏移 257
  if (buffer.length > 262 && buffer.toString('latin1', 257, 262) === 'ustar') return 'tar'
  return undefined
}

/**
 * 校验一个归档条目名是否安全，返回规范化后的相对路径。
 *
 * 拒绝：绝对路径、盘符、`..` 段、空名、以分隔符结尾的目录项由调用方跳过。
 * @param {string} rawName
 * @returns {string} 配对于目标目录的相对路径
 */
export function safeEntryPath(rawName) {
  if (typeof rawName !== 'string' || rawName === '') throw new Error('归档条目名为空')
  // 统一分隔符后再判断：Windows 打包的 zip 可能用反斜杠。
  const unified = rawName.replace(/\\/g, '/')
  if (unified.startsWith('/')) throw new Error(`归档条目使用绝对路径：${rawName}`)
  if (/^[A-Za-z]:/.test(unified)) throw new Error(`归档条目含盘符：${rawName}`)
  const normalized = normalize(unified).replace(/\\/g, '/')
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error(`归档条目越出目标目录：${rawName}`)
  }
  return normalized
}

/** 读 zip 的中央目录，返回条目清单（不依赖压缩包自述的总大小）。 */
function readZipEntries(buffer) {
  // 从尾部找 End of Central Directory（可能在注释之前，故向前扫）。
  let eocd = -1
  for (let i = buffer.length - 22; i >= 0 && i >= buffer.length - 22 - 0xffff; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('不是有效的 zip：找不到中央目录结尾')
  const count = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)

  const entries = []
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('zip 中央目录损坏')
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const uncompressedSize = buffer.readUInt32LE(offset + 24)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const externalAttrs = buffer.readUInt32LE(offset + 38)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength)
    // 高 16 位是 Unix 模式；0xA000 是符号链接。
    const unixMode = (externalAttrs >>> 16) & 0xffff
    entries.push({ name, method, compressedSize, uncompressedSize, localOffset, unixMode })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

/** 解出一个 zip 条目的内容。 */
/**
 * 解出单个 zip 条目的内容。
 *
 * ⚠️ `maxOutputLength` 不是优化而是**安全边界**：限额检查在 writeEntry（即解压**之后**），
 * 没有它时一个 0.2 MiB 的 deflate 包能先分配出 256 MiB（实测 RSS 从 582 → 1102 MiB）
 * 再被拒绝——压缩比就是现成的 DoS 通道。给 zlib 一个「单文件上限 + 1」的上界，
 * 超了它自己抛 ERR_BUFFER_TOO_LARGE，我们再翻成人话。
 */
function readZipEntryData(buffer, entry, maxFileBytes) {
  const offset = entry.localOffset
  if (buffer.readUInt32LE(offset) !== 0x04034b50) throw new Error('zip 本地文件头损坏')
  const nameLength = buffer.readUInt16LE(offset + 26)
  const extraLength = buffer.readUInt16LE(offset + 28)
  const start = offset + 30 + nameLength + extraLength
  const raw = buffer.subarray(start, start + entry.compressedSize)
  if (entry.method === 0) return Buffer.from(raw)
  if (entry.method === 8) return inflateBounded(raw, maxFileBytes + 1, entry.name)
  throw new Error(`不支持的 zip 压缩方法：${entry.method}`)
}

/** 有界 inflate：把 zlib 的 ERR_BUFFER_TOO_LARGE 翻成用户能懂的话。 */
function inflateBounded(raw, maxOutputLength, name) {
  try {
    return inflateRawSync(raw, { maxOutputLength })
  } catch (error) {
    if (error?.code === 'ERR_BUFFER_TOO_LARGE') {
      throw new Error(`归档条目过大（${name} 解压后超过 ${maxOutputLength} 字节）`)
    }
    throw error
  }
}

/** 有界 gunzip：tar.gz 的整包解压同样不能先吃满内存。 */
function gunzipBounded(buffer, maxOutputLength) {
  try {
    return gunzipSync(buffer, { maxOutputLength })
  } catch (error) {
    if (error?.code === 'ERR_BUFFER_TOO_LARGE') {
      throw new Error(`解压内容总量超过上限（tar.gz 解压后超过 ${maxOutputLength} 字节）`)
    }
    throw error
  }
}

/** 读 tar（已解压的）条目清单。 */
function readTarEntries(buffer) {
  const entries = []
  let offset = 0
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512)
    // 全零块表示结束。
    if (header.every((byte) => byte === 0)) break
    const name = header.toString('utf8', 0, 100).replace(/\0.*$/, '')
    const sizeField = header.toString('utf8', 124, 136).replace(/\0.*$/, '').trim()
    const size = sizeField === '' ? 0 : parseInt(sizeField, 8)
    const typeFlag = header.toString('utf8', 156, 157)
    const prefix = header.toString('utf8', 345, 500).replace(/\0.*$/, '')
    const fullName = prefix === '' ? name : `${prefix}/${name}`
    if (!Number.isFinite(size) || size < 0) throw new Error('tar 条目大小损坏')
    const dataStart = offset + 512
    const dataEnd = dataStart + size
    if (dataEnd > buffer.length) throw new Error('tar 条目越出文件末尾')
    entries.push({ name: fullName, typeFlag, data: buffer.subarray(dataStart, dataEnd) })
    offset = dataStart + Math.ceil(size / 512) * 512
  }
  return entries
}

/**
 * 把压缩包解到目标目录，返回实际写出的相对路径清单。
 *
 * @param {Buffer} buffer - 压缩包字节。
 * @param {string} destination - 目标目录（必须已存在或可创建）。
 * @param {{ maxEntries?: number, maxTotalBytes?: number, maxFileBytes?: number }} [limits]
 * @returns {Promise<{ format: string, files: string[] }>}
 */
export async function extractArchive(buffer, destination, limits = {}) {
  const maxEntries = limits.maxEntries ?? MAX_ENTRIES
  const maxTotalBytes = limits.maxTotalBytes ?? MAX_TOTAL_BYTES
  const maxFileBytes = limits.maxFileBytes ?? MAX_FILE_BYTES

  const format = detectArchiveFormat(buffer)
  if (format === undefined) throw new Error('无法识别的压缩格式（支持 zip / tar / tar.gz / tgz）')

  await mkdir(destination, { recursive: true })
  const files = []
  let totalBytes = 0

  /** 写一个条目，并做累计限额校验。 */
  const writeEntry = async (rawName, data) => {
    if (rawName.endsWith('/') || rawName.endsWith('\\')) return // 目录项，按需建
    const relative = safeEntryPath(rawName)
    if (data.length > maxFileBytes) {
      throw new Error(`归档条目过大（${relative} 超过 ${maxFileBytes} 字节）`)
    }
    totalBytes += data.length
    if (totalBytes > maxTotalBytes) {
      throw new Error(`解压内容总量超过上限（${maxTotalBytes} 字节）`)
    }
    files.push(relative)
    if (files.length > maxEntries) {
      throw new Error(`归档条目数超过上限（${maxEntries}）`)
    }
    const target = join(destination, relative)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, data)
  }

  if (format === 'zip') {
    for (const entry of readZipEntries(buffer)) {
      // 0xA000 = 符号链接。解出链接会让后续写入逃出目标目录。
      if ((entry.unixMode & 0xf000) === 0xa000) {
        throw new Error(`归档含符号链接，已拒绝：${entry.name}`)
      }
      if (entry.name.endsWith('/')) continue // 目录项
      await writeEntry(entry.name, readZipEntryData(buffer, entry, maxFileBytes))
    }
    return { format, files }
  }

  // tar.gz：整包解压也要有界（tar 的额外开销 = 每条目一个 512 字节头 + 512 对齐填充）。
  const tarBuffer = format === 'tar.gz'
    ? gunzipBounded(buffer, maxTotalBytes + (maxEntries + 1) * 1024)
    : buffer
  // tar 头的 typeFlag：'0'/'\0'/'' 普通文件；'5' 目录；'x'/'g' PAX 扩展头（元数据，跳过）；
  // 'L'/'K' GNU 长名/长链接名（作用在**下一条目**上）；其余（'1' 硬链接、'2' 符号链接、
  // '3'/'4' 字符/块设备、'6' FIFO）一律拒绝。
  //
  // ⚠️ 为什么必须认 PAX/GNU 头：`git archive`、GitHub 的 codeload tarball、部分 `npm pack`
  // 产物，第一个 512 字节块就是 `pax_global_header`（typeflag 'g'）——旧版直接抛
  // 「不支持的条目光型」，于是最常见的真实包**一个都进不来**（夹具只写纯 ustar，
  // 所以「支持 tar」一直是假绿，见 test/skills-archive.test.mjs 的新用例）。
  let pendingName = ''
  for (const entry of readTarEntries(tarBuffer)) {
    if (entry.typeFlag === '5') continue
    if (entry.typeFlag === 'x' || entry.typeFlag === 'g') {
      // PAX 记录形如 `<长度> key=value\n`；`path=` 能给出超过 100 字节的名字。
      pendingName = paxPath(entry.data) || pendingName
      continue
    }
    if (entry.typeFlag === 'L') { pendingName = cString(entry.data); continue }
    if (entry.typeFlag === 'K') continue // 长链接名：链接本身一律拒绝，不需要它
    if (entry.typeFlag !== '0' && entry.typeFlag !== '\0' && entry.typeFlag !== '') {
      throw new Error(`归档含不支持的条目光型（type ${JSON.stringify(entry.typeFlag)}）：${entry.name}`)
    }
    await writeEntry(pendingName === '' ? entry.name : pendingName, entry.data)
    pendingName = ''
  }
  return { format, files }
}

/** tar 里的名字以 NUL 结尾。 */
const cString = (data) => data.toString('utf8').replace(/\0[\s\S]*$/, '').trim()

/** 从 PAX 扩展头的数据体里取 `path=` 记录（没有就返回空串）。 */
function paxPath(data) {
  const match = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(data.toString('utf8'))
  return match === null ? '' : match[1].trim()
}
