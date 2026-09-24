import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parse } from 'yaml'

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
const hostIndex = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')
const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8')
const readmeEn = await readFile(new URL('../README.en.md', import.meta.url), 'utf8')
// 深层设计（共享连接模型、连接状态语义、已知限制、依赖细节）单独成文，
// README 只留使用路径；下面这些断言跟着内容走，就近检查。
const designDoc = await readFile(new URL('../docs/design.md', import.meta.url), 'utf8')
const installationGuide = await readFile(new URL('../docs/installation.md', import.meta.url), 'utf8')
const lockfile = parse(await readFile(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8'))
const dshHostPackages = [
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-agent-loop',
  '@deepseek-ai/dsh-atomic-write',
  '@deepseek-ai/dsh-mcp-client',
  '@deepseek-ai/dsh-scope',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-typert-protocol',
]
// 只支持 0.1.5 起（与 peer 窗口一致）：setup 在 0.1.5 才把 agent 作为第二参数传给插件，
// 而 mcp-client 也是 0.1.5 起才按注册作用域判 serverName 唯一性。旧版本不再兼容。
const COMPAT_WINDOW = '>=0.1.5-rc.1 <0.2.0'
// 开发基线跟随已验证的最新 RC；发布边界由 peer 窗口表达。
const DEV_BASELINE = '^0.1.7-rc.1'
// 锁文件里解析出的具体版本。**从 DEV_BASELINE 推导**，不要另写一处：这里原本硬编码
// /^0\.1\.5-rc\.2/，于是 bump 基线时就有了第二个真源。
const DEV_BASELINE_VERSION = DEV_BASELINE.replace(/^[^0-9]*/, '')
// cordis 锁补丁位：ensureLogCapture 读写 logger.exporters / logger._snExporter 私有字段。
const CORDIS_PEER = '~4.0.2'
// reveal 用 loader 的 interpolate 求值 `!!js` 节点；范围跟随 dsh 自身对它的要求。
const CORDIS_LOADER_PEER = '^1.0.3'

test('package exposes one Web bundle entry', () => {
  assert.equal(packageJson.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(packageJson.version, '1.4.0')
  assert.equal(packageJson.dsh?.client?.platform, 'web')
  // dsh.client.inject 是客户端图里的「工厂先到」依赖边，只能写真实的 client 包名：
  //   @deepseek-ai/dsh-client-runtime  —— 上游 2026-08-22 已删除（be531688 "remove Runtime"）
  //   @deepseek-ai/dsh-client-ui-slots —— 是纯核心库，从不声明 dsh.client / 导出 ./client
  // 死引用会被客户端模块系统静默跳过（不报错），所以只能靠这条断言拦住它回潮。
  assert.deepEqual(packageJson.dsh?.client?.inject, ['@deepseek-ai/dsh-api-remotes'])
  // docs 的 markdown 随包发布（使用者能从包里读到设计与安装说明），
  // 但 **截图不随包**：README 里的相对路径会被 npm 改写到 raw.githubusercontent 渲染
  // （实测 5/5 张图正常），带进 tarball 只是白付 956KB。
  assert.equal(packageJson.files?.includes('docs/*.md'), true)
  assert.equal(packageJson.files?.includes('README.en.md'), true)
  assert.equal(
    packageJson.files?.some((entry) => entry === 'docs' || entry.startsWith('docs/images')),
    false,
    'docs 目录或截图不得整目录随包发布',
  )
  assert.equal(packageJson.repository?.url, 'git+https://github.com/Imzl-zl/dsh-mcp-manager-ui.git')
  assert.equal((patch.match(/id: mcp-manager-ui/g) ?? []).length, 1)
  assert.equal((patch.match(/name: dsh-mcp-manager-ui/g) ?? []).length, 1)
})

test('package declares the DSH compatibility window and pins development to a verified RC', () => {
  for (const name of dshHostPackages) {
    assert.equal(packageJson.dependencies?.[name], undefined)
    assert.equal(packageJson.peerDependencies?.[name], COMPAT_WINDOW)
    assert.equal(packageJson.devDependencies?.[name], DEV_BASELINE)
  }
})

test('every host contract this plugin actually depends on is declared as a peer', () => {
  // 不声明就等于隐式依赖：下面每一项都有硬依赖的契约，它们一变本插件就会静默失效。
  //   dsh-tools      → tools.schemas(scope)/get(name, scope) 的作用域视图，整个投射模型的地基
  //   dsh-agent      → agents.create/resume(options) 的单参签名与 traceable set 语义
  //   dsh-agent-loop → setup(agentCtx, agent) 的两参契约与 raceAbort 语义
  //   dsh-scope      → createScope/quiesceFiber（共享连接的隔离作用域与可 await 的 teardown）
  //   dsh-mcp-client → serverName 注册表、工具名前缀、日志 label
  for (const name of dshHostPackages) {
    assert.equal(packageJson.peerDependencies?.[name], COMPAT_WINDOW, name + ' 必须声明为 peer')
  }
  // cordis 锁到补丁位：ensureLogCapture 为了绕过 LoggerService.exporter() 删错 ID 的 bug，
  // 直接读写了 logger.exporters / logger._snExporter 两个私有字段。这是唯一可订阅的诊断面，
  // 但它不是公开契约，所以不能用 caret 区间。
  assert.equal(packageJson.peerDependencies?.['@deepseek-ai/cordis'], CORDIS_PEER)
  // 官方 scope 包名是 @deepseek-ai/cordis；无 scope 的 `cordis` 是另一个包，写错就是假兼容声明。
  assert.equal(packageJson.peerDependencies?.cordis, undefined)
  // cordis-plugin-loader 不在 dsh-* 命名空间，peer 范围跟随 dsh 自身的要求：
  // reveal 用它把 `!!js` 节点求值成有效运行值。
  assert.equal(packageJson.peerDependencies?.['@deepseek-ai/cordis-plugin-loader'], CORDIS_LOADER_PEER)
  assert.equal(packageJson.devDependencies?.['@deepseek-ai/cordis-plugin-loader'], CORDIS_LOADER_PEER)
})

test('lockfile resolves DSH host packages only as a development baseline on the latest RC', () => {
  const importer = lockfile.importers['.']
  for (const name of dshHostPackages) {
    assert.equal(importer.dependencies?.[name], undefined)
    assert.equal(importer.devDependencies?.[name]?.specifier, DEV_BASELINE)
    const resolved = importer.devDependencies?.[name]?.version ?? ''
    assert.ok(
      resolved === DEV_BASELINE_VERSION || resolved.startsWith(DEV_BASELINE_VERSION + '('),
      `${name} 的锁文件版本应解析到开发基线 ${DEV_BASELINE_VERSION}，实际 ${resolved}`,
    )
  }
  assert.equal(importer.dependencies?.['@deepseek-ai/cordis'], undefined)
  assert.equal(importer.devDependencies?.['@deepseek-ai/cordis']?.specifier, CORDIS_PEER)
})

test('runtime YAML parser includes the nested-collection stack overflow fix', () => {
  const [major, minor, patchVersion] = packageJson.dependencies.yaml.split('.').map(Number)
  assert.equal(major, 2)
  assert.ok(minor > 8 || (minor === 8 && patchVersion >= 3))
})

test('the TOML parser used for Codex import stays a runtime dependency', () => {
  // Codex 的 config.toml 是 TOML，插件**运行期**就要解析它。挪到 devDependencies 会让
  // 装好的插件在加载 lib/mcp-import-sources.js 时直接 ERR_MODULE_NOT_FOUND；
  // package-artifact 用例能拦住，但它跑在打包阶段，这里给出就近的理由。
  assert.match(packageJson.dependencies['smol-toml'], /^\^?1\./)
  assert.equal(packageJson.devDependencies?.['smol-toml'], undefined)
})

test('the current release has a hand-written GitHub Release note', async () => {
  // 发布闸门（与 whats-new 同一条理由，只是对象换成 Release 页面）：本仓库的发布全部直接提交
  // 到 main、没有 PR，所以 `gh release create --generate-notes` 几乎生成不出内容——v1.3.0 及
  // 之前每个 Release 页面都只有一行 compare 链接，而面板的更新提示正是把用户指到那一页。
  // release.yml 在推 tag 时会优先用 .github/release-notes/v<version>.md，所以当前版本必须
  // 有一份手写稿：bump 版本时一起写，否则本地就红（tag 之前就能发现）。
  const notesPath = new URL(`../.github/release-notes/v${packageJson.version}.md`, import.meta.url)
  const notes = await readFile(notesPath, 'utf8').catch(() => '')
  assert.ok(
    notes.trim().length > 0,
    `缺少 .github/release-notes/v${packageJson.version}.md：这就是 Release 页面与面板更新提示指过去的内容，bump 版本时要一起写`,
  )
  // 至少要回答"升级怎么做"——只有标题的稿子和自动生成的一样没用。
  assert.match(notes, /dsh plugin --profile web (?:add|update)/, 'Release notes 里要写清升级命令')
})

test('documentation targets the verified DSH and plugin releases', () => {
  // README.en.md 同样随包发布，一并纳入：它原来不在清单里，所以英文版可以悄悄停在旧版本上。
  for (const document of [readme, readmeEn, installationGuide]) {
    assert.match(document, /0\.1\.7-rc\.1/)
    // 不再**声称**兼容 0.1.0-rc.x：peer 窗口已收窄到 0.1.5 起。
    // （文档里可以提到旧版本，但只能出现在解释历史差异的上下文里，不能写成兼容声明。）
    assert.doesNotMatch(document, /0\.1\.0-rc\.7`?\s*(?:及以上|以上)/)
    assert.doesNotMatch(document, /(?:0\.1\.0-)?rc\.6/)
    assert.match(document, /dsh plugin --profile web add github:Imzl-zl\/dsh-mcp-manager-ui#v1\.4\.0/)
    // npm 是主安装路径（它让 `dsh plugin update` 能在 ^1.x 内自动升级），必须写进两份文档。
    assert.match(document, /dsh plugin --profile web add dsh-mcp-manager-ui@\^1\.4\.0/)
    assert.match(document, /dsh plugin --profile web update dsh-mcp-manager-ui/)
  }
})

test('the reveal control only renders for masked values', () => {
  // 明文值（如无凭据的 URL）不需要「显示/隐藏」：它本来就摆在眼前，
  // 配个眼睛只会让人以为还藏了东西，而点下去什么也不变（用户报过这个）。
  assert.match(client, /const masked = fallback === REDACTED_VALUE/)
  assert.match(client, /masked \? h\('button'/, '眼睛必须在 masked 时才渲染')
  // 复制按钮只属于「已点开」的状态，不能与眼睛一起无端出现。
  assert.match(client, /revealedNow \? h\('button'/)
})

test('reveal resolves !!js config nodes with the loader evaluator, never returns the raw node', () => {
  // loader 把 `!!js` 表达式以 raw 节点留在 entry.options.config（官方为写回保留 `!!js` 形式），
  // apply 之前才用 interpolate 求值。直接把该节点当「有效运行值」返回，客户端会把它序列化成
  // "[object Object]"——用户点眼睛看到的就是这个，看不到 key。
  assert.match(hostIndex, /import \{ interpolate \} from "@deepseek-ai\/cordis-plugin-loader"/)
  // 必须用 entry 自己的 ctx：官方用例里表达式可以引用该行 inject 的服务。
  assert.match(hostIndex, /interpolate\(entry\.ctx, value\)/)
  // 项目层用与会话建连同一个求值器（内部 spec 存的是 `!!js` 字符串），同样要运行值不要模板。
  assert.match(hostIndex, /resolveSpecValue\(current\[field\], process\.env\)/)
  // 旧的「返回文件模板」实现必须彻底消失：模板不是运行值。
  assert.doesNotMatch(hostIndex, /restoreTemplateDeep/)
  // 编辑表单仍只把运行值用于显示：保留原值标记不得因为求值而失效。
  assert.match(hostIndex, /containsRedactedValue/)
})

test('agent setup takes the agent from the official second parameter, never from ctx', async () => {
  const runtime = await readFile(new URL('../lib/workspace-runtime.js', import.meta.url), 'utf8')
  // dsh-agent-loop 0.1.5：`setup?.(prepared.agent.ctx, prepared.agent)`。
  // ctx 是 agent 的 scope context，上面**没有** agent 属性；读它会被 cordis 的服务守卫拒绝：
  // `cannot get property "agent" without inject`——而 setup 抛错会让会话的创建与恢复直接失败。
  // （早年测试替身把 agent 挂在 ctx 上，所以这个缺陷 40+ 个用例全假通过。）
  assert.match(runtime, /async \(agentCtx, agent\) =>/)
  assert.match(runtime, /if \(!agent\)/)
  // 中间层必须把官方契约原样透传给下一层：少传 agent 就是
  // `Cannot read properties of undefined (reading 'session')`（宿主的 setup 会读 agent.session）。
  assert.match(runtime, /callerSetup\?\.\(agentCtx, agent\)/)
  assert.doesNotMatch(runtime, /callerSetup\?\.\(agentCtx\)/)
})

test('bundle does not install the creation-mode Cordis tool', () => {
  assert.doesNotMatch(patch, /dsh-tool-cordis|cordis-tools/)
})

test('client exposes only the floating MCP manager and follows DSH theme contracts', () => {
  assert.doesNotMatch(client, /settings\.plugins\.tab/)
  assert.match(client, /shell\.overlay/)
  assert.doesNotMatch(client, /搜索工具/)
  assert.match(client, /添加 MCP/)
  assert.match(client, /--dsw-alias-button-elevated-fill/)
  assert.doesNotMatch(client, /background:#262a33/)
})

test('client keeps transport badges readable in both DSH color schemes', () => {
  assert.match(client, /\.dsh-mcp-badge\.t-http\{[^}]*color:var\(--dsw-alias-label-primary\)[^}]*border-color:var\(--dsw-alias-state-business-primary\)[^}]*background:var\(--dsw-alias-state-business-tertiary\)/)
  assert.match(client, /\.dsh-mcp-badge\.t-stdio\{[^}]*color:var\(--dsw-alias-label-primary\)[^}]*border-color:var\(--dsw-alias-state-warn-primary\)[^}]*background:var\(--dsw-alias-state-warn-tertiary\)/)
  assert.doesNotMatch(client, /state-warn-secondary\}/)
})

test('client keeps both enabled and disabled toggle states visible', () => {
  assert.match(client, /\.dsh-mcp-toggle\{[^}]*background:var\(--dsw-alias-button-ghost-active-fill\)/)
  assert.match(client, /\.dsh-mcp-toggle::after\{[^}]*background:var\(--dsw-alias-brand-primary-invert\)/)
  assert.match(client, /\.dsh-mcp-toggle\.on::after\{[^}]*background:var\(--dsw-alias-label-primary-inverted\)/)
  assert.doesNotMatch(client, /--dsw-alias-fill-l2/)
})

test('client keeps connection status badges readable in both DSH color schemes', () => {
  assert.match(client, /\.dsh-mcp-badge\.s-on\{[^}]*color:var\(--dsw-alias-label-primary\)[^}]*border-color:var\(--dsw-alias-state-success-primary\)[^}]*background:var\(--dsw-alias-state-success-tertiary\)/)
  assert.match(client, /\.dsh-mcp-badge\.s-err\{[^}]*color:var\(--dsw-alias-label-primary\)[^}]*border-color:var\(--dsw-alias-state-error-primary\)[^}]*background:var\(--dsw-alias-interactive-bg-hover-danger\)/)
  assert.doesNotMatch(client, /\.dsh-mcp-badge\.s-(?:on|err)\{[^}]*state-(?:success|error)-secondary/)
})

test('client does not reference unsupported DSH alias tokens', () => {
  assert.doesNotMatch(client, /--dsw-alias-label-error/)
})

test('client preserves redacted values during edits and never previews header values', () => {
  assert.match(client, /__DSH_MCP_REDACTED__/)
  assert.match(client, /••••••（保留原值）/)
  assert.match(client, /MASKED_VALUE/)
  assert.match(client, /onReveal\(server, field, keyName\)/)
  assert.doesNotMatch(client, /String\(headers\[k\]\)\.slice\(0, 12\)/)
})

test('client reveals masked values in detail and edit views without replacing preserved form state', () => {
  assert.match(client, /onReveal\(server, field, keyName\)/)
  assert.match(client, /toggleEditReveal\(field, originalKey\)/)
  assert.match(client, /visibleEditValue\(field, originalKey, row\.v\)/)
  assert.match(client, /formatRevealedValue/)
  assert.match(client, /Object\.entries\(value\)/)
  assert.match(client, /dsh-mcp-inline-icon\{box-sizing:border-box;width:34px!important;height:34px!important/)
  assert.match(client, /dsh-mcp-kv-del\{box-sizing:border-box;width:34px;height:34px/)
})

test('manual refresh provides progress and completion feedback', () => {
  assert.match(client, /refreshing \? '刷新中…' : '刷新'/)
  assert.match(client, /'已刷新，共 ' \+ next\.length \+ ' 个 MCP'/)
})

test('client avoids full-screen backdrop filters and skips stale or unchanged polling renders', () => {
  assert.doesNotMatch(client, /dsh-mcp-(?:panel-)?overlay\{[^}]*backdrop-filter/)
  assert.match(client, /revision !== revisionRef\.current/)
  assert.match(client, /seq !== loadSeq\.current/)
})

test('list and detail use the same derived status and refresh tools after registration', () => {
  assert.match(client, /const dotPhase = \(s\) => \(mountFailed\(s\) \|\| scopeFailed\(s\) \? 'failed' : s\.status \|\| s\.phase\)/)
  assert.match(client, /selectedServer\?\.toolRevision/)
})

test('mount failures are attributed to the row and the detail pane, not only a banner', async () => {
  const host = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')
  // 顶部横幅说 memory 挂载失败、而列表里 memory 看着一切正常，是最容易误导的状态。
  // 行与详情都只读 Host 标在行上的 mountFailed；客户端不再拿 mountErrors 列表反推一遍（第二真相源）。
  assert.doesNotMatch(client, /const mountErrorMap = useMemo/)
  assert.match(client, /const mountFailed = \(s\) => s\.mountFailed === true/)
  assert.match(client, /mountFailed\(s\) \? h\(Badge, \{ cls: 's-err' \}, '挂载失败'\) : null/)
  // 挂载失败（我们 setup 阶段挂不上）与连接失败（mcp-client 报错/重连耗尽）必须分开：
  // 用“lastError 存在”反推挂载失败会把连接失败误标成挂载失败，也是同一事实的第二个真相源。
  assert.match(host, /row\.mountFailed = true;/)
  assert.match(client, /const mountFailed = isWorkspace && server\.mountFailed === true/)
  assert.doesNotMatch(client, /return failure \? \{ \.\.\.local, lastError: failure \} : local/)
  // 列表行标红而详情说「随会话挂载」，是同一条信息在两处自相矛盾。
  assert.match(client, /const status = mountFailed \? 'failed' : server\.status \|\| server\.phase \|\| 'stopped'/)
  assert.match(client, /mountFailed\s*\n\s*\? '挂载失败'/)
  // 横幅不再猜测原因，具体错误留在它归属的条目上。
  assert.doesNotMatch(client, /可能已被其他会话占用或连接失败/)
})

test('global MCPs are inspectable from a project tab but stay read-only there', () => {
  // 长得像列表项却点不开，是最直接的交互不一致。
  assert.match(client, /onClick: \(\) => onSelect\(s\.serverName\),[^]*?onKeyDown[^]*?dsh-mcp-item-name/)
  assert.match(client, /return global \? \{ \.\.\.global, managed: false, foreign: 'global' \} : null/)
  assert.match(client, /const isForeign = server\.foreign === 'global'/)
  // 只读的同时仍要能改「对本项目是否可见」，否则详情页比列表还弱。
  assert.match(client, /isForeign\s*\n\s*\? h\(React2\.Fragment, null,[^]*?onToggleExclude\(server\.serverName, next\)/)
  assert.match(client, /isForeign \? '全局配置（在「全局」标签页可编辑）'/)
  assert.doesNotMatch(client, /← 从左侧选择一个 MCP/)
})

test('revealed values are generation-scoped and cleared when persisted configuration changes', () => {
  assert.match(client, /editRevealGeneration\.current/)
  assert.match(client, /generation !== revealGeneration\.current/)
  assert.match(client, /revealRevisionRef/)
  assert.match(client, /if \(consumeRevision\(revealRevisionRef, res\.revealRevision\)\) clearRevealed\(\)/)
  assert.match(client, /clearRevealed\(\);\s*flash\(editTarget/)
  assert.match(client, /clearRevealed\(\);\s*flash\(res\.note/)
})
test('client validates reconnect delay ordering without rejecting DSH-supported decimals', () => {
  assert.match(client, /Number\.isFinite\(initialDelay\)/)
  assert.match(client, /initialDelay > maxDelay/)
  assert.doesNotMatch(client, /\[timeout, initialDelay, maxDelay, attempts\]\.every/)
})

test('client preserves prototype-shaped header and env keys entered in the form', () => {
  assert.match(client, /setOwn\(hd, r\.k\.trim\(\), fromFormValue\(r\.v\)\)/)
  assert.match(client, /setOwn\(ev, r\.k\.trim\(\), fromFormValue\(r\.v\)\)/)
})

test('client moves focus into dialogs so Escape handlers receive keyboard events', () => {
  assert.match(client, /dialogRef\.current\?\.focus\(\)/)
  assert.match(client, /panelRef\.current\?\.focus\(\)/)
  assert.match(client, /e\.stopPropagation\(\)/)
})

test('client Remote contract includes JSON preview and import operations', () => {
  assert.match(client, /mcpManager\/previewImport/)
  assert.match(client, /mcpManager\/importJson/)
})

test('importing from other MCP clients goes through the Host, with no client-supplied path', async () => {
  const { TYPERT } = await import('../lib/typert.js')
  for (const method of ['scanImportSources', 'previewImportSource', 'importSource']) {
    // 契约有、Host 没有 = 调用必失败；Host 有、契约没有 = 客户端永远调不到。三边都要在。
    assert.ok(TYPERT.invocations.some((entry) => entry.method === method), `契约缺少 ${method}`)
    assert.match(hostIndex, new RegExp(`async ${method}\\(payload\\) \\{`), `Host 缺少 ${method}`)
    assert.match(client, new RegExp(`call\\('${method}'`), `客户端没有调用 ${method}`)
  }
  // 扫描结果只带名称、传输与「哪些字段会被掩码」，条目本体（含 `!!js` 表达式与字面密钥）不出 Host。
  assert.match(hostIndex, /maskedFields: entry\.spec \? maskedSourceFields\(entry\.spec\) : \[\]/)
  // 导入必须带上预览时的内容指纹，否则等于允许「预览的是 A、导入的是 B」。
  assert.match(client, /contentHash: sourcePreview\.contentHash/)
  // 路径只由 Host 的来源表拼出；客户端一旦开始传 path，接口面就退化成「读任意文件」。
  assert.doesNotMatch(client, /call\('(?:previewImportSource|importSource)', \{[^}]*path:/)
})

test('client places an explicit selectable builtin installer before manual add', () => {
  assert.match(client, /BuiltinInstallModal/)
  assert.match(client, /call\('builtins'\)/)
  assert.match(client, /call\('installBuiltins'/)
  assert.match(client, /type: 'checkbox'/)
  assert.match(client, /安装选中/)
  assert.match(client, /\.dsh-mcp-builtin-modal\{[^}]*display:flex[^}]*flex-direction:column/)
  assert.match(client, /\.dsh-mcp-builtin-list\{[^}]*overflow-y:auto/)
  assert.match(client, /checked: allSelected/)
  const importPosition = client.indexOf("children: '导入 MCP")
  const builtinPosition = client.indexOf("children: '内置 MCP")
  const addPosition = client.indexOf("scope === 'global' ? '添加 MCP'")
  assert.ok(importPosition >= 0 && importPosition < builtinPosition && builtinPosition < addPosition)
})

test('client exposes tool parameter schemas, presets, filters and clipboard copy', () => {
  assert.match(client, /tool\.parameters/)
  assert.match(client, /MCP_PRESETS/)
  assert.match(client, /flattenParameters/)
  assert.match(client, /describeType/)
  assert.match(client, /transportFilter/)
  assert.match(client, /statusFilter/)
  assert.match(client, /navigator\.clipboard/)
  assert.match(client, /ICONS\.copy/)
  assert.doesNotMatch(client, /JSON\.stringify\(prev\) === JSON\.stringify\(next\)/)
})

test('workspace tab renders project MCPs as their own card instead of a nested collapsing list', () => {
  // ServerList 内嵌进项目分区时必须丢掉自身卡片外框，否则出现卡中卡。
  assert.match(client, /\.dsh-mcp-side\.embedded\{[^}]*flex:1 1 auto[^}]*border:0[^}]*padding:0/)
  assert.match(client, /className: 'dsh-mcp-side' \+ \(embedded \? ' embedded' : ''\)/)
  // 两个分区各自成卡片，不再靠 border-top 分隔。
  assert.match(client, /\.dsh-mcp-section\{[^}]*border:1px solid var\(--mcp-line\)[^}]*border-radius:12px/)
  assert.doesNotMatch(client, /\.dsh-mcp-section\+\.dsh-mcp-section\{border-top/)
  assert.match(client, /\.dsh-mcp-section\.local\{[^}]*border-color:var\(--mcp-accent\)/)
  assert.match(client, /className: 'dsh-mcp-section local'/)
  assert.match(client, /className: 'dsh-mcp-section global'/)
  // ws-body 变成纯布局容器：不再叠一层卡片，放不下时自身滚动而不是裁掉内容。
  assert.match(client, /\.dsh-mcp-ws-body\{[^}]*overflow-y:auto/)
  assert.doesNotMatch(client, /\.dsh-mcp-ws-body\{[^}]*border:1px solid/)
})

test('server lists keep a minimum visible height and never get clipped to zero on narrow panels', () => {
  // flex:1 在被压缩的 column 容器里会塌缩成 0 并被 overflow:hidden 吃掉，必须给下限。
  assert.match(client, /\.dsh-mcp-list\{flex:1 1 auto;min-height:52px/)
  assert.match(client, /\.dsh-mcp-global-list\{[^}]*min-height:52px/)
  assert.match(client, /\.dsh-mcp-section\.local\{[^}]*min-height:124px/)
  assert.match(client, /\.dsh-mcp-section\.global\{[^}]*min-height:124px/)
  // 窄屏改为整页滚动 + 列表各自 vh 上限，取代会裁掉整块列表的 max-height:34%。
  assert.doesNotMatch(client, /max-height:34%/)
  assert.match(client, /@media \(max-width:760px\)\{[^]*?\.dsh-mcp-body\{flex-direction:column;overflow-y:auto/)
  assert.match(client, /@media \(max-width:760px\)\{[^]*?\.dsh-mcp-section\.local \.dsh-mcp-list\{max-height:30vh\}/)
  assert.match(client, /@media \(max-width:760px\)\{[^]*?\.dsh-mcp-global-list\{max-height:30vh\}/)
})

test('workspace MCPs stay toggleable and share the global status vocabulary', () => {
  // 项目 MCP 没有 loader 条目的 phase 语义，沿用全局的 stopped 判定会让禁用后再也开不回来。
  assert.match(client, /const toggleLocked = \(s\) => busy \|\| !s\.managed \|\| \(s\.scope !== 'workspace' && !s\.enabled && s\.phase !== 'stopped'\)/)
  // 项目行的 status 与全局同一个取值域（deriveMcpPhase），只是文案不同；不再有自创的
  // connecting/idle/active 那套平行词汇，也不再恒显“随会话挂载”。
  assert.match(client, /const status = mountFailed \? 'failed' : server\.status \|\| server\.phase \|\| 'stopped'/)
  assert.match(client, /status === 'connected' \? '已连接（本项目会话共享）'/)
  assert.doesNotMatch(client, /s\.status === 'connecting'/)
  assert.doesNotMatch(client, /isWorkspace\s*\n\s*\? '随会话挂载'/)
  assert.match(client, /cls: isWorkspace \? 'scope-ws' : ''/)
})

test('sparse workspace lists hide filter controls and global search stays outside the scroll area', () => {
  // 项目 MCP 通常只有 1-3 个，常驻搜索框 + 两个下拉会吃掉整块列表高度。
  assert.match(client, /const showControls = !embedded \|\| count > CONTROLS_THRESHOLD/)
  assert.match(client, /workspace \? null : h\('option', \{ value: 'connected' \}/)
  assert.match(client, /emptyHint: '此项目还没有 MCP。/)
  // 搜索框必须是分区的直接子节点，否则会随列表一起滚走。
  assert.match(client, /servers\.length > CONTROLS_THRESHOLD \? h\('div', \{ className: 'dsh-mcp-global-search' \}[^]*?\n\s*h\('div', \{ className: 'dsh-mcp-global-list' \}/)
  assert.match(client, /setTransportFilter\('all'\);\s*\n\s*setStatusFilter\('all'\);/)
})

test('visibility and enablement use deliberately different controls', () => {
  // 滑块=启用状态、眼睛=本项目可见性。两者后果不同（写 disabled vs 写 exclude），
  // 外观统一反而会让人以为关掉全局条目就是全局禁用。
  assert.match(client, /const EyeToggle = \(\{ hidden, disabled, onChange, label \}\)/)
  assert.match(client, /ICONS\[hidden \? 'eyeOff' : 'eye'\]/)
  assert.match(client, /h\(EyeToggle, \{ hidden: isHidden, disabled: busy, label: s\.serverName, onChange: \(next\) => onToggleExclude\(s\.serverName, next\) \}\)/)
  assert.doesNotMatch(client, /dsh-mcp-hide-toggle/)
  assert.match(client, /isHidden \? h\(Badge, \{ cls: 's-off' \}, '已屏蔽'\) : null/)
  // 眼睛按钮不能连带触发行选中
  assert.match(client, /onClick: \(e\) => \{ e\.stopPropagation\(\); onChange\(!hidden\); \}/)
})

test('global list collapses to a one-line summary so the project list stays the subject', () => {
  // 全局可见性是低频操作，展开时占了项目区两倍高度并把详情挤出视口。
  assert.match(client, /const \[globalOpen, setGlobalOpen\] = useState\(false\)/)
  assert.match(client, /className: 'dsh-mcp-section global' \+ \(globalOpen \? '' : ' collapsed'\)/)
  assert.match(client, /visibleGlobalCount \+ '\/' \+ globalServers\.length \+ ' 对本项目可见'/)
  assert.match(client, /globalOpen \? h\(GlobalServerList/)
  assert.match(client, /\.dsh-mcp-section\.global\.collapsed\{flex:none;min-height:0;border-color:transparent/)
  assert.match(client, /setGlobalOpen\(false\);/)
})

test('project MCP: what the README promises the panel shows, the panel actually shows', async () => {
  const host = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')
  // README 承诺「面板会在该项目行标出 `配置待生效`，详情页给出说明」——必须真的存在，
  // 而不是只写进一条用户看不到的 logger.warn。
  assert.match(readme, /面板会在该项目行标出 `配置待生效`/)
  assert.match(host, /row\.configStale = conn\.configStale/)
  assert.match(client, /s\.configStale \? h\(Badge, null, '配置待生效'\) : null/)
  assert.match(client, /isWorkspace && server\.configStale \? h\('div', \{ className: 'dsh-mcp-log warn' \}/)
  // 详情页空态不能承诺“刷新即可看到工具”：那要求 tools RPC 真能枚举共享作用域层，
  // 而 toolInventory 只认 loader 条目 + 全局视图。要么能枚举，要么别承诺。
  assert.doesNotMatch(client, /刷新即可看到工具/)
  assert.match(host, /workspaceToolSchemas\(this\.ctx, value, wsPath\)\.map\(projectToolSchema\)/)
  // 项目 MCP 的详情必须带 wsPath 去问，否则两个项目同名时会列到另一个项目的工具。
  assert.match(client, /call\('tools', \{ name: selected, wsPath: scope \}\)/)
})

test('project MCP: the shared-connection reference is owned by cordis, not by our own bookkeeping', async () => {
  const runtime = await readFile(new URL('../lib/workspace-runtime.js', import.meta.url), 'utf8')
  // 一份引用 = 一个会话作用域的 effect。它的原子性使「从检查到记账不得有 await」这类
  // 只能靠注释约束的临界区消失；作用域已销毁时由 cordis 的 assertActive() 抛出，不自建判定。
  assert.match(runtime, /slot\.release = agentCtx\.effect\(\(\) => \(\) => disposeProjectSlot\(slot\), `mcp-manager\.projectConn/)
  // HMR 撤回必须走同一个官方 disposer（幂等由 cordis 的 runner\.epoch 保证），
  // 而不是另开一条释放路径——后者会让会话后续销毁时变成重复释放。
  assert.match(runtime, /typeof slot\.release === "function" \? slot\.release\(\) : disposeProjectSlot\(slot\)/)
  // 「本代装饰器还在管事吗」是插件代次的属性，不能和会话存活性共用同一张表。
  assert.match(runtime, /if \(!generation\.active\)/)
  assert.doesNotMatch(runtime, /if \(!agentWorkspaceStates\.has\(agent\)\)/)
  // 生命周期归属先建立、再改宿主状态；缺少 effect() 直接抛，不静默降级。
  assert.doesNotMatch(runtime, /ctx\.effect\?\.\(/)
  assert.match(runtime, /无法为 agent 装饰器建立生命周期归属/)
  // 并发等待者不能拿到一份正在 teardown 的连接（refs 从 0 再加回去）。
  assert.match(runtime, /entry\.released = true/)
  assert.match(runtime, /if \(entry\.released\) continue/)
})

test('project MCP: the design doc states the protocol claim per spec revision and names no false escape hatch', () => {
  // 随包 SDK 协商的是 2025-11-25（没有 Statelessness 一节），无状态那套要求来自 2026-07-28。
  // 不写清版本，等于把“按 2025-11-25 维护连接级状态”的服务器说成有缺陷。
  assert.match(designDoc, /2026-07-28[^]*?Statelessness/)
  assert.match(designDoc, /2025-11-25[^]*?没有\*\*\s?Statelessness/)
  assert.doesNotMatch(designDoc, /那是服务器自身的缺陷/)
  // 「放到全局作用域」「项目内另起 serverName」都给不了 per-session 隔离，不能当建议给出。
  assert.match(designDoc, /不支持 per-session 隔离/)
  assert.match(designDoc, /把它挪到全局作用域也没用/)
  // #28860 属于 anthropics/claude-code，不是 DSH 的提案。
  assert.doesNotMatch(designDoc, /DSH 的 shared-daemon 提案/)
})

test('project MCP: the tools contract carries wsPath, so the detail pane is not permanently empty', async () => {
  const { TYPERT } = await import('../lib/typert.js')
  const invocation = TYPERT.invocations.find((entry) => entry.method === 'tools')
  // 声明成标量 name 时，typert 网关会把 `{ name, wsPath }` 当作 args 映射展开并拒绝：
  // `args fields do not match the descriptor: unexpected "wsPath"`。
  // 于是项目 MCP 的详情页永远是空的——Host 侧早就能按 scopeKey 枚举，错只在契约窄了一格。
  assert.equal(invocation.parameters.length, 1)
  assert.equal(invocation.parameters[0].wire, 'payload')
  const clientDescriptor = client.match(/mcpManager\/tools'[^\n]*/)?.[0] ?? ''
  assert.match(clientDescriptor, /mcpParam\('payload'/)
  // 两条分支都必须发对象；裸字符串会落回标量参数那条老路。
  assert.match(client, /call\('tools', \{ name: selected, wsPath: scope \}\)/)
  assert.match(client, /call\('tools', \{ name: selected \}\)/)
  assert.doesNotMatch(client, /call\('tools', selected\)/)
})

test('project MCP: the read-only diagnostics RPC is declared, implemented and documented', async () => {
  const { TYPERT } = await import('../lib/typert.js')
  const host = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.ok(TYPERT.invocations.some((entry) => entry.method === 'projectConnections'))
  // Host 有、契约没有 = 客户端永远调不到；契约有、Host 没有 = 调用必失败。两边都要在。
  assert.match(host, /async projectConnections\(\) \{/)
  assert.match(host, /projectConnectionsView\(this\.ctx\)/)
  assert.match(client, /mcpManager\/projectConnections/)
  // refs 与 sessions 是两个独立事实（相等=健康），设计文档必须把这条判读方式写清楚，
  // 否则这个接口的返回值没人知道怎么用。
  assert.match(designDoc, /projectConnections/)
  assert.match(designDoc, /refs\s*>\s*sessions/)
})
