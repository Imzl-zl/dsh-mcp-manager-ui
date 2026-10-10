// 许可门禁与风险扫描（纯函数）。
//
// 两条纪律来自 SPEC：
//   约束 8 —— **许可门禁是硬闸门**。`anthropics/skills` 的 docx/pdf/pptx/xlsx 的 LICENSE.txt
//     禁止「在服务之外保留副本」，默认不可安装；而同仓库的 `algorithmic-art` 是 Apache-2.0。
//     所以必须**逐技能**判定，不得按仓库聚合——同一仓库里既有能装的也有不能装的。
//   约束 12/13 —— 市场的披露项要如实：技能正文会作为指令进入模型上下文，这是第一等披露项。
//
// 为什么是纯函数：它要能在没有网络、没有磁盘的情况下被目录生成与宿主 RPC 反复调用。
// 「不联网、不读远端」是 TODO row 6 的边界；许可事实由 row 4 的 YAML 逐条人工核实后喂进来。
import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyLicense, resolveGoverningLicense, scanSkillRisks } from '../lib/skills-admission.js'

test('accepts the common permissive licenses', () => {
  for (const spdx of ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'BSD-2-Clause', 'ISC', 'MPL-2.0', 'CC0-1.0', 'Unlicense', '0BSD']) {
    const verdict = classifyLicense({ spdx })
    assert.equal(verdict.verdict, 'permissive', `${spdx} 应判定为可安装`)
    assert.equal(verdict.installable, true, `${spdx} 应可安装`)
    assert.equal(verdict.spdx, spdx, `${spdx} 应原样回传 spdx`)
  }
})

test('treats a declared license as case- and space-insensitive', () => {
  // 目录是人工维护的，写法不会永远规整；大小写与空白差异不该改变判定。
  for (const spdx of ['mit', 'Apache 2.0', ' apache-2.0 ', 'BSD 3-Clause']) {
    assert.equal(classifyLicense({ spdx }).installable, true, `${spdx} 应被规范化后接受`)
  }
})

test('blocks a license that forbids keeping a copy outside the vendor service', () => {
  // SPEC 约束 8 的核心案例。这段文字取自 anthropics/skills 文档技能的 LICENSE.txt：
  // 它允许在 Anthropic 的服务内使用，但**禁止**在服务之外保留副本——装到本地属违约。
  const text = `© 2025 Anthropic PBC. All rights reserved.
You may use this material solely within Anthropic's Services.
You may not retain copies of this material outside of the Services.`
  const verdict = classifyLicense({ spdx: 'Proprietary', text })
  assert.equal(verdict.verdict, 'forbidden')
  assert.equal(verdict.installable, false, '禁止保留副本的许可必须默认不可安装')
  // 市场卡片要显示「为什么不能装」，所以理由必须是可展示的人话。
  assert.match(verdict.reason, /副本|保留|服务/)
})

test('blocks a source-available license even when it calls itself open', () => {
  // 话术陷阱：自述「open」但带非商业/禁再分发条款的许可，不能因为字面含 open 就放行。
  const text = `This is an open and source-available license.
You may not redistribute this software.
Non-commercial use only.`
  assert.equal(classifyLicense({ spdx: 'Source-Available', text }).installable, false)
})

test('blocks the verbatim anthropics/skills restriction text', () => {
  // 这条用**逐字原文**，不用我改写的简化版：上面那条用的是我自己的措辞，很可能比真实
  // 条款「更好匹配」——真正的风险是真实文本的句法与我预想的不同，于是门禁漏掉它。
  // 原文取自 anthropics/skills 的 skills/docx/LICENSE.txt（与 pdf/pptx/xlsx 逐字节相同），
  // 经 git clone 本地核对（commit 683bc88e，2026-10-05）。
  const verbatim = `© 2025 Anthropic, PBC. All rights reserved.

ADDITIONAL RESTRICTIONS: Notwithstanding anything in the Agreement to the contrary, users may not:
- Extract these materials from the Services or retain copies of these materials outside the Services
- Reproduce or copy these materials, except for temporary copies created automatically during authorized use of the Services
- Create derivative works based on these materials
- Distribute, sublicense, or transfer these materials to any third party
- Make, offer to sell, sell, or import any inventions embodied in these materials
- Reverse engineer, decompile, or disassemble these materials.

The receipt, viewing, or possession of these materials does not convey or imply any license or right
beyond those expressly granted above. Anthropic retains all right, title, and interest.`
  const verdict = classifyLicense({ spdx: 'Proprietary', text: verbatim })
  assert.equal(verdict.verdict, 'forbidden', '逐字原文必须被判为 forbidden')
  assert.equal(verdict.installable, false, '这份许可禁止留存副本与再分发，必须硬阻断')
})

