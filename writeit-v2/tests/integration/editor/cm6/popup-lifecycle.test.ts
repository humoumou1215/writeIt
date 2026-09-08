// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { ViewPlugin, type EditorView } from '@codemirror/view'
import {
  createCompletionExtension,
  createSlashQuickInsertExtension,
  mountSingleDocumentView,
  type SingleDocumentView,
} from '../../../../src/editor/cm6'
import type {
  CompletionSurfaceItem,
  CompletionSurfaceRegistry,
} from '../../../../src/editor/cm6/extensions/completion'
import {
  createDocumentId,
  createDocumentOrigin,
  createDocumentPath,
  documentById,
  DocumentStore,
} from '../../../../src/core/document'
import type {
  SlashQuickInsertCommand,
  SlashQuickInsertRegistry,
} from '../../../../src/editor/cm6/extensions/slash-quick-insert'

const mountedViews: SingleDocumentView[] = []
const rawViews = new WeakMap<SingleDocumentView, EditorView>()

function makeStore(markdown = ''): {
  store: DocumentStore
  locator: ReturnType<typeof documentById>
} {
  const store = new DocumentStore()
  const id = createDocumentId(`popup-lifecycle-${mountedViews.length}`)
  const path = createDocumentPath(`popup-lifecycle-${mountedViews.length}.md`)
  store.load({ id, path, markdown })
  return { store, locator: documentById(id) }
}

function mount(
  store: DocumentStore,
  locator: ReturnType<typeof documentById>,
  extension: NonNullable<
    Parameters<typeof mountSingleDocumentView>[0]['extensions']
  >[number],
  editable = true,
): SingleDocumentView {
  let rawView: EditorView | undefined
  const captureView = ViewPlugin.define((view) => {
    rawView = view
    return {}
  })
  const projection = mountSingleDocumentView({
    store,
    locator,
    parent: document.body,
    projectionId: `popup-lifecycle-editor-${mountedViews.length}`,
    editable,
    extensions: [captureView, extension],
  })
  if (!rawView) throw new Error('CM6 view was not captured')
  rawViews.set(projection, rawView)
  mountedViews.push(projection)
  return projection
}

function rawView(projection: SingleDocumentView): EditorView {
  const view = rawViews.get(projection)
  if (!view) throw new Error('CM6 view is not captured')
  return view
}

function typeSource(projection: SingleDocumentView, source: string): void {
  rawView(projection).dispatch({
    changes: {
      from: 0,
      to: projection.view.state.doc.length,
      insert: source,
    },
    selection: { anchor: source.length },
  })
}

function press(
  projection: SingleDocumentView,
  init: KeyboardEventInit,
): void {
  rawView(projection).dom.dispatchEvent(
    new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ...init,
    }),
  )
}

function composition(
  projection: SingleDocumentView,
  type: 'compositionstart' | 'compositionend',
): void {
  rawView(projection).dom.dispatchEvent(
    new CompositionEvent(type, { bubbles: true }),
  )
}

