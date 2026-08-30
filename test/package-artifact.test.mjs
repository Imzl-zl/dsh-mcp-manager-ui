import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gunzipSync } from 'node:zlib'
import test from 'node:test'

const execFileAsync = promisify(execFile)
const projectRoot = new URL('..', import.meta.url)
const dshHostPackages = [
  '@deepseek-ai/dsh-atomic-write',
  '@deepseek-ai/dsh-typert-protocol',
]

function tarString(buffer, offset, length) {
  const end = buffer.indexOf(0, offset)
  return buffer.subarray(offset, end < 0 || end > offset + length ? offset + length : end).toString('utf8')
}

function tarEntries(buffer) {
  const entries = []
  for (let offset = 0; offset + 512 <= buffer.length;) {
    const header = buffer.subarray(offset, offset + 512)
    const name = tarString(header, 0, 100)
    if (!name) break
    const prefix = tarString(header, 345, 155)
    const path = prefix ? `${prefix}/${name}` : name
    const size = Number.parseInt(tarString(header, 124, 12).trim() || '0', 8)
    const type = String.fromCharCode(header[156] || 0)
    const dataOffset = offset + 512
    entries.push({ path, type, data: buffer.subarray(dataOffset, dataOffset + size) })
    offset = dataOffset + Math.ceil(size / 512) * 512
  }
  return entries
}

async function npmPack(packDir) {
  const cwd = fileURLToPath(projectRoot)
  const args = ['pack', '--json', '--pack-destination', packDir]
  if (process.platform !== 'win32') return execFileAsync('npm', args, { cwd, windowsHide: true })
  return execFileAsync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'npm', ...args], { cwd, windowsHide: true })
}

async function linkPackage(nodeModules, name) {
  const source = await realpath(new URL(`../node_modules/${name}`, import.meta.url))
  const target = join(nodeModules, ...name.split('/'))
  await mkdir(dirname(target), { recursive: true })
  await symlink(source, target, process.platform === 'win32' ? 'junction' : 'dir')
}

test('packed artifact resolves required DSH peers from the host fallback', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-mcp-artifact-'))
  try {
    const packDir = join(root, 'pack')
    await mkdir(packDir)
    const { stdout } = await npmPack(packDir)
    const [{ filename }] = JSON.parse(stdout)
    const archive = gunzipSync(await readFile(join(packDir, filename)))
    const entries = tarEntries(archive)
    const packageRoot = join(root, 'profiles', 'web', 'node_modules', 'dsh-mcp-manager-ui')

    for (const entry of entries) {
      if (entry.type !== '0' && entry.type !== '\0') continue
      assert.match(entry.path, /^package\//)
      const relativePath = entry.path.slice('package/'.length)
      assert.equal(isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes('..'), false)
      const target = join(packageRoot, relativePath)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, entry.data)
    }

    const packedManifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
    assert.equal(packedManifest.version, '1.1.7')
    for (const name of dshHostPackages) {
      assert.equal(packedManifest.dependencies?.[name], undefined)
      assert.equal(packedManifest.optionalDependencies?.[name], undefined)
      assert.equal(packedManifest.peerDependencies?.[name], '^0.1.0-rc.7')
      assert.notEqual(packedManifest.peerDependenciesMeta?.[name]?.optional, true)
    }
    const packedText = entries
      .filter((entry) => /\.(?:js|json|md|ya?ml)$/.test(entry.path))
      .map((entry) => entry.data.toString('utf8'))
      .join('\n')
    assert.doesNotMatch(packedText, /(?:0\.1\.0-)?rc\.6/)

    const profileModules = join(root, 'profiles', 'web', 'node_modules')
    const hostModules = join(root, 'profiles', 'node_modules')
    await linkPackage(profileModules, 'yaml')
    await linkPackage(profileModules, 'zod')
    for (const name of dshHostPackages) await linkPackage(hostModules, name)

    const entry = await import(`${pathToFileURL(join(packageRoot, 'lib', 'index.js')).href}?artifact`)
    assert.equal(typeof entry.default, 'function')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
