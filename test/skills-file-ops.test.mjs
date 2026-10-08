// 宿主侧 skills 文件动作：启停、删除、导入、扫描已禁用。
//
// 这一层**真的动用户的文件**，所以纪律比其它层严：
//   - 按 (name, scope, root) 精确定位；找不到就报错，**绝不回退**到别的作用域
//     （否则同名技能会被误删/误停用——dsh-skill-explorer 记录的正是这个坑）。
//   - bundled 根只读，拒绝写入。
//   - 启停用 rename（dsh-atomic-write 没有 rename，只有 writeFileAtomic/withFileLock）。
//
// 宿主看不到已禁用的技能（SKILL.md 改名后按固定路径读不到 → 静默跳过），
// 所以「已禁用」必须由本层自己扫 .disabled 得到。
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, symlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import {
  importSkill,
  scanDisabledSkills,
  SkillNotFoundError,
  readSkillFile,
  removeSkill,
  resolveSkillTarget,
  setSkillEnabled,
} from '../lib/skills-file-ops.js'
import { makeTar, makeZip } from '../scripts/archive-fixtures.mjs'

/** 建一个临时技能根，含目录捆绑与扁平两种形态。 */
async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skills-'))
  const bundle = join(root, 'zhanggui')
  await mkdir(bundle, { recursive: true })
  await writeFile(join(bundle, 'SKILL.md'), '---\nname: zhanggui\ndescription: demo\n---\n\nbody\n')
  await writeFile(join(root, 'flat-one.md'), '---\nname: flat-one\ndescription: flat demo\n---\n\nflat body\n')
  return root
}

