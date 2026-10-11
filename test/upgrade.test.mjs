// 一键升级的判定闸门。
//
// 为什么值得单独一套：这个动作会**改用户机器上的安装**，而它的错误形态全是
// 「点了没反应」或「点了把本地开发链接换成 npm 包」——两种都不会让面板报错，
// 也看不出来。所以这里钉的是判定与失败文案，不是 UI。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const clientSource = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
const exportMarker = 'exports.inject = inject;'
const instrumentedClient = clientSource.replace(
  exportMarker,
  `${exportMarker}\nexports.__upgrade = { upgradePlan, upgradeFailureText, pnpmOutputTail, UPGRADE_OWN_PACKAGE, UPGRADE_TARGET_PACKAGE };`,
)
assert.notEqual(instrumentedClient, clientSource, 'client test export marker must stay current')

function loadUpgradeRule() {
  const react = {
    Fragment: Symbol('Fragment'),
    createElement() {},
    useCallback() {},
    useEffect() {},
    useMemo: (factory) => factory(),
    useRef: (value) => ({ current: value }),
    useState: (value) => [value, () => {}],
  }
  let client
  vm.runInNewContext(instrumentedClient, {
    console,
    document: { addEventListener() {}, removeEventListener() {} },
    navigator: {},
    setInterval,
    setTimeout,
    clearInterval,
    clearTimeout,
    window: {
      __ModuleLoader__: {
        load(definition) {
          client = definition.factory((name) => {
            assert.equal(name, 'react')
            return react
          })
        },
      },
    },
  })
  return client.__upgrade
}

const service = { installBundle() {}, removeBundle() {} }
// updateAvailable 由宿主算成「latest > current」（lib/index.js 的 compareVersions），
// 所以这里照它的口径造数据，不要单独造一个自相矛盾的组合。
// `package` 是宿主回的**目标包名**：这条线自 1.5.4 起是迁移版，latest 属于后继包。
const hint = (latest, current = '1.4.2') => ({ current, latest, package: 'dsh-toolbox-ui', updateAvailable: !!latest && latest !== current })
const npmBundle = { name: 'dsh-mcp-manager-ui', source: '^1.4.2', installed: true, version: '1.4.2' }

test('a migration is offered whenever the host can do it — hint or not', () => {
  const { upgradePlan } = loadUpgradeRule()
  // 正常情形：宿主有 pluginManager + 是 npm 装的 + 查到了最新版。
  const ok = upgradePlan({ service, hint: hint('1.6.1'), bundle: npmBundle })
  assert.equal(ok.supported, true)
  // 目标**不是本包**：这条线已并入 dsh-toolbox-ui，所以规格装的是后继包。
  assert.equal(ok.spec, 'dsh-toolbox-ui@^1.6.1', '装的是后继包；本包只负责把用户送过去')
  assert.equal(ok.replaces, 'dsh-mcp-manager-ui', '装完要卸掉本包，否则 profile 里永远留着它')

  // ⚠️ 1.5.5 的关键行为：**查不到最新版也要能迁**。离线、公司网络拦 registry、限流都会走到
  // 这里；那时如果判定成"没有目标"，提示条上的按钮就会点了没反应（用户连"该走了"都看不到）。
  const offline = upgradePlan({ service, hint: null, bundle: npmBundle, fallbackSpec: 'dsh-toolbox-ui@^1.6.1' })
  assert.equal(offline.supported, true, '离线时也必须能迁移')
  assert.equal(offline.spec, 'dsh-toolbox-ui@^1.6.1', '用写死的那份规格')
  assert.equal(offline.version, '1.6.1', '版本要从写死的规格里解出来（横幅要用它说话）')
  // 既没有 hint 也没有 fallback，才算没有目标。
  assert.equal(upgradePlan({ service, hint: null, bundle: npmBundle }).reason, 'no-target')

  // 宿主没提供这个 namespace（老宿主 / 非 web 形态）：不能给按钮，否则点了没反应。
  assert.equal(upgradePlan({ service: null, hint: hint('1.6.1'), bundle: npmBundle }).reason, 'no-service')
  assert.equal(upgradePlan({ service: {}, hint: hint('1.6.1'), bundle: npmBundle }).reason, 'no-service')
})

