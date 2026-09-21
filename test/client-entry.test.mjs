import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

// 入口显示偏好（悬浮按钮 / 侧栏入口）住在客户端 bundle 里，而组件在 node 里渲染不起来
// （测试替身的 hooks 是空实现，见 client-behavior.test.mjs）。所以这里沿用同一套注入手法：
// 在 bundle 的导出标记处挂一个 __entry test surface，只测**能脱离渲染被测的那部分**——
// 偏好表、读写与通知、以及 overlay 的渲染决策。组件的接线（谁读表、谁渲染什么）在文件末尾
// 单独钉源码，避免「测试测的函数已经不是组件真正用的那个」。
const clientSource = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
const exportMarker = 'exports.inject = inject;'
const testSurface = [
  'ENTRY_KEY',
  'ENTRY_VISIBILITY',
  'ENTRY_LABELS',
  'ENTRY_MODES',
  'ENTRY_DEFAULT',
  'normalizeEntryMode',
  'readEntryMode',
  'entryMode',
  'overlaySeats',
].join(', ')
const instrumentedClient = clientSource.replace(
  exportMarker,
  `${exportMarker}\nexports.__entry = { ${testSurface} };`,
)

assert.notEqual(instrumentedClient, clientSource, 'client test export marker must stay current')

// storage === undefined：模拟环境里没有 localStorage（vm 默认就是这样）。
function loadEntryInternals(storage) {
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
  const context = {
    console,
    document: { addEventListener() {}, removeEventListener() {} },
    navigator: {},
    setInterval,
    setTimeout,
    clearInterval,
    clearTimeout,
    window: {
      isSecureContext: false,
      __ModuleLoader__: {
        load(definition) {
          client = definition.factory((name) => {
            assert.equal(name, 'react')
            return react
          })
        },
      },
    },
  }
  if (storage !== undefined) context.localStorage = storage
  vm.runInNewContext(instrumentedClient, context)
  return client.__entry
}

function fakeStorage(initial = {}) {
  const entries = new Map(Object.entries(initial))
  return {
    entries,
    getItem: (key) => (entries.has(key) ? entries.get(key) : null),
    setItem: (key, value) => { entries.set(key, value) },
  }
}

test('every entry mode keeps at least one entry point visible', () => {
  const { ENTRY_VISIBILITY, ENTRY_MODES, ENTRY_LABELS, ENTRY_DEFAULT } = loadEntryInternals()
  assert.ok(ENTRY_MODES.length >= 2)
  assert.equal(ENTRY_MODES.includes(ENTRY_DEFAULT), true, '默认模式必须在表里')
  // 这是整套设计的核心不变式：面板只能从这两个入口打开，「两个都关」会让用户再也打不开面板
  // （除了手改 localStorage）。它不由 UI 的禁用逻辑保证，而由这张表保证——所以对表断言。
  for (const mode of ENTRY_MODES) {
    assert.ok(
      ENTRY_VISIBILITY[mode].fab || ENTRY_VISIBILITY[mode].sidebar,
      `模式 ${mode} 会把两个入口都关掉，用户再也打不开面板`,
    )
    assert.equal(typeof ENTRY_LABELS[mode], 'string', `模式 ${mode} 缺少菜单文案`)
  }
  // 新增入口时先在这里红，而不是等用户把自己锁在门外。
  assert.deepEqual([...ENTRY_MODES].sort(), ['both', 'fab', 'sidebar'])
})

test('an unknown stored value falls back to the default instead of hiding every entry', () => {
  const { normalizeEntryMode, ENTRY_DEFAULT } = loadEntryInternals()
  for (const mode of ['both', 'fab', 'sidebar']) assert.equal(normalizeEntryMode(mode), mode)
  // 原型链上的键也要挡住：`hasOwnProperty` 缺失时会读到 Object.prototype 上的函数值，
  // 拿去查表得到 undefined 可见性，等于悄悄关掉所有入口。
  for (const value of [null, undefined, '', 'none', 'BOTH', 'fab,sidebar', '{}', '__proto__', 'constructor', 'toString']) {
    assert.equal(normalizeEntryMode(value), ENTRY_DEFAULT, `${String(value)} 必须退回默认`)
  }
})

