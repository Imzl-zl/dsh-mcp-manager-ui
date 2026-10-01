import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const clientSource = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
const exportMarker = 'exports.inject = inject;'
const instrumentedClient = clientSource.replace(
  exportMarker,
  `${exportMarker}\nexports.__test = { MCP_CSS, MCP_PRESETS, ToolRow, clearRevealState, consumeRevision, copyText, startVisibilityAwarePolling, wsSub };`,
)

assert.notEqual(instrumentedClient, clientSource, 'client test export marker must stay current')

function loadClientInternals(execCommand) {
  const bodyChildren = []
  const body = {
    appendChild(node) {
      bodyChildren.push(node)
      node.isConnected = true
    },
    removeChild(node) {
      const index = bodyChildren.indexOf(node)
      if (index >= 0) bodyChildren.splice(index, 1)
      node.isConnected = false
    },
  }
  const document = {
    body,
    execCommand,
    createElement(name) {
      assert.equal(name, 'textarea')
      return {
        style: {},
        value: '',
        isConnected: false,
        select() {},
        remove() {
          body.removeChild(this)
        },
      }
    },
  }
  const react = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children }
    },
    useCallback(callback) {
      return callback
    },
    useEffect() {},
    useMemo(factory) {
      return factory()
    },
    useRef(value) {
      return { current: value }
    },
    useState(value) {
      return [value, () => {}]
    },
  }
  let client
  const window = {
    isSecureContext: false,
    __ModuleLoader__: {
      load(definition) {
        client = definition.factory((name) => {
          assert.equal(name, 'react')
          return react
        })
      },
    },
  }
  vm.runInNewContext(instrumentedClient, {
    console,
    document,
    navigator: {},
    setInterval,
    setTimeout,
    clearInterval,
    clearTimeout,
    window,
  })
  return { bodyChildren, internals: client.__test }
}

test('reveal revision consumption ignores initial and unchanged values', () => {
  const { internals } = loadClientInternals(() => true)
  const ref = { current: '' }

  assert.equal(internals.consumeRevision(ref, undefined), false)
  assert.equal(ref.current, '')
  assert.equal(internals.consumeRevision(ref, 'profile-a'), false)
  assert.equal(ref.current, 'profile-a')
  assert.equal(internals.consumeRevision(ref, 'profile-a'), false)
  assert.equal(internals.consumeRevision(ref, 'profile-b'), true)
  assert.equal(ref.current, 'profile-b')
})

test('clearing reveal state invalidates pending loads and drops plaintext', () => {
  const { internals } = loadClientInternals(() => true)
  const generation = { current: 4 }
  const updates = []
  const busy = []

  internals.clearRevealState(generation, (value) => updates.push(value), (value) => busy.push(value))

  assert.equal(generation.current, 5)
  assert.equal(updates.length, 1)
  assert.deepEqual(Object.keys(updates[0]), [])
  assert.deepEqual(busy, [''])
})

test('clipboard fallback reports a false execCommand result as failure', async () => {
  const { bodyChildren, internals } = loadClientInternals(() => false)

  assert.equal(await internals.copyText('secret'), false)
  assert.equal(bodyChildren.length, 0)
})

test('clipboard fallback always removes its temporary plaintext textarea', async () => {
  const { bodyChildren, internals } = loadClientInternals(() => {
    throw new Error('clipboard blocked')
  })

  assert.equal(await internals.copyText('secret'), false)
  assert.equal(bodyChildren.length, 0)
})

test('time preset uses the official uvx package', () => {
  const { internals } = loadClientInternals(() => true)
  const preset = internals.MCP_PRESETS.find((item) => item.id === 'time')

  assert.equal(preset.command, 'uvx')
  assert.deepEqual(Array.from(preset.args), ['mcp-server-time'])
})

test('schema-less tools are static rows instead of inert keyboard buttons', () => {
  const { internals } = loadClientInternals(() => true)
  const row = internals.ToolRow({ tool: { name: 'plain', description: '', parameters: null } })
  const head = row.children[0]

  assert.equal(head.props.role, undefined)
  assert.equal(head.props.tabIndex, undefined)
  assert.equal(head.props.onClick, undefined)
  assert.equal(head.props.onKeyDown, undefined)
})

test('narrow connection details stack grids and allow long secret keys to wrap', () => {
  const { internals } = loadClientInternals(() => true)

  assert.match(internals.MCP_CSS, /@media \(max-width:480px\)\{[^]*?\.dsh-mcp-kv\{grid-template-columns:1fr;/)
  assert.match(internals.MCP_CSS, /\.dsh-mcp-secret-row b\{[^}]*overflow-wrap:anywhere/)
})

test('polling pauses while the tab is hidden and refreshes on return', () => {
  const { internals } = loadClientInternals(() => true)
  const { startVisibilityAwarePolling } = internals
  let ticks = 0
  const listeners = {}
  const doc = {
    visibilityState: 'visible',
    addEventListener(name, fn) { listeners[name] = fn },
    removeEventListener(name) { delete listeners[name] },
  }
  let intervalFn = null
  let intervalDisposed = false
  const timer = { interval(fn) { intervalFn = fn; return () => { intervalDisposed = true } } }

  const dispose = startVisibilityAwarePolling(doc, timer, 5000, () => { ticks += 1 })

  intervalFn()
  assert.equal(ticks, 1, '可见时正常轮询')

  doc.visibilityState = 'hidden'
  intervalFn()
  intervalFn()
  assert.equal(ticks, 1, '不可见时不应拉取')

  doc.visibilityState = 'visible'
  listeners.visibilitychange()
  assert.equal(ticks, 2, '恢复可见应立即补一次，避免看到陈旧数据')

  dispose()
  assert.equal(intervalDisposed, true)
  assert.equal(listeners.visibilitychange, undefined, '监听器必须解绑')
})

// 项目行的文案把**两个独立事实**分开说：连接在不在、几个会话在用。
// 旧实现把两者压成一句「待会话挂载」，用户读成"还没连上/排队中"，而事实常常是
// "连接在、只是当前没会话用" —— 这条测试就是钉住这个区分。
test('project row wording separates connection state from projection scope', () => {
  const { internals } = loadClientInternals(() => true)
  const { wsSub } = internals
  const base = { status: 'connected', refs: 0, toolCount: 41 }

  // 连接在、没人用：必须说清"连接保留"，而不是含糊的"待挂载"。
  assert.equal(wsSub(base), '已连接 · 当前无会话使用（连接保留，下次直接用） · 41 工具')
  assert.equal(wsSub({ ...base, refs: 2 }), '已连接 · 2 个会话在用 · 41 工具')

  // 连接不在、以及各类失败，各自可辨（不再互相冒充）。
  assert.equal(wsSub({ status: 'stopped', refs: 0 }), '尚未建立连接（新会话自动挂载）')
  assert.equal(wsSub({ status: 'loading' }), '连接中…')
  assert.equal(wsSub({ status: 'failed' }), '连接失败')
  assert.equal(wsSub({ status: 'failed', mountFailed: true }), '挂载失败')
  assert.equal(wsSub({ status: 'connected', scopeFailed: true }), '作用域隔离失败')
  assert.equal(wsSub({ status: 'disabled' }), '已禁用')
  assert.equal(wsSub({ status: 'unknown' }), '状态未知')

  // 任何分支都不得回到那句被误解的合成文案。
  for (const row of [base, { ...base, refs: 3 }, { status: 'failed' }, { status: 'stopped' }]) {
    assert.doesNotMatch(wsSub(row), /待会话挂载/)
  }
})
