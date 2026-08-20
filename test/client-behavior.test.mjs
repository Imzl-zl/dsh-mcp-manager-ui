import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const clientSource = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
const exportMarker = 'exports.inject = inject;'
const instrumentedClient = clientSource.replace(
  exportMarker,
  `${exportMarker}\nexports.__test = { MCP_CSS, MCP_PRESETS, ToolRow, clearRevealState, consumeRevision, copyText };`,
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