function popup(projection: SingleDocumentView, selector: string): HTMLElement {
  const menu = projection.view.dom.querySelector<HTMLElement>(selector)
  if (!menu) throw new Error(`Popup ${selector} is not mounted`)
  return menu
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(() => {
  for (const projection of mountedViews.splice(0)) projection.destroy()
})

describe('popup IME and lifecycle safety', () => {
  it('does not let IME Enter or keyCode 229 execute slash commands', () => {
    const { store, locator } = makeStore()
    const command: SlashQuickInsertCommand = {
      id: 'insert',
      label: 'Insert',
      group: 'Test',
      keywords: [],
    }
    const registry: SlashQuickInsertRegistry = {
      list: () => [command],
      isAvailable: () => true,
      execute: (_id, context) => context.replace('done'),
    }
    const projection = mount(
      store,
      locator,
      createSlashQuickInsertExtension({ registry }),
    )
    typeSource(projection, '/')
    expect(popup(projection, '[data-slash-menu]').dataset.show).toBe('true')

    press(projection, { key: 'Enter', isComposing: true })
    const legacyImeEnter = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    })
    Object.defineProperty(legacyImeEnter, 'keyCode', { configurable: true, value: 229 })
    projection.view.dom.dispatchEvent(legacyImeEnter)

    expect(store.get(locator)?.markdown).toBe('/')
    expect(store.get(locator)?.revision).toBe(1)
  })

  it('cancels slash availability work during composition and refreshes after compositionend', async () => {
    const { store, locator } = makeStore()
    const availabilityResolvers: Array<(available: boolean) => void> = []
    let availabilityCalls = 0
    const command: SlashQuickInsertCommand = {
      id: 'insert',
      label: 'Insert',
      group: 'Test',
      keywords: [],
    }
    const registry: SlashQuickInsertRegistry = {
      list: () => [command],
      isAvailable: () => {
        availabilityCalls += 1
        return new Promise<boolean>((resolve) => {
          availabilityResolvers.push(resolve)
        })
      },
      execute: () => undefined,
    }
    const projection = mount(
      store,
      locator,
      createSlashQuickInsertExtension({ registry }),
    )
    typeSource(projection, '/')
    const menu = popup(projection, '[data-slash-menu]')
    expect(availabilityCalls).toBe(1)

    composition(projection, 'compositionstart')
    expect(menu.dataset.show).toBe('false')
    availabilityResolvers[0]?.(true)
    await flush()
    expect(menu.dataset.show).toBe('false')

    composition(projection, 'compositionend')
    expect(availabilityCalls).toBe(2)
    availabilityResolvers[1]?.(true)
    await flush()
    expect(menu.dataset.show).toBe('true')
  })

  it('restarts a pending completion query after composition cancellation', async () => {
    const { store, locator } = makeStore()
    const resolvers: Array<(items: readonly CompletionSurfaceItem[]) => void> = []
    let calls = 0
    const registry: CompletionSurfaceRegistry = {
      complete: () => {
        calls += 1
        return new Promise<readonly CompletionSurfaceItem[]>((resolve) => {
          resolvers.push(resolve)
        })
      },
    }
    const projection = mount(
      store,
      locator,
      createCompletionExtension({ registry }),
    )
    typeSource(projection, '@a')
    const menu = popup(projection, '[data-completion-menu]')
    expect(calls).toBe(1)

    composition(projection, 'compositionstart')
    expect(menu.dataset.show).toBe('false')
    resolvers[0]?.([])
    await flush()

    composition(projection, 'compositionend')
    expect(calls).toBe(2)
    resolvers[1]?.([
      { id: 'alpha', label: 'Alpha', insertText: '[[alpha.md]]' },
    ])
    await flush()

    expect(menu.dataset.show).toBe('true')
    expect(menu.querySelector('[data-completion-id="alpha"]')).not.toBeNull()
    expect(store.get(locator)?.markdown).toBe('@a')
    expect(store.get(locator)?.revision).toBe(1)
  })

  it.each([
    ['slash', 'slash'] as const,
    ['completion', 'completion'] as const,
  ])('rejects a readonly %s popup mutation', (kind, _label) => {
    const { store, locator } = makeStore()
    store.applyChange(locator, {
      markdown: kind === 'slash' ? '/' : '@',
      origin: createDocumentOrigin('test', 'readonly-trigger'),
    })
    const extension =
      kind === 'slash'
        ? createSlashQuickInsertExtension({
            registry: {
              list: () => [
                {
                  id: 'insert',
                  label: 'Insert',
                  group: 'Test',
                  keywords: [],
                },
              ],
              isAvailable: () => true,
              execute: (_id, context) => context.replace('done'),
            },
          })
        : createCompletionExtension({
            registry: {
              complete: () => [
                { id: 'alpha', label: 'Alpha', insertText: 'done' },
              ],
            },
          })
    const projection = mount(store, locator, extension, false)
    rawView(projection).dispatch({ selection: { anchor: 1 } })
    const menu = popup(
      projection,
      kind === 'slash' ? '[data-slash-menu]' : '[data-completion-menu]',
    )
    expect(menu.dataset.show).toBe('true')
    press(projection, { key: 'Enter' })

    expect(store.get(locator)?.markdown).toBe(kind === 'slash' ? '/' : '@')
    expect(store.get(locator)?.revision).toBe(1)
  })

  it('rejects a popup mutation from a stale projection', () => {
    const { store, locator } = makeStore()
    const projection = mount(
      store,
      locator,
      createSlashQuickInsertExtension({
        registry: {
          list: () => [
            { id: 'insert', label: 'Insert', group: 'Test', keywords: [] },
          ],
          isAvailable: () => true,
          execute: (_id, context) => context.replace('late'),
        },
      }),
    )
    typeSource(projection, '/')
    store.markProjectionStale(locator, projection.projectionId, 'stale test')
    press(projection, { key: 'Enter' })

    expect(store.get(locator)?.markdown).toBe('/')
    expect(store.get(locator)?.revision).toBe(1)
  })

  it('rejects a late slash command after the projection is destroyed', async () => {
    const { store, locator } = makeStore()
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const projection = mount(
      store,
      locator,
      createSlashQuickInsertExtension({
        registry: {
          list: () => [
            { id: 'insert', label: 'Insert', group: 'Test', keywords: [] },
          ],
          isAvailable: () => true,
          execute: async (_id, context) => {
            await pending
            context.replace('late')
          },
        },
      }),
    )
    typeSource(projection, '/')
    press(projection, { key: 'Enter' })
    projection.destroy()
    release()
    await flush()

    expect(store.get(locator)?.markdown).toBe('/')
    expect(store.get(locator)?.revision).toBe(1)
  })

  it('rejects a late completion result after a source revision race', async () => {
    const { store, locator } = makeStore()
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const projection = mount(
      store,
      locator,
      createCompletionExtension({
        registry: {
          complete: () => [
            {
              id: 'alpha',
              label: 'Alpha',
              apply: async (context) => {
                await pending
                return {
                  from: context.trigger.from,
                  to: context.trigger.to,
                  insert: 'late',
                }
              },
            },
          ],
        },
      }),
    )
    typeSource(projection, '@')
    press(projection, { key: 'Enter' })
    store.applyChange(locator, {
      markdown: '@changed',
      origin: createDocumentOrigin('test', 'race'),
    })
    release()
    await flush()

    expect(store.get(locator)?.markdown).toBe('@changed')
    expect(store.get(locator)?.revision).toBe(2)
  })
})