test('the verbatim restriction is caught by each of its independent clauses', () => {
  // 三条子句各自都足以拒绝。分开测是为了定位：将来若只放宽了其中一条的匹配，
  // 这里能指出是哪一条失守，而不是笼统地「整段没匹配上」。
  const clauses = [
    ['留存副本', 'users may not: retain copies of these materials outside the Services'],
    ['禁止复制', 'You may not reproduce or copy these materials except as authorized'],
    ['禁止再分发', 'You may not distribute, sublicense, or transfer these materials to any third party'],
  ]
  for (const [label, text] of clauses) {
    assert.equal(classifyLicense({ spdx: 'Apache-2.0', text }).installable, false,
      `${label}：即便声称 Apache-2.0，带此条款也必须拒绝`)
  }
})

test('does not falsely block real permissive license texts', () => {
  // 反向风险同样真实：门禁过严会把合法技能全毙掉，市场直接空掉。
  // 下面三段是**逐字原文**（git 克隆/官方文本），都含 `All rights reserved` 或 `retain`
  // 这类看起来可疑、实则正常的措辞——正则若写成宽泛的 /retain|outside|reserved/ 就会误杀。
  const bsd2 = `Copyright (c) 2026 Example
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted
provided that the following conditions are met:
1. Redistributions of source code must retain the above copyright notice, this list of conditions
   and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice, this list of
   conditions and the following disclaimer in the documentation and/or other materials provided
   with the distribution.`

  const mit = `MIT License

Copyright (c) 2026 Example

Permission is hereby granted, free of charge, to any person obtaining a copy of this software
and associated documentation files (the "Software"), to deal in the Software without restriction.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.`

  const apache = `Apache License
Version 2.0, January 2004
http://www.apache.org/licenses/

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at
    http://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software distributed under the License
is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND.`

  for (const [label, spdx, text] of [['BSD-2', 'BSD-2-Clause', bsd2], ['MIT', 'MIT', mit], ['Apache-2.0', 'Apache-2.0', apache]]) {
    const verdict = classifyLicense({ spdx, text })
    assert.equal(verdict.installable, true, `${label} 是合法宽松许可，不得被误杀（实际：${verdict.verdict} / ${verdict.reason}）`)
  }
})

test('a bare proprietary notice with no restrictions is still blocked by the allowlist', () => {
  // 纯专有文本没有显式限制时，靠的是「不在白名单 → unknown → 不可安装」（fail-closed），
  // 而不是靠某句关键词。这条钉住那条兜底路径真的成立。
  const bare = 'Copyright (c) 2026 Some Corp. All rights reserved.'
  const verdict = classifyLicense({ spdx: 'Proprietary', text: bare })
  assert.equal(verdict.installable, false, '未列入白名单的专有许可必须不可安装')
  assert.equal(verdict.verdict, 'unknown')
})

test('refuses to install when no license is declared at all', () => {
  // 「未声明」默认不可安装：没有许可就是没有授权，不是「随便用」。
  const verdict = classifyLicense({})
  assert.equal(verdict.verdict, 'unknown')
  assert.equal(verdict.installable, false, '未声明许可必须默认不可安装')
  assert.match(verdict.reason, /未声明|找不到|无法判定/)
})

test('refuses to install an unrecognised license string', () => {
  // 认不出就不放行——白名单之外一律拒绝，而不是「没见过的应该没问题」。
  const verdict = classifyLicense({ spdx: 'WTFPL-2.0-Custom-Variant' })
  assert.equal(verdict.verdict, 'unknown')
  assert.equal(verdict.installable, false)
})

test('judges each skill independently rather than aggregating by repository', () => {
  // SPEC 约束 8 明确要求逐技能判定：同一个 anthropics/skills 里，
  // 文档技能是专有许可（禁装），algorithmic-art 是 Apache-2.0（可装）。
  const proprietary = classifyLicense({ spdx: 'Proprietary', text: 'You may not retain copies of this material outside of the Services.' })
  const apache = classifyLicense({ spdx: 'Apache-2.0' })
  assert.equal(proprietary.installable, false)
  assert.equal(apache.installable, true, '同仓库的 Apache-2.0 技能必须仍可安装（不得按仓库聚合）')
})

