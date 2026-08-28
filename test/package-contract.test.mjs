import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parse } from 'yaml'

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8')
const installationGuide = await readFile(new URL('../docs/installation.md', import.meta.url), 'utf8')
const lockfile = parse(await readFile(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8'))
const dshHostPackages = [
  '@deepseek-ai/dsh-atomic-write',
  '@deepseek-ai/dsh-typert-protocol',
]

test('package exposes one Web bundle entry', () => {
  assert.equal(packageJson.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(packageJson.version, '1.1.5')
  assert.equal(packageJson.dsh?.client?.platform, 'web')
  assert.equal(packageJson.files?.includes('docs'), true)
  assert.equal(packageJson.repository?.url, 'git+https://github.com/Imzl-zl/dsh-mcp-manager-ui.git')
  assert.equal((patch.match(/id: mcp-manager-ui/g) ?? []).length, 1)
  assert.equal((patch.match(/name: dsh-mcp-manager-ui/g) ?? []).length, 1)
})

test('package declares a caret DSH compatibility window and follows the latest RC in development', () => {
  for (const name of dshHostPackages) {
    assert.equal(packageJson.dependencies?.[name], undefined)
    assert.equal(packageJson.peerDependencies?.[name], '^0.1.0-rc.7')
    assert.equal(packageJson.devDependencies?.[name], '^0.1.0-rc.8')
  }
})

test('lockfile resolves DSH host packages only as a development baseline on the latest RC', () => {
  const importer = lockfile.importers['.']
  for (const name of dshHostPackages) {
    assert.equal(importer.dependencies?.[name], undefined)
    assert.equal(importer.devDependencies?.[name]?.specifier, '^0.1.0-rc.8')
    assert.match(importer.devDependencies?.[name]?.version, /^0\.1\.0-rc\.8(?:\(|$)/)
  }
})

test('runtime YAML parser includes the nested-collection stack overflow fix', () => {
  const [major, minor, patchVersion] = packageJson.dependencies.yaml.split('.').map(Number)
  assert.equal(major, 2)
  assert.ok(minor > 8 || (minor === 8 && patchVersion >= 3))
})

test('documentation targets the verified DSH and plugin releases', () => {
  for (const document of [readme, installationGuide]) {
    assert.match(document, /0\.1\.0-rc\.7/)
    assert.match(document, /0\.1\.0-rc\.8/)
    assert.doesNotMatch(document, /(?:0\.1\.0-)?rc\.6/)
    assert.match(document, /dsh plugin --profile web add github:Imzl-zl\/dsh-mcp-manager-ui#v1\.1\.5/)
  }
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
  assert.match(client, /h\(Dot, \{ phase: s\.status \|\| s\.phase \}\)/)
  assert.match(client, /selectedServer\?\.toolRevision/)
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

test('client places an explicit selectable builtin installer before manual add', () => {
  assert.match(client, /BuiltinInstallModal/)
  assert.match(client, /call\('builtins'\)/)
  assert.match(client, /call\('installBuiltins'/)
  assert.match(client, /type: 'checkbox'/)
  assert.match(client, /安装选中/)
  assert.match(client, /\.dsh-mcp-builtin-modal\{[^}]*display:flex[^}]*flex-direction:column/)
  assert.match(client, /\.dsh-mcp-builtin-list\{[^}]*overflow-y:auto/)
  assert.match(client, /checked: allSelected/)
  const importPosition = client.indexOf("children: '导入 JSON")
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
