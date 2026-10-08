// 压缩包夹具：手工造 zip / tar，供 skills-archive 与 skills-file-ops 两组测试共用。
//
// 为什么放在 scripts/ 而不是 test/：`node --test` 会把 test/ 下的每个文件都当作用例文件
// 加载（实测：放一个只导出的 helper.mjs 进去会让 tests 计数 +1 并因「没有用例」而失败）。
// scripts/ 已是非发布区（package-artifact.test.mjs 断言 scripts/ 不随包发布），
// 且已有同样定位的先行者（scripts/theme-spec.mjs 就是给测试用的判据模块）。
//
// 为什么必须共用同一份：zip 的外部属性决定「是不是符号链接」，是安全断言的核心。
// 若两份文件各有一份构造器，改了一处、另一处可能静默地不再测到符号链接。

import { deflateRawSync } from 'node:zlib'

const crcTable = (() => {
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  return table
})()

function crc32(buffer) {
  let crc = -1
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  // writeUInt32LE 要求无符号；`>>> 0` 把负的 Int32 转成对应的无符号值。
  return (crc ^ -1) >>> 0
}

/**
 * 造一个 zip（不引入依赖），支持 stored 与 deflate 两种方法。
 * @param {{ name: string, data?: string, unixMode?: number }[]} files
 * @param {{ deflate?: boolean }} [options]
 * @returns {Buffer}
 */
export function makeZip(files, { deflate = false } = {}) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8')
    const data = Buffer.from(file.data ?? '', 'utf8')
    const method = deflate ? 8 : 0
    const body = deflate ? deflateRawSync(data) : data
    const crc = crc32(data)

    const local = Buffer.alloc(30 + nameBuf.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    nameBuf.copy(local, 30)
    locals.push(local, body)

    const central = Buffer.alloc(46 + nameBuf.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    // 外部属性高 16 位：普通文件 0x81a4；符号链接由用例显式传入。
    // 用 >>> 而非 << ：0x81a4 << 16 会溢出成有符号负数，writeUInt32LE 会拒绝。
    central.writeUInt32LE(((file.unixMode ?? 0x81a4) << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    nameBuf.copy(central, 46)
    centrals.push(central)

    offset += local.length + body.length
  }
  const centralBuf = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralBuf, eocd])
}

/**
 * 造一个 tar。
 * @param {{ name: string, data?: string, typeFlag?: string }[]} files
 * @returns {Buffer}
 */
export function makeTar(files) {
  const blocks = []
  for (const file of files) {
    const data = Buffer.from(file.data ?? '', 'utf8')
    const header = Buffer.alloc(512)
    header.write(file.name, 0, 'utf8')
    header.write('0000644\0', 100, 'latin1')
    header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124, 'latin1')
    header.write(file.typeFlag ?? '0', 156, 'latin1')
    header.write('ustar\0', 257, 'latin1')
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512))
  }
  blocks.push(Buffer.alloc(1024))
  return Buffer.concat(blocks)
}