test('a permissive declaration does not override explicit no-copy text', () => {
  // 最危险的一种组合：目录里写 MIT，但许可证原文禁止保留副本。
  // 文字冲突时以**更严**的一方为准——宁可少收，不可错收。
  const verdict = classifyLicense({
    spdx: 'MIT',
    text: 'You may not retain copies of this material outside of the Services.',
  })
  assert.equal(verdict.installable, false, '声明与原文冲突时必须按更严的判')
  assert.equal(verdict.verdict, 'forbidden')
})

test('reports which scripts and declared tool permissions a skill brings', () => {
  // 安装确认弹窗要把这三件事说清（见原型 unified-design.html 的「它会带来什么」）：
  // 进入模型上下文 / 含可执行片段 / 声明的工具权限。
  const risks = scanSkillRisks({
    files: ['SKILL.md', 'scripts/build.sh', 'scripts/lib/helper.mjs', 'references/notes.md'],
    frontmatter: { name: 'demo', description: '演示' },
  })
  assert.deepEqual(risks.scripts, ['scripts/build.sh', 'scripts/lib/helper.mjs'])
  assert.equal(risks.hasScripts, true)
  // 「进入模型上下文」是无条件的：技能正文本身就是注入会话的指令。
  assert.equal(risks.entersModelContext, true)
  // 有可执行片段是披露项，不是禁止项。
  assert.equal(risks.level, 'disclosure')
  assert.deepEqual(risks.allowedTools, [])
})

test('a skill with no scripts and no tool grants has nothing to disclose', () => {
  const risks = scanSkillRisks({
    files: ['SKILL.md', 'references/notes.md'],
    frontmatter: { name: 'plain', description: '纯文档技能' },
  })
  assert.deepEqual(risks.scripts, [])
  assert.equal(risks.hasScripts, false)
  assert.deepEqual(risks.allowedTools, [])
  // 绿灯只表示「没有**额外**披露项」；正文进入上下文是技能的天性，不算披露项，
  // 否则每一条技能都是黄灯，红绿灯就失去区分力了。
  assert.equal(risks.level, 'none')
})

test('reads the tool permissions a skill declares', () => {
  // DSH 宿主**不读** allowed-tools（dsh-skill-filesystem 只取 name/description/whenToUse/
  // invocation/metadata），所以这是「作者声明的意图」而非宿主强制的权限。正因为宿主不强制，
  // 市场才必须把它披露出来让用户自己判断。
  const risks = scanSkillRisks({
    files: ['SKILL.md'],
    frontmatter: { name: 'runner', description: '演示', 'allowed-tools': ['Bash', 'Write'] },
  })
  assert.deepEqual(risks.allowedTools, ['Bash', 'Write'])
  assert.equal(risks.level, 'disclosure', '声明了工具权限就必须披露')
})

test('an empty or malformed allowed-tools declaration is not reported as a grant', () => {
  // 缺省 / 空串 / 空数组都不算「声明了权限」，否则会把清白技能标成黄灯。
  for (const value of [undefined, '', [], 'Bash', null]) {
    const risks = scanSkillRisks({
      files: ['SKILL.md'],
      frontmatter: { name: 'x', description: 'y', ...(value === undefined ? {} : { 'allowed-tools': value }) },
    })
    const expected = value === 'Bash' ? ['Bash'] : []
    assert.deepEqual(risks.allowedTools, expected, `allowed-tools=${JSON.stringify(value)} 的解析不符合预期`)
  }
})

test('tolerates being handed nothing instead of throwing', () => {
  // 市场首屏与宿主 RPC 都可能在没有完整信息时调用它；抛错会让整个面板打不开。
  const risks = scanSkillRisks({})
  assert.deepEqual(risks.scripts, [])
  assert.deepEqual(risks.allowedTools, [])
  assert.equal(risks.level, 'none')
})

test('does not mistake a similarly named path for a scripts directory', () => {
  // `myscripts/x.sh` 与 `scripts-extra/x.sh` 都不是技能根的 scripts/ 目录。
  // 前缀匹配会把它们误报成可执行片段，让用户对一条纯文档技能产生不必要的警惕。
  const risks = scanSkillRisks({
    files: ['SKILL.md', 'myscripts/a.sh', 'scripts-extra/b.sh', 'docs/scripts/c.sh'],
    frontmatter: { name: 'x', description: 'y' },
  })
  assert.deepEqual(risks.scripts, [], '只有技能根的 scripts/ 下才算可执行片段')
})