test('disables a directory bundle by renaming SKILL.md and re-enables it back', async () => {
  const root = await makeRoot()
  try {
    const target = await resolveSkillTarget({ name: 'zhanggui', scope: 'global', root })
    assert.equal(target.kind, 'bundle')

    await setSkillEnabled(target, false)
    assert.equal(existsSync(join(root, 'zhanggui', 'SKILL.md')), false, '禁用后 SKILL.md 应不存在')
    assert.equal(existsSync(join(root, 'zhanggui', 'SKILL.md.disabled')), true, '禁用后应有 .disabled')

    await setSkillEnabled(target, true)
    assert.equal(existsSync(join(root, 'zhanggui', 'SKILL.md')), true, '启用后应恢复 SKILL.md')
    assert.equal(existsSync(join(root, 'zhanggui', 'SKILL.md.disabled')), false, '启用后不应残留 .disabled')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('disables a flat skill file by renaming it, and the host never counts it as a skill', async () => {
  const root = await makeRoot()
  try {
    const target = await resolveSkillTarget({ name: 'flat-one', scope: 'global', root })
    assert.equal(target.kind, 'flat')

    await setSkillEnabled(target, false)
    const names = await readdir(root)
    assert.equal(names.includes('flat-one.md'), false)
    assert.equal(names.includes('flat-one.md.disabled'), true)
    // 宿主按 name.endsWith('.md') 判定扁平技能，故 .md.disabled 不会被扫成技能。
    assert.equal('flat-one.md.disabled'.endsWith('.md'), false)

    await setSkillEnabled(target, true)
    assert.equal((await readdir(root)).includes('flat-one.md'), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('refuses to operate when the named skill is absent from the given scope', async () => {
  // 这是本层最重要的一条：找不到就报错，绝不「回退」到别的作用域或别的形态。
  const root = await makeRoot()
  try {
    await assert.rejects(
      () => resolveSkillTarget({ name: 'does-not-exist', scope: 'global', root }),
      /does-not-exist/,
      '不存在的技能必须抛错，而不是返回一个猜测的目标',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('reports absence with a distinguishable error code, not a bare message', async () => {
  // 面板要按 code 判定「不存在」（→ 提示用户）还是真失败（→ 报警）。
  // 若只能靠 message 猜，调用方就只能 catch 全部错误，把权限/IO 失败也当成「不存在」。
  const root = await makeRoot()
  try {
    await assert.rejects(
      () => resolveSkillTarget({ name: 'ghost', scope: 'global', root }),
      (error) => {
        assert.equal(error.code, 'SKILL_NOT_FOUND')
        assert.equal(error instanceof SkillNotFoundError, true, '必须是可 instanceof 的专用类型')
        return true
      },
    )
    // 非法名字是**另一类**错误：它是坏输入，不是「不存在」，不得混为一谈。
    await assert.rejects(
      () => resolveSkillTarget({ name: 'Bad_Name', scope: 'global', root }),
      (error) => {
        assert.notEqual(error.code, 'SKILL_NOT_FOUND', '非法名字不得被当成「技能不存在」')
        return true
      },
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('refuses to write into a bundled root', async () => {
  const root = await makeRoot()
  try {
    const target = await resolveSkillTarget({ name: 'zhanggui', scope: 'global', root })
    await assert.rejects(
      () => setSkillEnabled({ ...target, writable: false }, false),
      /只读|read-only/,
      'bundled 根只读：部署内置的技能不可启停',
    )
    assert.equal(existsSync(join(root, 'zhanggui', 'SKILL.md')), true, '拒绝后不得改动文件')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('scans disabled skills that the host catalog cannot see', async () => {
  // 宿主按固定路径读 SKILL.md，改名后读不到 → 技能从宿主目录消失。
  // 所以「已禁用」只能由本层扫描得到，否则面板无法展示它们、也无法提供「启用」。
  const root = await makeRoot()
  try {
    await setSkillEnabled(await resolveSkillTarget({ name: 'zhanggui', scope: 'global', root }), false)
    await setSkillEnabled(await resolveSkillTarget({ name: 'flat-one', scope: 'global', root }), false)

    const disabled = await scanDisabledSkills({ root, scope: 'global' })
    assert.deepEqual(disabled.map((row) => row.name).sort(), ['flat-one', 'zhanggui'])
    assert.equal(disabled.every((row) => row.scope === 'global'), true)
    // 必须带上可操作的目标，否则面板拿到名字也没法启用。
    assert.equal(disabled.every((row) => typeof row.kind === 'string'), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('reads a skill body so the panel can show it without the host', async () => {
  const root = await makeRoot()
  try {
    const target = await resolveSkillTarget({ name: 'zhanggui', scope: 'global', root })
    const text = await readSkillFile(target)
    assert.match(text, /body/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('removes a skill bundle and a flat file, and reports what it removed', async () => {
  const root = await makeRoot()
  try {
    const bundle = await resolveSkillTarget({ name: 'zhanggui', scope: 'global', root })
    await removeSkill(bundle)
    assert.equal(existsSync(join(root, 'zhanggui')), false, '目录捆绑应整个删掉')

    await removeSkill(await resolveSkillTarget({ name: 'flat-one', scope: 'global', root }))
    assert.equal(existsSync(join(root, 'flat-one.md')), false)

    assert.deepEqual(await readdir(root), [], '两个技能都删掉后根目录应为空')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('refuses to delete outside the skill root even if the name looks like a path', async () => {
  // 外部输入在系统边界必须校验：技能名来自面板/远端目录，不能让它跳出根目录。
  const root = await makeRoot()
  const outside = join(root, '..', 'must-survive.txt')
  await writeFile(outside, 'keep me')
  try {
    for (const name of ['../must-survive', '..\\must-survive', '/etc/passwd', 'a/b']) {
      await assert.rejects(
        () => resolveSkillTarget({ name, scope: 'global', root }),
        /非法|invalid/,
        `名字 ${name} 必须被拒绝`,
      )
    }
    assert.equal(existsSync(outside), true, '越界目标必须原封不动')
  } finally {
    await rm(outside, { force: true })
    await rm(root, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// 导入（.md / 目录 / 压缩包）
//
// 关键约束：宿主的技能**身份来自 frontmatter 的 name**，不是文件/目录名
// （dsh-skill-filesystem/lib/index.js:696-704）。所以导入必须按 frontmatter 的名字落盘，
// 否则本层自己的 resolveSkillTarget(name) 会找不到刚导入的技能——面板导入完就点不动。
// ---------------------------------------------------------------------------

/** 建一个空的作用域根（模拟用户选中的项目/全局作用域）。 */
async function makeDestRoot() {
  return await mkdtemp(join(tmpdir(), 'dsh-import-'))
}

/** 造一个源技能目录。 */
async function makeSourceBundle({ directory = 'source-dir', name = 'imported-bundle' } = {}) {
  const parent = await mkdtemp(join(tmpdir(), 'dsh-src-'))
  const dir = join(parent, directory)
  await mkdir(join(dir, 'references'), { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: 导入演示\n---\n\n正文\n`)
  await writeFile(join(dir, 'references', 'note.md'), 'note')
  return dir
}

test('imports a single .md file as a flat skill named by its frontmatter', async () => {
  const root = await makeDestRoot()
  const sourceParent = await mkdtemp(join(tmpdir(), 'dsh-src-'))
  const source = join(sourceParent, 'whatever-name.md')
  await writeFile(source, '---\nname: flat-import\ndescription: 扁平导入\n---\n\n正文\n')
  try {
    const result = await importSkill({
      root, scope: 'global', source: { type: 'file', path: source },
    })
    assert.equal(result.name, 'flat-import')
    // 落盘名取自 frontmatter，而不是源文件名 whatever-name.md。
    assert.equal(existsSync(join(root, 'flat-import.md')), true, '应按 frontmatter 名落成扁平文件')
    assert.equal(existsSync(join(root, 'whatever-name.md')), false)
    // 本层自己的定位必须能立刻找到它——否则导入完面板就点不动了。
    const target = await resolveSkillTarget({ name: 'flat-import', scope: 'global', root })
    assert.equal(target.kind, 'flat')
    assert.match(await readSkillFile(target), /扁平导入/)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(sourceParent, { recursive: true, force: true })
  }
})

test('imports a directory bundle with its resources', async () => {
  const root = await makeDestRoot()
  const source = await makeSourceBundle({ directory: 'renamed-on-disk', name: 'imported-bundle' })
  try {
    const result = await importSkill({
      root, scope: 'global', source: { type: 'directory', path: source },
    })
    assert.equal(result.name, 'imported-bundle')
    assert.equal(result.kind, 'bundle')
    assert.equal(existsSync(join(root, 'imported-bundle', 'SKILL.md')), true)
    // resources 必须一起带过去，否则技能正文里引用的脚本/文档会缺。
    assert.equal(await readFile(join(root, 'imported-bundle', 'references', 'note.md'), 'utf8'), 'note')

    const target = await resolveSkillTarget({ name: 'imported-bundle', scope: 'global', root })
    assert.equal(target.kind, 'bundle')
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(join(source, '..'), { recursive: true, force: true })
  }
})

test('imports a zip that wraps the skill in a directory', async () => {
  const root = await makeDestRoot()
  const parent = await mkdtemp(join(tmpdir(), 'dsh-src-'))
  const archive = join(parent, 'skill.zip')
  await writeFile(archive, makeZip([
    { name: 'wrapped-skill/SKILL.md', data: '---\nname: from-zip\ndescription: 来自压缩包\n---\n\n正文\n' },
    { name: 'wrapped-skill/scripts/run.sh', data: 'echo hi' },
  ]))
  try {
    const result = await importSkill({
      root, scope: 'global', source: { type: 'archive', path: archive },
    })
    assert.equal(result.name, 'from-zip')
    assert.equal(result.kind, 'bundle')
    assert.equal(await readFile(join(root, 'from-zip', 'scripts', 'run.sh'), 'utf8'), 'echo hi')
    // 压缩包的外层目录名不该成为落盘名。
    assert.equal(existsSync(join(root, 'wrapped-skill')), false)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(parent, { recursive: true, force: true })
  }
})

test('imports a zip whose SKILL.md sits at the archive root', async () => {
  const root = await makeDestRoot()
  const parent = await mkdtemp(join(tmpdir(), 'dsh-src-'))
  const archive = join(parent, 'flat-skill.zip')
  await writeFile(archive, makeZip([
    { name: 'SKILL.md', data: '---\nname: root-level\ndescription: 根层\n---\n\n正文\n' },
    { name: 'assets/logo.txt', data: 'logo' },
  ]))
  try {
    const result = await importSkill({ root, scope: 'global', source: { type: 'archive', path: archive } })
    assert.equal(result.name, 'root-level')
    assert.equal(existsSync(join(root, 'root-level', 'SKILL.md')), true, '仍应装成目录捆绑')
    assert.equal(await readFile(join(root, 'root-level', 'assets', 'logo.txt'), 'utf8'), 'logo')
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(parent, { recursive: true, force: true })
  }
})

test('imports a tar.gz archive too', async () => {
  const root = await makeDestRoot()
  const parent = await mkdtemp(join(tmpdir(), 'dsh-src-'))
  const archive = join(parent, 'skill.tgz')
  await writeFile(archive, gzipSync(makeTar([
    { name: 'g/SKILL.md', data: '---\nname: from-targz\ndescription: 来自 tgz\n---\n\n正文\n' },
  ])))
  try {
    const result = await importSkill({ root, scope: 'global', source: { type: 'archive', path: archive } })
    assert.equal(result.name, 'from-targz')
    assert.equal(existsSync(join(root, 'from-targz', 'SKILL.md')), true)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(parent, { recursive: true, force: true })
  }
})

test('refuses to import a skill whose frontmatter the host would reject', async () => {
  const root = await makeDestRoot()
  const sourceParent = await mkdtemp(join(tmpdir(), 'dsh-src-'))
  const source = join(sourceParent, 'broken.md')
  // 宿主会静默跳过它：导入进来只会得到一条「看不见的技能」，故必须在导入时挡住。
  await writeFile(source, '---\nname: Bad_Name\ndescription: 演示\n---\n\n正文\n')
  try {
    await assert.rejects(
      () => importSkill({ root, scope: 'global', source: { type: 'file', path: source } }),
      /Bad_Name/,
      '非法 frontmatter 必须被拒绝，且诊断要指出具体是哪个名字不合格',
    )
    assert.deepEqual(await readdir(root), [], '被拒绝的导入不得留下任何文件')
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(sourceParent, { recursive: true, force: true })
  }
})

test('refuses to import frontmatter that is broken in ways the name alone would not reveal', async () => {
  // 这一组专门守住「导入前跑完整 frontmatter 诊断」这件事：下面每条都有**合法**的名字，
  // 只有真正读懂 frontmatter 才能发现它们会让宿主静默跳过整条技能。
  const broken = [
    ['缺少 description', '---\nname: looks-fine\n---\n\n正文\n', /description/],
    ['完全没有 frontmatter', '# 只是正文\n', /frontmatter/],
    ['YAML 不合法', '---\nname: [unclosed\ndescription: y\n---\n\n正文\n', /YAML/],
    ['用了驼峰 invocation 键', '---\nname: looks-fine\ndescription: 演示\ndisableModelInvocation: true\n---\n\n正文\n', /disable-model-invocation/],
    ['invocation 值不是布尔', '---\nname: looks-fine\ndescription: 演示\nuser-invocable: maybe\n---\n\n正文\n', /user-invocable/],
  ]
  for (const [label, text, expected] of broken) {
    const root = await makeDestRoot()
    const parent = await mkdtemp(join(tmpdir(), 'dsh-src-'))
    const source = join(parent, 'looks-fine.md')
    await writeFile(source, text)
    try {
      await assert.rejects(
        () => importSkill({ root, scope: 'global', source: { type: 'file', path: source } }),
        expected,
        `${label}：必须被拒绝（否则会装进一条宿主永远看不见的技能）`,
      )
      assert.deepEqual(await readdir(root), [], `${label}：失败不得留下残骸`)
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(parent, { recursive: true, force: true })
    }
  }
})

test('refuses to overwrite an existing skill instead of silently replacing it', async () => {
  const root = await makeRoot() // 已含 zhanggui 目录捆绑与 flat-one.md
  const sourceParent = await mkdtemp(join(tmpdir(), 'dsh-src-'))
  const source = join(sourceParent, 'zhanggui.md')
  await writeFile(source, '---\nname: zhanggui\ndescription: 冒充\n---\n\n恶意替换\n')
  try {
    await assert.rejects(
      () => importSkill({ root, scope: 'global', source: { type: 'file', path: source } }),
      /已存在|exists/,
      '同名技能已存在时必须拒绝，不能静默覆盖用户的技能',
    )
    // 原技能必须原封不动。
    assert.match(await readFile(join(root, 'zhanggui', 'SKILL.md'), 'utf8'), /demo/)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(sourceParent, { recursive: true, force: true })
  }
})

test('refuses to import into a read-only bundled root', async () => {
  const root = await makeDestRoot()
  const source = await makeSourceBundle({ name: 'into-bundled' })
  try {
    await assert.rejects(
      () => importSkill({
        root, scope: 'global', writable: false, source: { type: 'directory', path: source },
      }),
      /只读|read-only/,
    )
    assert.deepEqual(await readdir(root), [], '只读根不得被写入')
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(join(source, '..'), { recursive: true, force: true })
  }
})

test('refuses an archive with no SKILL.md', async () => {
  const root = await makeDestRoot()
  const parent = await mkdtemp(join(tmpdir(), 'dsh-src-'))
  const archive = join(parent, 'no-skill.zip')
  await writeFile(archive, makeZip([{ name: 'readme.md', data: '只是一个 readme' }]))
  try {
    await assert.rejects(
      () => importSkill({ root, scope: 'global', source: { type: 'archive', path: archive } }),
      /SKILL\.md/,
    )
    assert.deepEqual(await readdir(root), [], '失败不得留下残骸')
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(parent, { recursive: true, force: true })
  }
})

test('refuses an archive holding several skills rather than picking one', async () => {
  // 一个包多个技能时静默挑一个等于猜；导入的目标必须是确定的。
  const root = await makeDestRoot()
  const parent = await mkdtemp(join(tmpdir(), 'dsh-src-'))
  const archive = join(parent, 'two.zip')
  await writeFile(archive, makeZip([
    { name: 'a/SKILL.md', data: '---\nname: skill-a\ndescription: A\n---\n' },
    { name: 'b/SKILL.md', data: '---\nname: skill-b\ndescription: B\n---\n' },
  ]))
  try {
    await assert.rejects(
      () => importSkill({ root, scope: 'global', source: { type: 'archive', path: archive } }),
      /多个|多个技能|无法确定/,
    )
    assert.deepEqual(await readdir(root), [], '失败不得留下残骸')
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(parent, { recursive: true, force: true })
  }
})

test('refuses a directory import that has no SKILL.md', async () => {
  const root = await makeDestRoot()
  const parent = await mkdtemp(join(tmpdir(), 'dsh-src-'))
  const directory = join(parent, 'not-a-skill')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'notes.md'), 'x')
  try {
    await assert.rejects(
      () => importSkill({ root, scope: 'global', source: { type: 'directory', path: directory } }),
      /SKILL\.md/,
    )
    assert.deepEqual(await readdir(root), [], '失败不得留下残骸')
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(parent, { recursive: true, force: true })
  }
})

test('refuses a directory import whose references point outside the skill tree', async () => {
  // 与压缩包同一条纪律（skills-archive 拒绝符号链接）：克隆下来的技能仓库可以带链接，
  // 而 fs.cp 默认保留链接，于是技能里的 references/... 可能指向技能根之外的文件——
  // 技能正文会把读者引向不该读的内容。宁可整包拒绝，也不静默解引用（那等于把外部
  // 文件的内容复制进用户的技能目录）。
  //
  // 用 junction 造链接：Windows 上真正的 file symlink 需要 SeCreateSymbolicLinkPrivilege
  // （实测本机 EPERM），而目录 junction 不需要；POSIX 上 type 参数被忽略，建的是普通符号链接。
  const root = await makeDestRoot()
  const parent = await mkdtemp(join(tmpdir(), 'dsh-src-'))
  const secrets = await mkdtemp(join(tmpdir(), 'dsh-outside-'))
  const directory = join(parent, 'linked-skill')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'SKILL.md'), '---\nname: linked\ndescription: 带链接\n---\n\n正文\n')
  await writeFile(join(secrets, 'credentials.txt'), 'top secret')
  try {
    await symlink(secrets, join(directory, 'references'), 'junction')
  } catch (error) {
    // 环境连 junction 都不给建：这条用例无法表达它的意图，明说而不是静默放过。
    await rm(root, { recursive: true, force: true })
    await rm(parent, { recursive: true, force: true })
    await rm(secrets, { recursive: true, force: true })
    throw new Error(`本环境无法创建链接（${error.code}），该安全用例未能执行`)
  }
  try {
    await assert.rejects(
      () => importSkill({ root, scope: 'global', source: { type: 'directory', path: directory } }),
      /符号链接/,
      '带链接的目录必须整包拒绝，而不是把链接复制过去',
    )
    assert.deepEqual(await readdir(root), [], '失败不得留下残骸')
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(parent, { recursive: true, force: true })
    await rm(secrets, { recursive: true, force: true })
  }
})

test('refuses a frontmatter name that would escape the destination root', async () => {
  // frontmatter 是外部输入：恶意的技能名不能借导入写到根目录之外。
  const root = await makeDestRoot()
  const parent = await mkdtemp(join(tmpdir(), 'dsh-src-'))
  const source = join(parent, 'evil.md')
  await writeFile(source, '---\nname: "../escaped"\ndescription: 越界\n---\n\n正文\n')
  const outside = join(root, '..', 'escaped.md')
  try {
    await assert.rejects(
      () => importSkill({ root, scope: 'global', source: { type: 'file', path: source } }),
      /escaped/,
      '越界的 frontmatter 名必须被拒绝，并指出是哪个名字',
    )
    assert.equal(existsSync(outside), false, '越界文件不得被写出')
    assert.deepEqual(await readdir(root), [])
  } finally {
    await rm(outside, { force: true })
    await rm(root, { recursive: true, force: true })
    await rm(parent, { recursive: true, force: true })
  }
})

test('leaves no staging directory behind in the destination root', async () => {
  // 解包需要暂存目录。若把暂存放进技能根，宿主的目录扫描会把它当成一条技能
  // （宿主只跳过 .system，其余目录都按 <dir>/SKILL.md 解析）。
  const root = await makeDestRoot()
  const parent = await mkdtemp(join(tmpdir(), 'dsh-src-'))
  const archive = join(parent, 'skill.zip')
  await writeFile(archive, makeZip([
    { name: 's/SKILL.md', data: '---\nname: clean-import\ndescription: 干净导入\n---\n' },
  ]))
  try {
    await importSkill({ root, scope: 'global', source: { type: 'archive', path: archive } })
    assert.deepEqual(await readdir(root), ['clean-import'], '根目录里只该有装好的那一个技能')
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(parent, { recursive: true, force: true })
  }
})

test('creates the destination root when importing into a scope that does not exist yet', async () => {
  // 用户选中的作用域根（如 <project>/.agents/skills）可能还不存在——首次导入要能建出来。
  // 这条同时守住「暂存目录不得放在技能根内」：若暂存先于建根，这里会直接失败。
  const parent = await mkdtemp(join(tmpdir(), 'dsh-src-'))
  const root = join(parent, 'not-created-yet', 'skills')
  const archive = join(parent, 'skill.zip')
  await writeFile(archive, makeZip([
    { name: 's/SKILL.md', data: '---\nname: fresh-scope\ndescription: 新作用域\n---\n' },
  ]))
  try {
    const result = await importSkill({ root, scope: 'project', source: { type: 'archive', path: archive } })
    assert.equal(result.name, 'fresh-scope')
    assert.equal(existsSync(join(root, 'fresh-scope', 'SKILL.md')), true)
    assert.deepEqual(await readdir(root), ['fresh-scope'])
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