test('a locally linked install is never upgraded into an npm package', () => {
  const { upgradePlan } = loadUpgradeRule()
  // 这是最危险的一种：用户用 link:/file:/github: 装来做开发，拿 npm spec 覆盖会把他的
  // 本地链接换成一个 npm 包——那是破坏，不是升级。必须拒绝，并且理由要能解释给用户。
  for (const source of [
    'link:D:/sudy/github/dsh-mcp-manager-ui',
    'file:C:/tmp/dsh-mcp-manager-ui-1.5.0.tgz',
    'github:Imzl-zl/dsh-mcp-manager-ui#v1.5.0',
    'workspace:*',
  ]) {
    const plan = upgradePlan({ service, hint: hint('1.5.0'), bundle: { ...npmBundle, source } })
    assert.equal(plan.supported, false, `${source} 不该被允许一键升级`)
    assert.equal(plan.reason, 'not-npm')
    assert.equal(plan.spec, null)
  }
  // 反向：npm 的几种写法都该放行（范围、精确、latest）。
  for (const source of ['^1.4.2', '1.4.2', '~1.4.2', 'latest', '']) {
    assert.equal(
      upgradePlan({ service, hint: hint('1.5.0'), bundle: { ...npmBundle, source } }).supported,
      true,
      `${source || '(空 source)'} 应可升级`,
    )
  }
})

test('upgrade failures say what happened instead of just "failed"', () => {
  const { upgradeFailureText } = loadUpgradeRule()
  // 已知码给可操作的中文解释。
  assert.match(upgradeFailureText({ code: 'incompatible-version' }, 1), /不兼容/)
  assert.match(upgradeFailureText({ code: 'stop-profile' }, 1), /重启/)
  assert.match(upgradeFailureText({ code: 'management-required' }, 1), /托管/)
  // 未知码不吞：码与 pnpm 退出码都要带出来，否则用户和我们都无从查起
  // （desktop 直接改当前 profile 且没有自动回滚，失败后必须能追）。
  const unknown = upgradeFailureText({ code: 'brand-new-code' }, 7)
  assert.match(unknown, /brand-new-code/)
  assert.match(unknown, /7/)
  // 连码都没有时也要有话说，不能是空串。
  assert.ok(upgradeFailureText(null, null).length > 0)
})

