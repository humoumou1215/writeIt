<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { EditorView } from '@codemirror/view'
import { CompletionProviderRegistry } from './application/assistance'
import {
  createBasicMarkdownCommandRegistry,
} from './application/commands'
import {
  createDocumentId,
  createDocumentPath,
  documentById,
  DocumentStore,
} from './core/document'
import {
  createCompletionExtension,
  createSlashQuickInsertExtension,
  mountBasicLivePreview,
  mountSingleDocumentView,
  type BasicLivePreview,
  type PresentationMode,
  type SingleDocumentView,
} from './editor'

const documentId = createDocumentId('welcome')
const documentPath = createDocumentPath('welcome.md')
const documentLocator = documentById(documentId)
const initialMarkdown = `# WriteIt v2

This is the **DocumentStore** source. Edit it and watch the [live preview](https://writeit.example).

The editor is a CM6 projection, not a second document authority.

:::unknown-syntax
Unknown Markdown remains source text.
:::
`

const store = new DocumentStore()
const quickInsertRegistry = createBasicMarkdownCommandRegistry()
const completionRegistry = new CompletionProviderRegistry()
completionRegistry.register({
  id: 'demo-references',
  triggers: ['@', '[[', '![['],
  provide: ({ trigger }) => [
    {
      id: 'welcome',
      label: 'Welcome document',
      detail: 'welcome.md',
      keywords: ['intro'],
      insertText:
        trigger.kind === '![['
          ? '![[welcome.md]]'
          : '[[welcome.md]]',
    },
    {
      id: 'architecture',
      label: 'Architecture notes',
      detail: 'architecture.md',
      keywords: ['design'],
      insertText:
        trigger.kind === '![['
          ? '![[architecture.md]]'
          : '[[architecture.md]]',
    },
  ],
})
const initialDocument = store.load({
  id: documentId,
  path: documentPath,
  markdown: initialMarkdown,
})
const currentDocument = ref(initialDocument)
const editorHost = ref<HTMLDivElement | null>(null)
const previewHost = ref<HTMLDivElement | null>(null)
const projection = ref<SingleDocumentView | null>(null)
const preview = ref<BasicLivePreview | null>(null)
const presentationMode = ref<PresentationMode>('source')
const stopStoreSubscription = store.subscribe(documentLocator, (event) => {
  currentDocument.value = event.document
})

function toggleEditorPresentation(): void {
  const next = projection.value?.togglePresentationMode()
  if (next) presentationMode.value = next
}

onMounted(() => {
  if (!editorHost.value || !previewHost.value) return

  projection.value = mountSingleDocumentView({
    store,
    locator: documentLocator,
    parent: editorHost.value,
    editable: true,
    extensions: [
      EditorView.updateListener.of(() => {
        if (projection.value) {
          presentationMode.value = projection.value.presentationMode
        }
      }),
      createSlashQuickInsertExtension({
        store,
        locator: documentLocator,
        registry: quickInsertRegistry,
      }),
      createCompletionExtension({
        store,
        locator: documentLocator,
        registry: completionRegistry,
      }),
    ],
  })
  presentationMode.value = projection.value.presentationMode
  preview.value = mountBasicLivePreview({
    store,
    locator: documentLocator,
    parent: previewHost.value,
  })
})

onBeforeUnmount(() => {
  projection.value?.destroy()
  preview.value?.destroy()
  stopStoreSubscription()
  projection.value = null
  preview.value = null
})
</script>

<template>
  <main class="app-shell">
    <header class="app-header">
      <div>
        <p class="eyebrow">WriteIt v2 · P2A-05</p>
        <h1>Markdown-first editor surface</h1>
        <p class="subtitle">
          一个 DocumentStore；源码与 Live Preview 共用同一个 CM6 编辑器状态。
        </p>
      </div>
      <dl class="document-meta" aria-label="Document status">
        <div>
          <dt>Document</dt>
          <dd>{{ currentDocument.path }}</dd>
        </div>
        <div>
          <dt>Revision</dt>
          <dd>{{ currentDocument.revision }}</dd>
        </div>
        <div>
          <dt>State</dt>
          <dd>{{ currentDocument.dirty ? 'dirty' : 'clean' }}</dd>
        </div>
      </dl>
    </header>

    <section class="surface-grid" aria-label="Document surfaces">
      <section class="editor-card" aria-label="Markdown editor projection">
        <div class="surface-heading">
          <div>
            <h2>Markdown editor</h2>
            <span class="presentation-status" data-testid="presentation-mode">
              {{ presentationMode === 'live-preview' ? 'Live Preview' : 'Raw Source' }}
            </span>
          </div>
          <div class="surface-actions">
            <span>{{ projection?.projectionId ?? 'mounting' }}</span>
            <button
              type="button"
              class="presentation-toggle"
              data-testid="presentation-toggle"
              :aria-pressed="presentationMode === 'live-preview'"
              @click="toggleEditorPresentation"
            >
              {{ presentationMode === 'live-preview' ? 'Show source' : 'Live Preview' }}
              <kbd>Ctrl/Cmd+E</kbd>
            </button>
          </div>
        </div>
        <div ref="editorHost" class="editor-host"></div>
        <p class="projection-note">
          同一 CM6 document 在 Raw Source 与 Live Preview decorations/widgets 间切换；不创建第二个 textarea authority。试试 <code>Ctrl/Cmd+E</code>、<code>@</code>、<code>[[</code> 或 <code>![[</code>。
        </p>
      </section>

      <section class="preview-card" aria-label="Live Markdown preview">
        <div class="surface-heading">
          <h2>Live Preview projection</h2>
          <span>{{ preview?.projectionId ?? 'mounting' }}</span>
        </div>
        <div ref="previewHost" class="preview-host"></div>
        <p class="projection-note">
          Preview 只读消费 Markdown；未知语法保留为普通文本。
        </p>
      </section>
    </section>
  </main>
</template>
