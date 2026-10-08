// frontmatter 校验与诊断。
//
// 为什么需要这一层：宿主发现非法技能时只做 `ctx.logger.warn(...)` 然后 **跳过**整条
// 技能（dsh-skill-filesystem/lib/index.js:664-705）。用户和模型都看不到那条警告——技能
// 就是「莫名其妙不出现」。本层把这些静默跳过翻译成可展示的逐条诊断，这是「管理」面板
// 相对模型可见目录的第一个独有价值。
//
// 判定规则**一律照抄宿主源码**，不照抄外部规范（Claude Code 的 when_to_use 在这里无效）：
//   :780-793 parseFrontmatter  首行必须恰为 `---`，必须能找到同为 `---` 的结束行，
//                              YAML 结果必须是对象（非 null / 非数组）
//   :841-844 stringField       name / description 必须是非空字符串
//   dsh-skill:17 isSkillName   /^[a-z0-9]+(?:-[a-z0-9]+)*$/
//   :845-848 optionalString    whenToUse 必须是**非空字符串**，否则静默丢弃（驼峰！）
//   :849-878 parseInvocationPolicy
//                              disable-model-invocation / user-invocable 为连字符式；
//                              驼峰式 disableModelInvocation / modelInvocable /
//                              userInvocable 一律**抛错**（= 整条技能被跳过）
//   :879-883 optionalMetadata  metadata 必须是普通对象，否则静默丢弃
import assert from 'node:assert/strict'
import test from 'node:test'
import { diagnoseSkill, parseSkillFrontmatter } from '../lib/skills-frontmatter.js'

/** 拼一份技能原文。 */
function skill(frontmatter, body = '\n正文\n') {
  return `---\n${frontmatter}\n---\n${body}`
}

/** 取诊断里的全部 code。 */
function codes(result) {
  return result.issues.map((issue) => issue.code)
}

test('parses a valid skill the way the host does', () => {
  const result = diagnoseSkill(skill('name: my-skill\ndescription: 演示技能\nwhenToUse: 当用户要演示时'))
  assert.equal(result.ok, true)
  assert.deepEqual(result.issues, [], '合法技能不得产生任何诊断')
  assert.equal(result.name, 'my-skill')
  assert.equal(result.description, '演示技能')
  assert.equal(result.whenToUse, '当用户要演示时')
  // 宿主对正文做 trim（:703 content: parsed.body.trim()）。
  assert.equal(result.body, '正文')
})

test('accepts a skill with only the two required fields', () => {
  const result = diagnoseSkill(skill('name: minimal\ndescription: 最少字段'))
  assert.equal(result.ok, true)
  // 宿主默认：modelInvocable = disable !== true → true；userInvocable = user !== false → true。
  assert.deepEqual(result.invocation, { modelInvocable: true, userInvocable: true })
})

test('reports the absence of frontmatter instead of guessing', () => {
  const result = diagnoseSkill('# 没有 frontmatter 的技能\n\n正文\n')
  assert.equal(result.ok, false)
  assert.deepEqual(codes(result), ['frontmatter-missing'])
  // 诊断要能直接展示，故必须带人话消息。
  assert.match(result.issues[0].message, /frontmatter/)
  assert.equal(result.issues[0].level, 'error')
})

test('reports an unterminated frontmatter block', () => {
  // 开了 `---` 却没有结束行：宿主 findClosingFrontmatter 返回 undefined → 整条跳过。
  const result = diagnoseSkill('---\nname: x\ndescription: y\n\n正文\n')
  assert.equal(result.ok, false)
  assert.deepEqual(codes(result), ['frontmatter-missing'])
})

test('reports invalid YAML separately from missing frontmatter', () => {
  // 宿主对这两种情况给的是**不同**的 warn（:670-678），故诊断也必须能区分。
  const result = diagnoseSkill(skill('name: [unclosed\ndescription: y'))
  assert.equal(result.ok, false)
  assert.deepEqual(codes(result), ['frontmatter-invalid-yaml'])
})

