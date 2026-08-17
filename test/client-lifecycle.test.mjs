import assert from 'node:assert/strict'
import test from 'node:test'
import { TYPERT } from '../lib/typert.js'

const fakeReact = {
  Fragment: Symbol('Fragment'),
  createElement() {},
  useCallback() {},
  useEffect() {},
  useState() {},
}

function createFakeDocument(options = {}) {
  const styles = []
  const head = {
    appendChild(node) {
      if (options.appendError) throw options.appendError
      styles.push(node)
      node.remove = () => {
        if (options.removeError) throw options.removeError
        styles.splice(styles.indexOf(node), 1)
      }
    },
  }

  return {
    head,
    styles,
    createElement(name) {
      assert.equal(name, 'style')
      return { dataset: {}, textContent: '' }
    },
    querySelector(selector) {
      const id = /data-plugin-css="([^"]+)"/.exec(selector)?.[1]
      return styles.find((style) => style.dataset.pluginCss === id) ?? null
    },
  }
}

async function loadClient(document) {
  let client
  globalThis.document = document
  globalThis.window = {
    __ModuleLoader__: {
      load(definition) {
        client = definition.factory((name) => {
          assert.equal(name, 'react')
          return fakeReact
        })
      },
    },
  }

  await import(`../lib/client.js?test=${Date.now()}-${Math.random()}`)
  return {
    client,
    cleanup() {
      delete globalThis.document
      delete globalThis.window
    },
  }
}

test('client Remote contribution matches the generated Typert contract', async () => {
  const document = createFakeDocument()
  const { client, cleanup } = await loadClient(document)
  let contribution
  const ctx = {
    remote: {
      async $mount(value) {
        contribution = value
        return async () => {}
      },
    },
    slots: { inject() {} },
  }

  try {
    const dispose = await client.apply(ctx)
    const actual = contribution.descriptors.map((descriptor) => ({
      id: descriptor.id,
      parameters: descriptor.parameters.map((parameter) => ({ mode: parameter.codec.mode, typeSymbol: parameter.codec.typeSymbol })),
      result: { mode: descriptor.result.mode, typeSymbol: descriptor.result.typeSymbol },
      sourceLocation: descriptor.sourceLocation,
    }))
    const expected = TYPERT.invocations.map((invocation) => ({
      id: invocation.id,
      parameters: invocation.parameters.map((parameter) => ({ mode: parameter.codec.mode, typeSymbol: parameter.codec.typeSymbol })),
      result: { mode: invocation.result.mode, typeSymbol: invocation.result.typeSymbol },
      sourceLocation: invocation.sourceLocation,
    }))
    assert.deepEqual(actual, expected)
    const nameCodec = contribution.descriptors.find((descriptor) => descriptor.method === 'status').parameters[0].codec
    assert.throws(() => nameCodec.schema.parse(42), /string/i)
    await dispose()
  } finally {
    cleanup()
  }
})

test('client mount failure aborts plugin activation without UI side effects', async () => {
  const document = createFakeDocument()
  const { client, cleanup } = await loadClient(document)
  const duplicate = new Error('Remote package "dsh-mcp-manager-ui" is already registered')
  const ctx = {
    remote: {
      async $mount() {
        throw duplicate
      },
    },
    slots: {
      inject() {
        throw new Error('slots must not register after Remote mount fails')
      },
    },
  }

  try {
    await assert.rejects(client.apply(ctx), duplicate)
    assert.equal(document.styles.length, 0)
  } finally {
    cleanup()
  }
})

test('stylesheet setup failure rolls back Remote registration', async () => {
  const cssError = new Error('stylesheet append failed')
  const document = createFakeDocument({ appendError: cssError })
  const { client, cleanup } = await loadClient(document)
  let remoteDisposed = false
  const ctx = {
    remote: {
      async $mount() {
        return async () => {
          await Promise.resolve()
          remoteDisposed = true
        }
      },
    },
    slots: {
      inject() {
        throw new Error('slots must not register after stylesheet setup fails')
      },
    },
  }

  try {
    await assert.rejects(client.apply(ctx), cssError)
    assert.equal(remoteDisposed, true)
  } finally {
    cleanup()
  }
})

test('client disposer releases Remote registration and stylesheet', async () => {
  const document = createFakeDocument()
  const { client, cleanup } = await loadClient(document)
  let remoteDisposed = false
  let releaseRemote
  const slots = []
  let timer
  const ctx = {
    remote: {
      async $mount() {
        return async () => {
          await new Promise((resolve) => {
            releaseRemote = resolve
          })
          remoteDisposed = true
        }
      },
    },
    slots: {
      inject(name, mount) {
        slots.push(name)
        mount()
      },
      register(options) {
        timer = options.inject().timer
      },
    },
  }

  try {
    const dispose = await client.apply(ctx)
    assert.deepEqual(slots, ['shell.overlay'])
    assert.equal(document.styles.length, 1)

    let timeoutFired = false
    timer.timeout(() => {
      timeoutFired = true
    }, 0)

    const disposing = dispose()
    assert.equal(typeof disposing?.then, 'function')
    assert.equal(remoteDisposed, false)
    assert.equal(document.styles.length, 0)

    releaseRemote()
    await disposing
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(remoteDisposed, true)
    assert.equal(timeoutFired, false)
  } finally {
    cleanup()
  }
})

test('Remote teardown still completes when stylesheet cleanup fails', async () => {
  const cssError = new Error('stylesheet removal failed')
  const document = createFakeDocument({ removeError: cssError })
  const { client, cleanup } = await loadClient(document)
  let remoteDisposed = false
  const ctx = {
    remote: {
      async $mount() {
        return async () => {
          await Promise.resolve()
          remoteDisposed = true
        }
      },
    },
    slots: {
      inject() {},
    },
  }

  try {
    const dispose = await client.apply(ctx)
    await assert.rejects(dispose(), cssError)
    assert.equal(remoteDisposed, true)
  } finally {
    cleanup()
  }
})