test('an unknown migration failure carries pnpm own words, cleaned up', () => {
  const { upgradeFailureText, pnpmOutputTail } = loadUpgradeRule()
  // 真机实测过的那次失败（1.5.3 面板的按钮）：面板只显示一个 Windows 崩溃码，而 pnpm 原文
  // 说得很清楚。官方把整段输出放在 packageResult.output 里，所以要把它接上——但要挑干净。
  const output = [
    'Progress: resolved 4, reused 3, downloaded 0, added 3',
    'npm notice',
    'npm notice package size: 222.9 kB',
    '\u001b[31m[ERR_PNPM_NO_MATCHING_VERSION] No matching version found for example-plugin@9.9.9\u001b[0m',
    '',
    'The latest release of example-plugin is "1.5.3".',
  ].join('\n')
  const text = upgradeFailureText({ code: 'operation-error' }, 3221226505, output)
  assert.match(text, /ERR_PNPM_NO_MATCHING_VERSION/, '必须把 pnpm 的原句带出来，否则只有崩溃码')
  assert.match(text, /The latest release/, 'pnpm 的结论行更该出现（它直接告诉用户"最新是什么"）')
  assert.match(text, /operation-error/)
  assert.doesNotMatch(text, /Progress:|npm notice|package size/)
  assert.doesNotMatch(text, /\u001b\[/, 'ANSI 颜色码要剥掉')
  // 已知码的解释优先：它已经把原因和下一步说清了，不该再被 pnpm 输出淹没。
  assert.equal(upgradeFailureText({ code: 'stop-profile' }, 1, output), '宿主正在停止，未升级；请重启后再试。')
  // 没有 output 时行为与改动前逐字一致（老宿主/老官方版本不带这个字段）。
  assert.equal(upgradeFailureText({ code: 'brand-new-code' }, 7), '迁移失败（错误码 brand-new-code，pnpm 退出码 7）。')
  // 挑行：没有报错行时取末尾三行；有报错行时从它开始带（结论就在它后面一行）。
  assert.equal(pnpmOutputTail(''), '')
  assert.equal(pnpmOutputTail('a\nb\nc\nd\ne'), 'c d e')
  assert.equal(pnpmOutputTail('one\nERR_PNPM_X boom\n因为原因在这里\n还有一句'), 'ERR_PNPM_X boom 因为原因在这里 还有一句')
  assert.ok(pnpmOutputTail('x'.repeat(500)).length <= 300)
})

test('the post-upgrade banner survives the hint going away', () => {
  // 这是一个真机跑出来的缺陷，不是假想：升级成功后**宿主立刻报「已是最新」**（磁盘上的
  // package.json 已经被换成新版），于是 updateHint 变成 null——而横幅原本挂在 updateHint 上，
  // 结果「点完就消失」，用户永远看不到那句「重启宿主后生效」。而宿主代码在进程内执行，
  // 不重启等于没升级，这句话是整个功能的必要闭环。
  //
  // 所以横幅的存活条件必须把 done 也算进去；1.5.5 起更进一步：**除非用户主动关掉，它一直在**
  // （这条线已经结束，"该走去哪"不能取决于 registry 查询成功与否）。
  assert.match(
    clientSource,
    /\(!bannerClosed \|\| upgradeState\.phase !== 'idle'\)/,
    '横幅不能挂在 updateHint 上：离线时也要看得见"该走了"，进行中/完成/失败更要看得见',
  )
  // 关闭状态按目标版本记（关掉之后本版本不再提示，目标更新了会再提示）。
  assert.match(clientSource, /dismissed === bannerVersion/, '关闭要按目标版本记忆')
  assert.match(clientSource, /localStorage\.setItem\(UPDATE_HINT_DISMISS_KEY, bannerVersion\)/, '关闭时写入的是目标版本')
  // done 分支不能再去读 updateHint 的字段（那时它是 null，会直接崩）。
  const doneBranch = clientSource.match(/phase === 'done'\s*\?\s*\(upgradeState\.leftover[\s\S]{0,400}?\+ upgradeState\.version \+/)
  assert.ok(doneBranch, '找不到 done 分支的文案')
  assert.match(doneBranch[0], /upgradeState\.version/, 'done 文案只能用升级时记下的版本，不能读 updateHint')
  // running 阶段就要把版本记下来，否则 done 时没有版本可显示（updateHint 已刷新成「已是最新」）。
  // 记的来源是 plan.version——目标版本随判定一起出来，不依赖之后可能变空的 hint。
  assert.match(clientSource, /phase: 'running', version: plan\.version/, 'running 阶段要记住目标版本')
  assert.match(clientSource, /phase: 'done', version: plan\.version/, 'done 也要用同一个来源，不能读 hint')
  // 关闭按钮必须也能收掉 done 横幅，否则按了没反应。
  assert.match(clientSource, /current\.phase === 'done' \? \{ phase: 'idle' \}/, '关闭要能收掉 done 状态')
})

test('the migration installs the successor FIRST and only then removes itself', () => {
  // 顺序是这个功能的安全边界：装完后继它就已经顶替了本包（两个包共用 patch id
  // `mcp-manager-ui`，composer 按 id 取**后列的那个**；真机实测：两个都装着时应用照常启动、
  // 只注册一个面板，注册的是后继包）。所以"先装后卸"即使第二步失败，用户手里仍是一个能用的
  // 面板；反过来先卸自己会把面板弄没，那时只能靠 CLI 救回来。
  const installAt = clientSource.indexOf('svc[UPGRADE_METHOD](plan.spec')
  const removeAt = clientSource.indexOf('svc[UPGRADE_REMOVE_METHOD](plan.replaces)')
  assert.ok(installAt > 0, '找不到 installBundle 的调用点')
  assert.ok(removeAt > 0, '找不到 removeBundle 的调用点')
  assert.ok(installAt < removeAt, '必须先装后继、再卸本包（顺序反了会把用户的面板弄没）')
  // 卸自己这一步只在 replaces 有值、且宿主确实提供该方法时才发。
  assert.match(clientSource, /if \(plan\.replaces && typeof svc\[UPGRADE_REMOVE_METHOD\] === 'function'\)/)
  // 移除失败不能假装成功：横幅要说清"还剩一步"（旧包还在 profile 里）。
  assert.match(clientSource, /leftover: plan\.replaces/, '旧的没卸掉时要在横幅里说清')
})

test('the upgrade path calls the official remote with the arguments it requires', () => {
  // 这条钉的是调用形状，不是判定：installBundle 的 wire 签名要求**两个**参数
  // （spec, options），少传一个会被直接拒绝：
  //   client api: pluginManager/installBundle expected 2 argument(s), got 1
  // 而 options 缺失时的报错发生在 wire 层，不会走到我们的分支，所以只能靠源码形状钉住。
  const call = clientSource.match(/svc\[UPGRADE_METHOD\]\(([^)]*)\)/)
  assert.ok(call, '找不到 installBundle 的调用点')
  assert.match(call[1], /plan\.spec/, '第一个参数必须是 spec')
  assert.match(call[1], /,\s*\{\}/, '第二个参数必须显式传（wire 要求两个参数）')
  // 结果分流：官方用 application 表达失败与「装上了但要重启」，不能只看 ok。
  assert.match(clientSource, /r\.application === 'failed'/)
  // 装完必须提示重启：宿主代码在进程内执行，不重启等于没迁。这句文案就是整条链路的闭环。
  assert.match(clientSource, /已迁移到 ' \+ UPGRADE_TARGET_PACKAGE \+ ' v' \+ upgradeState\.version \+ '，重启宿主后生效/)
})
