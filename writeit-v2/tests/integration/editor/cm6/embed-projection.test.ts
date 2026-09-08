// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorView } from '@codemirror/view'
import {
  createDocumentId,
  createDocumentOrigin,
  createDocumentPath,
  documentById,
  DocumentStore,
} from '../../../../src/core/document'
import {
  ReferenceGraph,
  ReferenceHealthService,
} from '../../../../src/core/reference'
import {
  createEmbedProjectionExtension,
  createReferenceNavigationExtension,
  mountSingleDocumentView,
  type EmbedProjectionExtensionOptions,
  type SingleDocumentView,
} from '../../../../src/editor/cm6'
import { WorkspaceImageProjectionResolver } from '../../../../src/editor/preview'
import { MemoryFileSystem } from '../../../../src/platform/filesystem'

const mounted: SingleDocumentView[] = []

function loadDocument(
  store: DocumentStore,
  id: string,
  path: string,
  markdown: string,
): ReturnType<typeof documentById> {
  const document = store.load({
    id: createDocumentId(id),
    path: createDocumentPath(path),
    markdown,
  })
  return documentById(document.id)
}

function mountEmbed(
  store: DocumentStore,
  locator: ReturnType<typeof documentById>,
  projectionId: string,
  editable = true,
  options: Pick<EmbedProjectionExtensionOptions, 'imageProjection' | 'onOpen'> = {},
): SingleDocumentView {
  const projection = mountSingleDocumentView({
    store,
    locator,
    parent: document.body,
    projectionId,
    editable,
    presentationMode: 'live-preview',
    extensions: [
      createEmbedProjectionExtension({
        store,
        locator,
        getAvailablePaths: () => store.getAll().map((entry) => entry.path),
        ...options,
      }),
    ],
  })
  mounted.push(projection)
  return projection
}

async function flush(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve()
}

function deferred(): {
  readonly promise: Promise<void>
  readonly resolve: () => void
} {
  let resolvePromise!: () => void
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve
  })
  return {
    promise,
    resolve: resolvePromise,
  }
}

afterEach(() => {
  for (const projection of mounted.splice(0)) projection.destroy()
})