test('flags a skill whose scripts ship alongside the bundle', () => {
  const risks = scanSkillRisks({
    files: ['SKILL.md', 'scripts/run.py'],
    frontmatter: { name: 'x', description: 'y' },
  })
  assert.equal(risks.level, 'disclosure')
  assert.equal(risks.hasScripts, true)
})

test('a license file in the skill directory governs over the frontmatter', () => {
  // 真实样本（github/awesome-copilot 的 anti-ui-slop）：目录的 frontmatter 写 `license: MIT`，
  // 同目录却带完整的 Apache-2.0 LICENSE 与第三方 NOTICE。**以实际存在的许可文件为准。**
  // 这条不是假设——只信 frontmatter 的门禁会把它当 MIT 放行，而它实际上带 Apache-2.0 §4 的
  // NOTICE 保留义务。所以「文件优先于 frontmatter」必须是代码里的规则，不能只是注释。
  const resolved = resolveGoverningLicense({
    frontmatterLicense: 'MIT',
    licenseFile: { path: 'skills/anti-ui-slop/LICENSE', spdx: 'Apache-2.0' },
  })
  assert.equal(resolved.spdx, 'Apache-2.0', '许可文件存在时以文件为准')
  assert.equal(resolved.basis, 'license-file')
  // 冲突本身要能被 UI 披露出来，否则用户看不到「声明与实际不一致」这个风险信号。
  assert.equal(resolved.conflict, true, '声明与文件不一致必须标记冲突')
})

test('without a license file the frontmatter declaration is used', () => {
  const resolved = resolveGoverningLicense({ frontmatterLicense: 'MIT' })
  assert.equal(resolved.spdx, 'MIT')
  assert.equal(resolved.basis, 'frontmatter')
  assert.equal(resolved.conflict, false)
})

test('without either statement the license is unverified, never assumed', () => {
  // 真实样本：anthropics/skills 的 doc-coauthoring —— 无 LICENSE 文件、frontmatter 也无 license。
  // 此时**不得**回落到仓库级许可（那正是 SPEC 约束 8 禁止的按仓库聚合）。
  const resolved = resolveGoverningLicense({
    frontmatterLicense: undefined,
    repositoryLicense: 'Apache-2.0',
  })
  assert.equal(resolved.spdx, 'Unverified', '没有逐技能声明就是未核实，不得回落到仓库许可')
  assert.equal(resolved.basis, 'none')
  // 回落会让它被当成可安装——这里钉住门禁结果。
  assert.equal(classifyLicense({ spdx: resolved.spdx }).installable, false)
})

test('the pointer form "Complete terms in LICENSE.txt" is not treated as a license', () => {
  // youtube/awesome-copilot 里真实存在的写法：frontmatter 写指针，真正的许可在文件里。
  // 把指针当许可名会让门禁认不出它（→ 被当作 unknown 拦下），所以必须由文件解析结果覆盖。
  const resolved = resolveGoverningLicense({
    frontmatterLicense: 'Complete terms in LICENSE.txt',
    licenseFile: { path: 'skills/quality-playbook/LICENSE.txt', spdx: 'Apache-2.0' },
  })
  assert.equal(resolved.spdx, 'Apache-2.0')
  assert.equal(resolved.basis, 'license-file')
  // 指针与解析结果「不同名」不算冲突：指针本来就不是许可名。
  assert.equal(resolved.conflict, false, '指针式声明不应被报成冲突')
})

test('a license file whose text is restrictive wins even if frontmatter claims MIT', () => {
  // 组合起来的最危险情形：frontmatter 说 MIT，文件正文却是禁止留存副本的专有条款。
  // 解析出的 spdx 只是标签，真正的判定仍要过 classifyLicense 的正文检查。
  const resolved = resolveGoverningLicense({
    frontmatterLicense: 'MIT',
    licenseFile: {
      path: 'skills/docx/LICENSE.txt',
      spdx: 'Proprietary',
      text: 'users may not: Extract these materials from the Services or retain copies of these materials outside the Services',
    },
  })
  assert.equal(resolved.spdx, 'Proprietary')
  assert.equal(classifyLicense({ spdx: resolved.spdx, text: resolved.text }).installable, false,
    '文件正文禁止留存副本时必须不可安装')
})