test('reports frontmatter that is not a mapping', () => {
  // YAML 合法但不是对象：宿主 :788 判掉（非对象 / null / 数组）。
  const result = diagnoseSkill(skill('- 只是一个列表项'))
  assert.equal(result.ok, false)
  assert.deepEqual(codes(result), ['frontmatter-not-mapping'])
})

test('requires both name and description', () => {
  assert.deepEqual(codes(diagnoseSkill(skill('whenToUse: 只有它'))), ['name-missing', 'description-missing'])
  assert.deepEqual(codes(diagnoseSkill(skill('name: only-name'))), ['description-missing'])
  assert.deepEqual(codes(diagnoseSkill(skill('description: 只有描述'))), ['name-missing'])
})

test('rejects names that the host would refuse', () => {
  // 宿主 isSkillName 只接受 kebab-case（dsh-skill:17）。
  for (const name of ['My-Skill', 'my_skill', 'my skill', 'my--skill', '-my', 'my-', '技能']) {
    const result = diagnoseSkill(skill(`name: "${name}"\ndescription: 演示`))
    assert.equal(result.ok, false, `${name} 必须被拒绝`)
    assert.deepEqual(codes(result), ['name-invalid'], `${name} 的诊断 code 应为 name-invalid`)
  }
})

test('rejects a name or description that is not a non-empty string', () => {
  // 宿主 stringField 要求非空字符串：数字 / 空串都算缺失。
  assert.deepEqual(codes(diagnoseSkill(skill('name: 123\ndescription: 演示'))), ['name-missing'])
  assert.deepEqual(codes(diagnoseSkill(skill('name: ""\ndescription: 演示'))), ['name-missing'])
  assert.deepEqual(codes(diagnoseSkill(skill('name: ok-name\ndescription: ""'))), ['description-missing'])
})

test('warns about the snake_case when_to_use that Claude Code uses', () => {
  // SPEC 约束 4 的核心陷阱：外部规范是 when_to_use，DSH 只认驼峰 whenToUse。
  // 直接从 Claude Code 抄来的技能会静默丢掉这个字段——必须明说。
  const result = diagnoseSkill(skill('name: ported\ndescription: 从别处抄来的\nwhen_to_use: 当用户要移植时'))
  assert.equal(result.ok, true, '它不是致命错误：宿主照样注册这条技能')
  assert.deepEqual(codes(result), ['when-to-use-snake-case'])
  assert.equal(result.issues[0].level, 'warning')
  assert.equal(result.whenToUse, undefined, '不得把 when_to_use 当 whenToUse 用')
})

test('warns when whenToUse is present but not a non-empty string', () => {
  // 宿主 optionalString 静默丢弃非字符串/空串（:845-848）→ 字段消失但技能仍在。
  const result = diagnoseSkill(skill('name: warn-when\ndescription: 演示\nwhenToUse: ""'))
  assert.equal(result.ok, true)
  assert.deepEqual(codes(result), ['when-to-use-ignored'])
  assert.equal(result.whenToUse, undefined)
})

test('rejects the legacy camelCase invocation keys the host refuses', () => {
  // 宿主 :850-861 对这三个驼峰键**抛错**，整条技能被跳过——最严重的一类。
  const cases = [
    ['disableModelInvocation: true', 'disable-model-invocation'],
    ['modelInvocable: false', 'disable-model-invocation'],
    ['userInvocable: false', 'user-invocable'],
  ]
  for (const [line, canonical] of cases) {
    const result = diagnoseSkill(skill(`name: legacy\ndescription: 演示\n${line}`))
    assert.equal(result.ok, false, `${line} 必须导致整条技能被跳过`)
    assert.deepEqual(codes(result), ['invocation-legacy-key'])
    // 诊断必须指出正确写法，否则用户不知道该怎么改。
    assert.match(result.issues[0].message, new RegExp(canonical))
  }
})

