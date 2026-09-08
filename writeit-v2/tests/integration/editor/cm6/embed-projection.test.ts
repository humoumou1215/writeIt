// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorView } from '@codemirror/view'
import {
  CompletionProviderRegistry,
  createStaticCompletionProvider,
} from '../../../../src/application/assistance'
import { createBasicMarkdownCommandRegistry } from '../../../../src/application/commands'
import { ImageAttachmentService } from '../../../../src/application/attachments'
import {
  createDocumentId,
  createDocumentOrigin,
  createDocumentPath,
  documentById,
  DocumentStore,
} from '../../../../src/core/document'
import { createWorkspacePath } from '../../../../src/core/workspace'
import {
  ReferenceGraph,
  ReferenceHealthService,
} from '../../../../src/core/reference'
import {
  createEmbedProjectionExtension,
  createImagePasteExtension,
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

function createEmbedPopupCompletionRegistry(): CompletionProviderRegistry {
  const registry = new CompletionProviderRegistry()
  registry.register(
    createStaticCompletionProvider({
      id: 'embed-reference-completion',
      triggers: ['@', '[[', '![[' ],
      items: [
        {
          id: 'candidate',
          label: 'Candidate',
          detail: 'Candidate.md',
          keywords: ['candidate'],
          apply: (context) => ({
            from: context.trigger.from,
            to: context.trigger.to,
            insert:
              context.trigger.kind === '![['
                ? '![[Candidate.md]]'
                : '[[Candidate.md]]',
          }),
        },
      ],
    }),
  )
  return registry
}

function mountEmbed(
  store: DocumentStore,
  locator: ReturnType<typeof documentById>,
  projectionId: string,
  editable = true,
  options: Pick<
    EmbedProjectionExtensionOptions,
    | 'imageProjection'
    | 'imagePaste'
    | 'onOpen'
    | 'slashQuickInsert'
    | 'completion'
  > = {},
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

function fakeImageFile(
  bytes: readonly number[],
  name = 'clipboard.png',
): File {
  return {
    name,
    type: 'image/png',
    size: bytes.length,
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  } as unknown as File
}

function pasteImages(
  target: HTMLElement,
  images: readonly {
    readonly bytes: readonly number[]
    readonly name?: string
  }[],
  redispatch = false,
): Event {
  const files = images.map((image) => fakeImageFile(image.bytes, image.name))
  const items = images.map((image) => ({
    kind: 'file',
    type: 'image/png',
    getAsFile: () => fakeImageFile(image.bytes, image.name),
  }))
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    configurable: true,
    value: { files, items },
  })
  target.dispatchEvent(event)
  if (redispatch) target.dispatchEvent(event)
  return event
}

async function flush(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve()
}