describe('CM6 embed projection', () => {
  it('mounts editable multi-projections, propagates revisions, supports undo, and exposes stale state', () => {
    const store = new DocumentStore()
    const a = loadDocument(store, 'embed-a', 'A.md', '# A\n\nsource')
    const b = loadDocument(store, 'embed-b', 'B.md', '# B\n\n![[A.md]]')
    const mainA = mountEmbed(store, a, 'main-a')
    const hostB = mountEmbed(store, b, 'host-b')

    const wrapper = hostB.view.dom.querySelector<HTMLElement>('[data-writeit-embed]')
    expect(wrapper?.dataset.embedStatus).toBe('mounted')
    const childElement = wrapper?.querySelector<HTMLElement>('.cm-editor')
    if (!childElement) throw new Error('editable embed editor was not mounted')
    const childView = EditorView.findFromDOM(childElement)
    if (!childView) throw new Error('editable embed CM6 view was not found')

    childView.dispatch({
      changes: { from: childView.state.doc.length, insert: '\nchild edit' },
    })

    expect(store.get(a)?.markdown).toBe('# A\n\nsource\nchild edit')
    expect(store.getRevision(a)).toBe(1)
    expect(mainA.view.state.doc.toString()).toBe('# A\n\nsource\nchild edit')
    expect(wrapper?.dataset.embedRevision).toBe('1')
    expect(wrapper?.dataset.embedStale).toBe('false')

    const childProjectionId = childElement.parentElement?.dataset.embedProjectionId
    if (!childProjectionId) throw new Error('embed projection id was not published')
    store.markProjectionStale(a, childProjectionId, 'test stale')
    expect(wrapper?.dataset.embedStale).toBe('true')
    expect(wrapper?.dataset.embedDegradedReason).toBe('test stale')

    store.applyChange(a, {
      markdown: '# A\n\nrecovered',
      origin: createDocumentOrigin('test', 'embed-recovery'),
    })
    expect(wrapper?.dataset.embedStale).toBe('false')
    expect(wrapper?.dataset.embedRevision).toBe('2')

    store.undo(a, createDocumentOrigin('test', 'embed-undo'))
    expect(store.get(a)?.markdown).toBe('# A\n\nsource\nchild edit')
    expect(mainA.view.state.doc.toString()).toBe('# A\n\nsource\nchild edit')
  })

  it('keeps editable card clicks in the child projection and exposes an explicit open action', async () => {
    const store = new DocumentStore()
    const target = loadDocument(store, 'interaction-target', 'Target.md', 'target')
    const host = loadDocument(
      store,
      'interaction-host',
      'Host.md',
      '![[Target.md]]',
    )
    const hostDocument = store.get(host)
    if (!hostDocument) throw new Error('host document was not loaded')
    const graph = new ReferenceGraph({
      workspacePaths: ['Host.md', 'Target.md'],
      documents: [hostDocument],
    })
    const health = new ReferenceHealthService({ graph })
    const opened = vi.fn()
    const targetMain = mountEmbed(store, target, 'interaction-target-main')
    const projection = mountSingleDocumentView({
      store,
      locator: host,
      parent: document.body,
      projectionId: 'interaction-host',
      editable: true,
      presentationMode: 'live-preview',
      extensions: [
        createReferenceNavigationExtension({
          sourcePath: 'Host.md',
          healthResolver: health,
          onOpen: opened,
        }),
        createEmbedProjectionExtension({
          store,
          locator: host,
          getAvailablePaths: () => store.getAll().map((entry) => entry.path),
          onOpen: (path, fragment) => opened(path, fragment),
        }),
      ],
    })
    mounted.push(projection)
    await flush()

    const wrapper = projection.view.dom.querySelector<HTMLElement>(
      '[data-writeit-embed][data-embed-status="mounted"]',
    )
    const childElement = wrapper?.querySelector<HTMLElement>('.cm-editor')
    if (!childElement) throw new Error('editable embed editor was not mounted')
    const childView = EditorView.findFromDOM(childElement)
    if (!childView) throw new Error('editable embed CM6 view was not found')

    childView.contentDOM.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
    )
    childView.contentDOM.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    )
    expect(opened).not.toHaveBeenCalled()
    expect(childView.hasFocus).toBe(true)

    childView.dispatch({
      changes: { from: childView.state.doc.length, insert: ' edited' },
    })
    expect(store.get(host)?.markdown).toBe('![[Target.md]]')
    expect(store.get(target)?.markdown).toBe('target edited')
    expect(store.getRevision(target)).toBe(1)
    expect(store.getHistory(target).undo).toHaveLength(1)
    expect(targetMain.view.state.doc.toString()).toBe('target edited')

    const openButton = wrapper?.querySelector<HTMLButtonElement>(
      '[data-embed-action="open"]',
    )
    openButton?.click()
    expect(opened).toHaveBeenCalledTimes(1)
    expect(opened).toHaveBeenCalledWith('Target.md', null)
  })

  it('keeps readonly embed bodies non-editable while the explicit open action navigates', () => {
    const store = new DocumentStore()
    const target = loadDocument(store, 'readonly-action-target', 'Target.md', 'source')
    const host = loadDocument(
      store,
      'readonly-action-host',
      'Host.md',
      '![[Target.md|ro]]',
    )
    const opened = vi.fn()
    const projection = mountEmbed(store, host, 'readonly-action-host', true, {
      onOpen: (path, fragment) => opened(path, fragment),
    })

    const wrapper = projection.view.dom.querySelector<HTMLElement>(
      '[data-writeit-embed][data-embed-status="mounted"]',
    )
    const childElement = wrapper?.querySelector<HTMLElement>('.cm-editor')
    if (!childElement) throw new Error('readonly embed editor was not mounted')
    const childView = EditorView.findFromDOM(childElement)
    if (!childView) throw new Error('readonly embed CM6 view was not found')
    expect(childView.state.readOnly).toBe(true)

    childView.dispatch({
      changes: { from: childView.state.doc.length, insert: ' must not apply' },
    })
    expect(store.get(target)?.markdown).toBe('source')
    expect(store.getRevision(target)).toBe(0)
    wrapper?.querySelector<HTMLButtonElement>('[data-embed-action="open"]')?.click()
    expect(opened).toHaveBeenCalledWith('Target.md', null)
  })

  it('uses the target document path and shared resolver for nested embed images', async () => {
    const store = new DocumentStore()
    const targetPath = 'notes/deep/Target.md'
    const parentPath = 'notes/Parent.md'
    const target = loadDocument(
      store,
      'nested-image-target',
      targetPath,
      '![diagram](../assets/diagram.png)',
    )
    loadDocument(
      store,
      'nested-image-parent',
      parentPath,
      '![[notes/deep/Target.md]]',
    )
    const host = loadDocument(
      store,
      'nested-image-host',
      'Host.md',
      '![[notes/Parent.md]]',
    )
    const resolver = new WorkspaceImageProjectionResolver({
      reader: new MemoryFileSystem({
        binaryFiles: {
          'notes/assets/diagram.png': new Uint8Array([1, 2, 3]),
        },
      }),
    })
    const projection = mountEmbed(store, host, 'nested-image-host', true, {
      imageProjection: {
        imageResolver: resolver,
        documentPath: store.get(host)?.path,
      },
    })
    try {
      await flush()
      const image = projection.view.dom.querySelector<HTMLImageElement>(
        '[data-embed-target="notes/deep/Target.md"] .cm-writeit-live-preview-image__content',
      )
      expect(image?.dataset.imageStatus).toBe('ready')
      expect(image?.dataset.imagePath).toBe('notes/assets/diagram.png')
      expect(image?.src).toContain('data:image/png;base64,AQID')
      expect(store.get(target)?.markdown).toBe('![diagram](../assets/diagram.png)')
      expect(store.getRevision(target)).toBe(0)
    } finally {
      resolver.dispose()
    }
  })

  it('propagates one target revision through a nested C-to-B-to-A projection chain', () => {
    const store = new DocumentStore()
    const a = loadDocument(store, 'nested-a', 'NestedA.md', 'A')
    const b = loadDocument(store, 'nested-b', 'NestedB.md', '![[NestedA.md]]')
    const c = loadDocument(store, 'nested-c', 'NestedC.md', '![[NestedB.md]]')
    const projection = mountEmbed(store, c, 'nested-c-host')

    const nestedA = projection.view.dom.querySelector<HTMLElement>(
      '[data-embed-target="NestedA.md"] .cm-editor',
    )
    if (!nestedA) throw new Error('deep nested A projection was not mounted')
    const nestedAView = EditorView.findFromDOM(nestedA)
    if (!nestedAView) throw new Error('deep nested A CM6 view was not found')
    nestedAView.dispatch({ changes: { from: 0, insert: 'edited ' } })

    expect(store.get(a)?.markdown).toBe('edited A')
    expect(store.get(b)?.markdown).toBe('![[NestedA.md]]')
    expect(store.get(c)?.markdown).toBe('![[NestedB.md]]')
    expect(store.getProjections(a)).toHaveLength(1)
    expect(store.getProjections(b)).toHaveLength(1)
    expect(projection.view.dom.querySelector('[data-embed-stale="true"]')).toBeNull()
  })

  it('keeps readonly embeds source-backed and handles nested circular references', () => {
    const store = new DocumentStore()
    const a = loadDocument(store, 'readonly-a', 'A.md', 'readonly source')
    const readonlyHost = loadDocument(
      store,
      'readonly-host',
      'Readonly.md',
      '![[A.md|ro]]',
    )
    const cycleA = loadDocument(store, 'cycle-a', 'CycleA.md', '![[CycleB.md]]')
    const cycleB = loadDocument(store, 'cycle-b', 'CycleB.md', '![[CycleA.md]]')

    const readonlyProjection = mountEmbed(store, readonlyHost, 'readonly-host')
    const readonlyWrapper = readonlyProjection.view.dom.querySelector<HTMLElement>(
      '[data-writeit-embed]',
    )
    expect(readonlyWrapper?.dataset.embedMode).toBe('readonly')
    const readonlyEditor = readonlyWrapper?.querySelector<HTMLElement>('.cm-editor')
    if (!readonlyEditor) throw new Error('readonly embed editor was not mounted')
    const readonlyView = EditorView.findFromDOM(readonlyEditor)
    if (!readonlyView) throw new Error('readonly embed CM6 view was not found')
    expect(readonlyView.state.readOnly).toBe(true)
    readonlyView.dispatch({
      changes: { from: readonlyView.state.doc.length, insert: ' must not apply' },
    })
    expect(store.get(a)?.markdown).toBe('readonly source')
    expect(store.getRevision(a)).toBe(0)

    const cycleProjection = mountEmbed(store, cycleA, 'cycle-a-host')
    const circular = cycleProjection.view.dom.querySelector<HTMLElement>(
      '[data-embed-status="circular"]',
    )
    expect(circular?.textContent).toContain('Circular embed')
    expect(cycleProjection.view.dom.querySelectorAll('.cm-editor')).toHaveLength(1)
    expect(store.getProjections(cycleA).some((state) => state.stale)).toBe(false)
    expect(store.get(cycleB)?.markdown).toBe('![[CycleA.md]]')
  })

  it('coexists with reference health marks while replacing the embed token', () => {
    const store = new DocumentStore()
    const target = loadDocument(store, 'marked-target', 'MarkedTarget.md', 'target')
    const host = loadDocument(store, 'marked-host', 'MarkedHost.md', '![[MarkedTarget.md]]')
    const projection = mountSingleDocumentView({
      store,
      locator: host,
      parent: document.body,
      projectionId: 'marked-host',
      editable: true,
      presentationMode: 'live-preview',
      extensions: [
        createReferenceNavigationExtension({ sourcePath: 'MarkedHost.md' }),
        createEmbedProjectionExtension({
          store,
          locator: host,
          getAvailablePaths: () => ['MarkedHost.md', 'MarkedTarget.md'],
        }),
      ],
    })
    mounted.push(projection)

    expect(projection.view.dom.querySelector('[data-writeit-embed]')).not.toBeNull()
    expect(projection.view.dom.dataset.referenceCount).toBe('1')
    expect(store.get(target)?.markdown).toBe('target')
  })

  it('loads an unopened workspace target through the application callback without changing the host source', async () => {
    const store = new DocumentStore()
    const host = loadDocument(store, 'lazy-host', 'LazyHost.md', '![[LazyTarget.md]]')
    const projection = mountSingleDocumentView({
      store,
      locator: host,
      parent: document.body,
      projectionId: 'lazy-host',
      editable: true,
      presentationMode: 'live-preview',
      extensions: [
        createEmbedProjectionExtension({
          store,
          locator: host,
          getAvailablePaths: () => ['LazyHost.md', 'LazyTarget.md'],
          onTargetMissing: ({ path }) => {
            if (path !== 'LazyTarget.md') throw new Error('unexpected lazy path')
            loadDocument(store, 'lazy-target', 'LazyTarget.md', 'loaded target')
          },
        }),
      ],
    })
    mounted.push(projection)

    expect(projection.view.dom.querySelector('[data-embed-status="unloaded"]')).not.toBeNull()
    for (let index = 0; index < 5; index += 1) await Promise.resolve()
    expect(projection.view.dom.querySelector('[data-embed-status="mounted"]')).not.toBeNull()
    expect(store.get(host)?.markdown).toBe('![[LazyTarget.md]]')
    expect(store.getRevision(host)).toBe(0)
  })

  it('re-resolves a missing target when it appears during an in-flight load', async () => {
    const store = new DocumentStore()
    const host = loadDocument(store, 'appears-host', 'AppearsHost.md', '![[Appears.md]]')
    let notifyTargets: () => void = () => undefined
    const pending = deferred()
    let loadAttempts = 0
    const projection = mountSingleDocumentView({
      store,
      locator: host,
      parent: document.body,
      projectionId: 'appears-host',
      editable: true,
      presentationMode: 'live-preview',
      extensions: [
        createEmbedProjectionExtension({
          store,
          locator: host,
          getAvailablePaths: () => ['AppearsHost.md', 'Appears.md'],
          onTargetMissing: ({ path }) => {
            expect(path).toBe('Appears.md')
            loadAttempts += 1
            return pending.promise
          },
          subscribeTargets: (listener) => {
            notifyTargets = listener
            return () => undefined
          },
        }),
      ],
    })
    mounted.push(projection)

    expect(projection.view.dom.querySelector('[data-embed-status="unloaded"]')).not.toBeNull()
    const target = loadDocument(store, 'appears-target', 'Appears.md', 'appeared')
    notifyTargets()

    expect(loadAttempts).toBe(1)
    expect(projection.view.dom.querySelector('[data-embed-status="mounted"]')).not.toBeNull()
    expect(store.getProjections(target)).toHaveLength(1)
    expect(store.get(host)?.markdown).toBe('![[Appears.md]]')

    // The old loader may settle after an independent target event. It must no
    // longer own the current request or cause another refresh loop.
    pending.resolve()
    await Promise.resolve()
    expect(projection.view.dom.querySelector('[data-embed-status="mounted"]')).not.toBeNull()
  })

  it('does not permanently consume a transient load failure before retry', async () => {
    const store = new DocumentStore()
    const host = loadDocument(store, 'retry-host', 'RetryHost.md', '![[Retry.md]]')
    let notifyTargets: () => void = () => undefined
    let loadAttempts = 0
    const projection = mountSingleDocumentView({
      store,
      locator: host,
      parent: document.body,
      projectionId: 'retry-host',
      editable: true,
      presentationMode: 'live-preview',
      extensions: [
        createEmbedProjectionExtension({
          store,
          locator: host,
          getAvailablePaths: () => ['RetryHost.md', 'Retry.md'],
          onTargetMissing: () => {
            loadAttempts += 1
            if (loadAttempts === 1) {
              return Promise.reject(new Error('transient target load failure'))
            }
            loadDocument(store, 'retry-target', 'Retry.md', 'recovered target')
          },
          subscribeTargets: (listener) => {
            notifyTargets = listener
            return () => undefined
          },
        }),
      ],
    })
    mounted.push(projection)

    await Promise.resolve()
    await Promise.resolve()
    expect(loadAttempts).toBe(1)
    expect(projection.view.dom.dataset.embedTargetError).toContain(
      'transient target load failure',
    )
    expect(projection.view.dom.querySelector('[data-embed-status="error"]')).not.toBeNull()

    notifyTargets()
    await Promise.resolve()
    expect(loadAttempts).toBe(2)
    expect(projection.view.dom.querySelector('[data-embed-status="mounted"]')).not.toBeNull()
    expect(projection.view.dom.dataset.embedTargetError).toBeUndefined()
    expect(store.get(host)?.markdown).toBe('![[Retry.md]]')
  })

  it('rebuilds a nested target projection after removal and recreation', () => {
    const store = new DocumentStore()
    const a = loadDocument(store, 'rebuild-a', 'RebuildA.md', 'A')
    const b = loadDocument(store, 'rebuild-b', 'RebuildB.md', '![[RebuildA.md]]')
    const c = loadDocument(store, 'rebuild-c', 'RebuildC.md', '![[RebuildB.md]]')
    const projection = mountEmbed(store, c, 'rebuild-c-host')

    expect(
      projection.view.dom.querySelector('[data-embed-target="RebuildA.md"] .cm-editor'),
    ).not.toBeNull()
    store.applyChange(b, {
      markdown: 'B without target',
      origin: createDocumentOrigin('test', 'nested-remove'),
    })
    expect(
      projection.view.dom.querySelector('[data-embed-target="RebuildA.md"]'),
    ).toBeNull()

    store.unload(a)
    const replacement = loadDocument(store, 'rebuild-a-new', 'RebuildA.md', 'A recreated')
    store.applyChange(b, {
      markdown: '![[RebuildA.md]]',
      origin: createDocumentOrigin('test', 'nested-recreate'),
    })

    expect(
      projection.view.dom.querySelector('[data-embed-target="RebuildA.md"] .cm-editor'),
    ).not.toBeNull()
    expect(store.getProjections(replacement)).toHaveLength(1)
    expect(store.get(c)?.markdown).toBe('![[RebuildB.md]]')
  })

  it('drops a late load after parent detach and recovers on reopen', async () => {
    const store = new DocumentStore()
    const host = loadDocument(store, 'detach-host', 'DetachHost.md', '![[Detach.md]]')
    const pending = deferred()
    const first = mountSingleDocumentView({
      store,
      locator: host,
      parent: document.body,
      projectionId: 'detach-host-first',
      editable: true,
      presentationMode: 'live-preview',
      extensions: [
        createEmbedProjectionExtension({
          store,
          locator: host,
          getAvailablePaths: () => ['DetachHost.md', 'Detach.md'],
          onTargetMissing: () => pending.promise,
        }),
      ],
    })
    mounted.push(first)
    expect(first.view.dom.querySelector('[data-embed-status="unloaded"]')).not.toBeNull()

    first.destroy()
    mounted.splice(mounted.indexOf(first), 1)
    const target = loadDocument(store, 'detach-target', 'Detach.md', 'late target')
    pending.resolve()
    await Promise.resolve()

    expect(store.getProjections(host)).toEqual([])
    expect(store.getProjections(target)).toEqual([])

    const reopened = mountEmbed(store, host, 'detach-host-reopened')
    expect(reopened.view.dom.querySelector('[data-embed-status="mounted"]')).not.toBeNull()
    expect(store.getProjections(target)).toHaveLength(1)
  })

  it('cleans nested projection registrations when a host closes and reopens', () => {
    const store = new DocumentStore()
    const target = loadDocument(store, 'reopen-target', 'Target.md', 'target')
    const host = loadDocument(store, 'reopen-host', 'Host.md', '![[Target.md]]')
    const targetMain = mountEmbed(store, target, 'target-main')
    const firstHost = mountEmbed(store, host, 'host-first')
    expect(store.getProjections(target)).toHaveLength(2)

    firstHost.destroy()
    mounted.splice(mounted.indexOf(firstHost), 1)
    expect(store.getProjections(target)).toHaveLength(1)
    expect(targetMain.isDestroyed).toBe(false)

    const reopened = mountEmbed(store, host, 'host-reopened')
    expect(store.getProjections(target)).toHaveLength(2)
    expect(reopened.view.dom.querySelector('[data-embed-status="mounted"]')).not.toBeNull()
  })
})