test('maps the canonical invocation keys to what the host computes', () => {
  const disabled = diagnoseSkill(skill('name: no-model\ndescription: 演示\ndisable-model-invocation: true'))
  assert.deepEqual(disabled.invocation, { modelInvocable: false, userInvocable: true })

  const userOff = diagnoseSkill(skill('name: no-user\ndescription: 演示\nuser-invocable: false'))
  assert.deepEqual(userOff.invocation, { modelInvocable: true, userInvocable: false })

  const both = diagnoseSkill(skill('name: neither\ndescription: 演示\ndisable-model-invocation: true\nuser-invocable: false'))
  assert.deepEqual(both.invocation, { modelInvocable: false, userInvocable: false })
})

test('coerces boolean-ish invocation values exactly like the host', () => {
  // 宿主 frontmatterBoolean 接受 true/false、1/0 与 yes/on/no/off 等字符串（:863-878）。
  for (const truthy of ['true', 'yes', 'on', '1', 'TRUE']) {
    const result = diagnoseSkill(skill(`name: coerced\ndescription: 演示\ndisable-model-invocation: ${truthy}`))
    assert.equal(result.invocation.modelInvocable, false, `${truthy} 应被当成 true`)
  }
  for (const falsy of ['false', 'no', 'off', '0']) {
    const result = diagnoseSkill(skill(`name: coerced\ndescription: 演示\ndisable-model-invocation: ${falsy}`))
    assert.equal(result.invocation.modelInvocable, true, `${falsy} 应被当成 false`)
  }
})

test('rejects an invocation value that cannot be read as a boolean', () => {
  // 宿主 frontmatterBoolean 对其它值抛 TypeError → 整条技能被跳过。
  const result = diagnoseSkill(skill('name: bad-bool\ndescription: 演示\ndisable-model-invocation: maybe'))
  assert.equal(result.ok, false)
  assert.deepEqual(codes(result), ['invocation-invalid-boolean'])
  assert.match(result.issues[0].message, /disable-model-invocation/)
})

test('accepts object metadata and warns when metadata is not an object', () => {
  const good = diagnoseSkill(skill('name: with-meta\ndescription: 演示\nmetadata:\n  owner: team-a'))
  assert.equal(good.ok, true)
  assert.deepEqual(good.metadata, { owner: 'team-a' })

  const bad = diagnoseSkill(skill('name: bad-meta\ndescription: 演示\nmetadata: just-a-string'))
  assert.equal(bad.ok, true, '宿主只是丢弃 metadata，不跳过技能')
  assert.deepEqual(codes(bad), ['metadata-ignored'])
  assert.equal(bad.metadata, undefined)
})

test('parses frontmatter written with CRLF line endings', () => {
  // 本仓库在 Windows 上开发，用户手写的技能很可能是 CRLF；宿主专门做了 `\r` 容错（:783/:800）。
  const raw = '---\r\nname: crlf-skill\r\ndescription: 演示\r\n---\r\n\r\n正文\r\n'
  const result = diagnoseSkill(raw)
  assert.equal(result.ok, true, `CRLF 技能必须被接受，实际诊断：${JSON.stringify(result.issues)}`)
  assert.equal(result.name, 'crlf-skill')
  assert.equal(result.body, '正文')
})

test('exposes the parse step on its own for callers that only need the mapping', () => {
  const parsed = parseSkillFrontmatter(skill('name: raw\ndescription: 演示', '\n正文\n'))
  assert.equal(parsed.ok, true)
  assert.deepEqual(parsed.data, { name: 'raw', description: '演示' })
  assert.equal(parsed.body, '\n正文\n', 'parseSkillFrontmatter 不做 trim——trim 是宿主读取正文时的事')

  const missing = parseSkillFrontmatter('没有 frontmatter')
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'frontmatter-missing')
})

test('orders issues so the first one explains why the host skipped the skill', () => {
  // 面板只突出显示第一条时，它必须就是宿主跳过的原因。
  const result = diagnoseSkill(skill('name: Bad_Name\nwhenToUse: 演示'))
  assert.equal(result.ok, false)
  assert.equal(result.issues[0].code, 'description-missing', '按宿主校验顺序：name/description 先于名字语法')
  assert.equal(result.issues[0].level, 'error')
})