function waitForRevision(
  store: DocumentStore,
  locator: ReturnType<typeof documentById>,
  revision: number,
): Promise<void> {
  if (store.getRevision(locator) >= revision) return Promise.resolve()
  return new Promise((resolve) => {
    const stop = store.subscribe(locator, (event) => {
      if (event.type !== 'changed' || event.document.revision < revision) return
      stop()
      resolve()
    })
  })
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

  it('reuses the shared slash and completion contracts inside an editable child', async () => {
    const store = new DocumentStore()
    const target = loadDocument(store, 'popup-target', 'Target.md', 'target')
    const host = loadDocument(
      store,
      'popup-host',
      'Host.md',
      '![[Target.md]]',
    )
    const hostDocument = store.get(host)
    if (!hostDocument) throw new Error('popup host document is missing')
    const graph = new ReferenceGraph({
      workspacePaths: ['Host.md', 'Target.md'],
      documents: [hostDocument],
    })
    const health = new ReferenceHealthService({ graph })
    const opened = vi.fn()
    const targetMain = mountEmbed(store, target, 'popup-target-main')
    const popupOptions = {
      slashQuickInsert: {
        registry: createBasicMarkdownCommandRegistry(),
      },
      completion: {
        registry: createEmbedPopupCompletionRegistry(),
      },
    } satisfies Pick<
      EmbedProjectionExtensionOptions,
      'slashQuickInsert' | 'completion'
    >
    const projection = mountSingleDocumentView({
      store,
      locator: host,
      parent: document.body,
      projectionId: 'popup-host',
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
          ...popupOptions,
        }),
      ],
    })
    mounted.push(projection)

    const wrapper = projection.view.dom.querySelector<HTMLElement>(
      '[data-writeit-embed][data-embed-status="mounted"]',
    )
    const childElement = wrapper?.querySelector<HTMLElement>('.cm-editor')
    if (!childElement) throw new Error('editable popup child editor is missing')
    const childView = EditorView.findFromDOM(childElement)
    if (!childView) throw new Error('editable popup child CM6 view is missing')

    const appendToChild = (text: string): void => {
      const from = childView.state.doc.length
      childView.dispatch({
        changes: { from, insert: text },
        selection: { anchor: from + text.length },
      })
    }
    const clickOption = (option: HTMLElement): void => {
      option.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
      )
      option.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      )
    }

    appendToChild('\n/')
    const slashMenu = childView.dom.querySelector<HTMLElement>('[data-slash-menu]')
    if (!slashMenu) throw new Error('child slash popup is missing')
    expect(slashMenu.dataset.show).toBe('true')
    const headingCommand = slashMenu.querySelector<HTMLElement>(
      '[data-command-id="markdown.heading-2"]',
    )
    if (!headingCommand) throw new Error('child heading command is missing')
    const beforeSlashApply = store.get(target)
    if (!beforeSlashApply) throw new Error('popup target is missing')
    const beforeSlashHistory = store.getHistory(target)
    clickOption(headingCommand)
    await flush()

    const afterSlash = store.get(target)
    expect(afterSlash?.markdown).toBe('target\n## ')
    expect(afterSlash?.revision).toBe(beforeSlashApply.revision + 1)
    expect(store.getHistory(target).undo).toHaveLength(
      beforeSlashHistory.undo.length + 1,
    )
    expect(targetMain.view.state.doc.toString()).toBe(afterSlash?.markdown)
    expect(store.get(host)?.markdown).toBe('![[Target.md]]')
    expect(store.getRevision(host)).toBe(0)
    expect(opened).not.toHaveBeenCalled()

    for (const [trigger, insertion] of [
      ['@ca', '[[Candidate.md]]'],
      ['[[ca', '[[Candidate.md]]'],
      ['![[ca', '![[Candidate.md]]'],
    ] as const) {
      appendToChild(`\n${trigger}`)
      await flush()
      const completionMenu = childView.dom.querySelector<HTMLElement>(
        '[data-completion-menu]',
      )
      if (!completionMenu) throw new Error('child completion popup is missing')
      expect(completionMenu.dataset.show).toBe('true')
      expect(completionMenu.dataset.triggerKind).toBe(
        trigger.startsWith('!') ? '![[' : trigger.startsWith('[') ? '[[' : '@',
      )
      const candidate = completionMenu.querySelector<HTMLElement>(
        '[data-completion-id="candidate"]',
      )
      if (!candidate) throw new Error(`completion candidate is missing for ${trigger}`)
      const beforeApply = store.get(target)
      if (!beforeApply) throw new Error('popup target disappeared')
      const beforeHistory = store.getHistory(target)
      clickOption(candidate)
      await flush()

      const afterApply = store.get(target)
      expect(afterApply?.markdown).toBe(
        beforeApply.markdown.slice(0, -trigger.length) + insertion,
      )
      expect(afterApply?.revision).toBe(beforeApply.revision + 1)
      expect(store.getHistory(target).undo).toHaveLength(
        beforeHistory.undo.length + 1,
      )
      expect(targetMain.view.state.doc.toString()).toBe(afterApply?.markdown)
      expect(store.get(host)?.markdown).toBe('![[Target.md]]')
      expect(store.getRevision(host)).toBe(0)
      expect(opened).not.toHaveBeenCalled()
    }

    expect(store.get(target)?.dirty).toBe(true)
  })

  it('does not install committing popup surfaces in a readonly child', () => {
    const store = new DocumentStore()
    const target = loadDocument(store, 'readonly-popup-target', 'Target.md', 'target')
    const host = loadDocument(
      store,
      'readonly-popup-host',
      'Host.md',
      '![[Target.md|ro]]',
    )
    const projection = mountEmbed(store, host, 'readonly-popup-host', true, {
      slashQuickInsert: {
        registry: createBasicMarkdownCommandRegistry(),
      },
      completion: {
        registry: createEmbedPopupCompletionRegistry(),
      },
    })
    const childElement = projection.view.dom.querySelector<HTMLElement>(
      '[data-embed-target="Target.md"] .cm-editor',
    )
    if (!childElement) throw new Error('readonly popup child editor is missing')
    const childView = EditorView.findFromDOM(childElement)
    if (!childView) throw new Error('readonly popup child CM6 view is missing')

    expect(childView.dom.querySelector('[data-slash-menu]')).toBeNull()
    expect(childView.dom.querySelector('[data-completion-menu]')).toBeNull()
    childView.dispatch({
      changes: { from: childView.state.doc.length, insert: '\n@candidate' },
      selection: { anchor: childView.state.doc.length + 10 },
    })

    expect(store.get(target)?.markdown).toBe('target')
    expect(store.getRevision(target)).toBe(0)
    expect(store.get(host)?.markdown).toBe('![[Target.md|ro]]')
  })

  it('keeps child popup IME and dismiss lifecycle source-safe', async () => {
    const store = new DocumentStore()
    const target = loadDocument(store, 'popup-ime-target', 'Target.md', '')
    const host = loadDocument(
      store,
      'popup-ime-host',
      'Host.md',
      '![[Target.md]]',
    )
    const resolvers: Array<
      (items: readonly { id: string; label: string; insertText: string }[]) => void
    > = []
    const completionRegistry = {
      complete: () =>
        new Promise<readonly { id: string; label: string; insertText: string }[]>(
          (resolve) => resolvers.push(resolve),
        ),
    }
    const projection = mountEmbed(store, host, 'popup-ime-host', true, {
      completion: { registry: completionRegistry },
    })
    const childElement = projection.view.dom.querySelector<HTMLElement>(
      '[data-embed-target="Target.md"] .cm-editor',
    )
    if (!childElement) throw new Error('IME child editor is missing')
    const childView = EditorView.findFromDOM(childElement)
    if (!childView) throw new Error('IME child CM6 view is missing')
    childView.dispatch({
      changes: { from: 0, insert: '@a' },
      selection: { anchor: 2 },
    })
    const menu = childView.dom.querySelector<HTMLElement>('[data-completion-menu]')
    if (!menu) throw new Error('IME child completion popup is missing')
    expect(resolvers).toHaveLength(1)

    childView.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    expect(menu.dataset.show).toBe('false')
    resolvers[0]?.([{ id: 'late', label: 'Late', insertText: 'done' }])
    await flush()
    expect(menu.dataset.show).toBe('false')
    expect(store.get(target)?.markdown).toBe('@a')

    childView.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    expect(resolvers).toHaveLength(2)
    resolvers[1]?.([{ id: 'candidate', label: 'Candidate', insertText: 'done' }])
    await flush()
    expect(menu.dataset.show).toBe('true')
    childView.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    )
    expect(menu.dataset.show).toBe('false')
    expect(store.get(target)?.markdown).toBe('@a')
    expect(store.getRevision(target)).toBe(1)
  })

  it('rejects child completion when the target projection is stale', async () => {
    const store = new DocumentStore()
    const target = loadDocument(store, 'popup-stale-target', 'Target.md', '')
    const host = loadDocument(
      store,
      'popup-stale-host',
      'Host.md',
      '![[Target.md]]',
    )
    const projection = mountEmbed(store, host, 'popup-stale-host', true, {
      completion: {
        registry: createEmbedPopupCompletionRegistry(),
      },
    })
    const childElement = projection.view.dom.querySelector<HTMLElement>(
      '[data-embed-target="Target.md"] .cm-editor',
    )
    if (!childElement) throw new Error('stale child editor is missing')
    const childView = EditorView.findFromDOM(childElement)
    if (!childView) throw new Error('stale child CM6 view is missing')
    childView.dispatch({
      changes: { from: 0, insert: '@ca' },
      selection: { anchor: 3 },
    })
    await flush()
    const childProjectionId = childElement.parentElement?.dataset.embedProjectionId
    if (!childProjectionId) throw new Error('stale child projection id is missing')
    store.markProjectionStale(target, childProjectionId, 'popup stale')
    childView.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    )
    await flush()

    expect(store.get(target)?.markdown).toBe('@ca')
    expect(store.getRevision(target)).toBe(1)
  })

  it('rejects a late child completion apply after host detach', async () => {
    const store = new DocumentStore()
    const target = loadDocument(store, 'popup-late-target', 'Target.md', '')
    const host = loadDocument(
      store,
      'popup-late-host',
      'Host.md',
      '![[Target.md]]',
    )
    const pending = deferred()
    const projection = mountEmbed(store, host, 'popup-late-host', true, {
      completion: {
        registry: {
          complete: () => [
            {
              id: 'late',
              label: 'Late',
              apply: async () => {
                await pending.promise
                return 'done'
              },
            },
          ],
        },
      },
    })
    const childElement = projection.view.dom.querySelector<HTMLElement>(
      '[data-embed-target="Target.md"] .cm-editor',
    )
    if (!childElement) throw new Error('late child editor is missing')
    const childView = EditorView.findFromDOM(childElement)
    if (!childView) throw new Error('late child CM6 view is missing')
    childView.dispatch({
      changes: { from: 0, insert: '@' },
      selection: { anchor: 1 },
    })
    await flush()
    const menu = childView.dom.querySelector<HTMLElement>('[data-completion-menu]')
    if (!menu) throw new Error('late child completion popup is missing')
    childView.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    )

    projection.destroy()
    pending.resolve()
    await flush()

    expect(store.get(target)?.markdown).toBe('@')
    expect(store.getRevision(target)).toBe(1)
    expect(store.getProjections(target)).toEqual([])
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

  it('pastes through the editable child capability once and resolves nested target paths', async () => {
    const store = new DocumentStore()
    const target = loadDocument(
      store,
      'child-paste-target',
      'notes/deep/Target.md',
      '# Target\n',
    )
    const host = loadDocument(
      store,
      'child-paste-host',
      'Host.md',
      '![[notes/deep/Target.md]]',
    )
    const fileSystem = new MemoryFileSystem()
    const service = new ImageAttachmentService({
      fileSystem,
      nameGenerator: () => 'capture.png',
    })
    const resolver = new WorkspaceImageProjectionResolver({
      reader: fileSystem,
    })
    const applied = vi.fn()
    const targetRevision = waitForRevision(store, target, 1)
    const projection = mountEmbed(store, host, 'child-paste-host', true, {
      imageProjection: {
        imageResolver: resolver,
        documentPath: store.get(host)?.path,
      },
      imagePaste: {
        handle: (images, context) =>
          service.paste({
            images,
            mode: 'file-images',
            hostPath: context.documentPath,
          }),
        cleanupAttachments: (attachments, context) =>
          service.cleanup(attachments, context),
        onApplied: applied,
      },
    })

    const childElement = projection.view.dom.querySelector<HTMLElement>(
      '[data-embed-target="notes/deep/Target.md"] .cm-editor',
    )
    if (!childElement) throw new Error('editable child editor was not mounted')
    const childView = EditorView.findFromDOM(childElement)
    if (!childView) throw new Error('editable child CM6 view was not found')
    childView.dispatch({
      selection: { anchor: childView.state.doc.length },
    })

    const event = pasteImages(
      childView.contentDOM,
      [{ bytes: [1, 2, 3] }, { bytes: [4, 5, 6] }],
      true,
    )
    await targetRevision

    expect(event.defaultPrevented).toBe(true)
    expect(store.get(host)?.markdown).toBe('![[notes/deep/Target.md]]')
    expect(store.get(host)?.revision).toBe(0)
    expect(store.getHistory(host).undo).toHaveLength(0)
    expect(store.get(target)?.markdown).toBe(
      '# Target\n![clipboard](./images/capture.png)\n![clipboard](./images/capture-1.png)',
    )
    expect(store.get(target)?.revision).toBe(1)
    expect(store.getHistory(target).undo).toHaveLength(1)
    expect(applied).toHaveBeenCalledTimes(1)
    expect(
      [...await fileSystem.readBinary(createWorkspacePath('notes/deep/images/capture.png'))],
    ).toEqual([1, 2, 3])
    expect(
      [...await fileSystem.readBinary(createWorkspacePath('notes/deep/images/capture-1.png'))],
    ).toEqual([4, 5, 6])

    await expect(
      resolver.resolve('./images/capture.png', 'notes/deep/Target.md'),
    ).resolves.toMatchObject({
      path: 'notes/deep/images/capture.png',
      status: 'ready',
    })
    resolver.dispose()
  })

  it('blocks readonly child paste before an editable host bridge can observe it', async () => {
    const store = new DocumentStore()
    const target = loadDocument(store, 'readonly-paste-target', 'Target.md', 'target')
    const host = loadDocument(
      store,
      'readonly-paste-host',
      'Host.md',
      '![[Target.md|ro]]',
    )
    const fileSystem = new MemoryFileSystem()
    const service = new ImageAttachmentService({
      fileSystem,
      nameGenerator: () => 'readonly.png',
    })
    const hostHandle = vi.fn(async () =>
      service.paste({
        images: [{ name: 'host.png', mimeType: 'image/png', bytes: new Uint8Array([9]) }],
        mode: 'file-images',
        hostPath: 'Host.md',
      }),
    )
    const projection = mountSingleDocumentView({
      store,
      locator: host,
      parent: document.body,
      projectionId: 'readonly-paste-host',
      editable: true,
      presentationMode: 'live-preview',
      extensions: [
        createImagePasteExtension({
          getDocumentPath: () => 'Host.md',
          handle: hostHandle,
        }),
        createEmbedProjectionExtension({
          store,
          locator: host,
          getAvailablePaths: () => store.getAll().map((entry) => entry.path),
          imagePaste: {
            handle: (images, context) =>
              service.paste({
                images,
                mode: 'file-images',
                hostPath: context.documentPath,
              }),
            cleanupAttachments: (attachments, context) =>
              service.cleanup(attachments, context),
          },
        }),
      ],
    })
    mounted.push(projection)

    const childElement = projection.view.dom.querySelector<HTMLElement>(
      '[data-embed-target="Target.md"] .cm-editor',
    )
    if (!childElement) throw new Error('readonly child editor was not mounted')
    const childView = EditorView.findFromDOM(childElement)
    if (!childView) throw new Error('readonly child CM6 view was not found')

    const event = pasteImages(childView.contentDOM, [{ bytes: [1, 2, 3] }])

    expect(event.defaultPrevented).toBe(true)
    expect(hostHandle).not.toHaveBeenCalled()
    expect(store.get(host)?.markdown).toBe('![[Target.md|ro]]')
    expect(store.get(target)?.markdown).toBe('target')
    expect(store.get(target)?.revision).toBe(0)
    expect(fileSystem.snapshotBinary()).toEqual(new Map())
  })

  it('compensates child attachment writes after detach, revision race, or failed result', async () => {
    const store = new DocumentStore()
    const target = loadDocument(
      store,
      'failed-child-target',
      'notes/Target.md',
      'target',
    )
    const host = loadDocument(
      store,
      'failed-child-host',
      'Host.md',
      '![[notes/Target.md]]',
    )
    const fileSystem = new MemoryFileSystem({
      binaryFiles: {
        'images/capture.png': new Uint8Array([9, 9]),
      },
    })
    const service = new ImageAttachmentService({
      fileSystem,
      nameGenerator: () => 'capture.png',
    })
    let hostProjection: SingleDocumentView | undefined
    let failureResolve!: () => void
    const failure = new Promise<void>((resolve) => {
      failureResolve = resolve
    })
    const projection = mountEmbed(store, host, 'failed-child-host', true, {
      imagePaste: {
        handle: async (images, context) => {
          const result = await service.paste({
            images,
            mode: 'root-images',
            hostPath: context.documentPath,
          })
          hostProjection?.destroy()
          return { ...result, references: [] }
        },
        cleanupAttachments: (attachments, context) =>
          service.cleanup(attachments, context),
        onError: () => failureResolve(),
      },
    })
    hostProjection = projection

    const childElement = projection.view.dom.querySelector<HTMLElement>(
      '[data-embed-target="notes/Target.md"] .cm-editor',
    )
    if (!childElement) throw new Error('failed child editor was not mounted')
    const childView = EditorView.findFromDOM(childElement)
    if (!childView) throw new Error('failed child CM6 view was not found')

    pasteImages(childView.contentDOM, [{ bytes: [1, 2, 3] }])
    await failure

    expect(store.get(host)?.markdown).toBe('![[notes/Target.md]]')
    expect(store.get(host)?.revision).toBe(0)
    expect(store.get(target)?.markdown).toBe('target')
    expect(store.get(target)?.revision).toBe(0)
    expect(
      [...await fileSystem.readBinary(createWorkspacePath('images/capture.png'))],
    ).toEqual([9, 9])
    expect(fileSystem.hasFile(createDocumentPath('images/capture-1.png'))).toBe(false)
  })

  it('rejects a child mutation on a target revision race and preserves the external source', async () => {
    const store = new DocumentStore()
    const target = loadDocument(store, 'raced-child-target', 'notes/Target.md', 'target')
    const host = loadDocument(
      store,
      'raced-child-host',
      'Host.md',
      '![[notes/Target.md]]',
    )
    const fileSystem = new MemoryFileSystem()
    const service = new ImageAttachmentService({
      fileSystem,
      nameGenerator: () => 'race.png',
    })
    let failureResolve!: () => void
    const failure = new Promise<void>((resolve) => {
      failureResolve = resolve
    })
    const projection = mountEmbed(store, host, 'raced-child-host', true, {
      imagePaste: {
        handle: async (images, context) => {
          const result = await service.paste({
            images,
            mode: 'file-images',
            hostPath: context.documentPath,
          })
          store.applyChange(target, {
            markdown: 'external target',
            origin: createDocumentOrigin('test', 'child-image-race'),
          })
          return result
        },
        cleanupAttachments: (attachments, context) =>
          service.cleanup(attachments, context),
        onError: () => failureResolve(),
      },
    })
    const childElement = projection.view.dom.querySelector<HTMLElement>(
      '[data-embed-target="notes/Target.md"] .cm-editor',
    )
    if (!childElement) throw new Error('raced child editor was not mounted')
    const childView = EditorView.findFromDOM(childElement)
    if (!childView) throw new Error('raced child CM6 view was not found')

    pasteImages(childView.contentDOM, [{ bytes: [1, 2, 3] }])
    await failure

    expect(store.get(host)?.markdown).toBe('![[notes/Target.md]]')
    expect(store.get(target)?.markdown).toBe('external target')
    expect(store.get(target)?.revision).toBe(1)
    expect(fileSystem.hasFile(createDocumentPath('notes/images/race.png'))).toBe(false)
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
    const retry = projection.view.dom.querySelector<HTMLButtonElement>(
      '[data-embed-action="retry"]',
    )
    expect(retry).not.toBeNull()
    retry?.click()
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