test('readEntryMode survives missing, unknown and broken storage', () => {
  const { ENTRY_KEY, readEntryMode, ENTRY_DEFAULT } = loadEntryInternals()
  assert.equal(loadEntryInternals(fakeStorage({ [ENTRY_KEY]: 'sidebar' })).readEntryMode(), 'sidebar')
  assert.equal(loadEntryInternals(fakeStorage({ [ENTRY_KEY]: 'none' })).readEntryMode(), ENTRY_DEFAULT)
  // 环境没有 localStorage（无痕 / 非浏览器宿主）。
  assert.equal(readEntryMode(), ENTRY_DEFAULT)
  const blocked = {
    getItem() { throw new Error('storage blocked') },
    setItem() { throw new Error('storage blocked') },
  }
  assert.equal(loadEntryInternals(blocked).readEntryMode(), ENTRY_DEFAULT)
})

test('entryMode persists the choice, notifies subscribers, and never stores an unknown value', () => {
  const storage = fakeStorage()
  const { entryMode, ENTRY_KEY, ENTRY_DEFAULT } = loadEntryInternals(storage)
  const seen = []
  const unsubscribe = entryMode.subscribe(() => seen.push(entryMode.get()))

  assert.equal(entryMode.get(), ENTRY_DEFAULT)
  entryMode.set('sidebar')
  assert.equal(storage.entries.get(ENTRY_KEY), 'sidebar', '选择必须落盘')
  assert.deepEqual(seen, ['sidebar'], '订阅者必须被通知')

  entryMode.set('sidebar')
  assert.deepEqual(seen, ['sidebar'], '相同值不重复通知')

  // 未知值按同一套归一化处理，不让垃圾进存储。
  entryMode.set('nonsense')
  assert.equal(entryMode.get(), ENTRY_DEFAULT)
  assert.equal(storage.entries.get(ENTRY_KEY), ENTRY_DEFAULT)
  assert.deepEqual(seen, ['sidebar', ENTRY_DEFAULT])

  unsubscribe()
  entryMode.set('fab')
  assert.deepEqual(seen, ['sidebar', ENTRY_DEFAULT], '退订后不再通知')
})

test('the overlay renders the panel whenever it is open, regardless of the floating button', () => {
  const { overlaySeats } = loadEntryInternals()
  // 跨 realm 的普通对象，字段逐个断（deepStrictEqual 会连原型一起比）。
  const seatsFor = (mode, open) => {
    const seats = overlaySeats(mode, open)
    return { panel: seats.panel, fab: seats.fab }
  }
  // 「仅侧栏入口」+ 面板打开：这是把悬浮按钮关掉后**唯一**还能看到面板的形态，必须渲染面板。
  assert.deepEqual(seatsFor('sidebar', true), { panel: true, fab: false })
  assert.deepEqual(seatsFor('sidebar', false), { panel: false, fab: false })
  for (const mode of ['both', 'fab', 'sidebar']) {
    for (const open of [true, false]) {
      const seats = seatsFor(mode, open)
      // 面板的渲染只看 open，不看入口偏好——侧栏入口只改 panelVisibility，
      // 真正渲染面板的是这个组件，用偏好门住它 = 侧栏入口点了没反应。
      assert.equal(seats.panel, open, `${mode}/${open} 下面板必须只由 open 决定`)
      assert.equal(seats.panel && seats.fab, false, '面板与悬浮按钮不能同时占位')
    }
  }
})

test('the two entry components consume the visibility table', () => {
  // 上面测的是决策函数，这里钉它们的调用点：改回「面板也跟着悬浮按钮一起消失」或
  // 「侧栏入口不看偏好」时，前面的断言仍然绿，但行为已经错了。
  assert.match(clientSource, /const mode = useEntryMode\(\);/)
  assert.match(clientSource, /const seats = overlaySeats\(mode, open\);/)
  assert.match(clientSource, /seats\.panel \? h\(McpTab/)
  assert.match(clientSource, /seats\.fab \? h\(/)
  assert.match(clientSource, /if \(!ENTRY_VISIBILITY\[mode\]\.sidebar\) return null;/)
})
