<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue'
import { EditorView } from '@codemirror/view'
import {
  CompletionProviderRegistry,
  createReferenceCompletionProvider,
} from './application/assistance'
import {
  ImageAttachmentService,
  IMAGE_PASTE_MODE_OPTIONS,
} from './application/attachments'
import {
  CommandRegistry,
  createBasicMarkdownCommandRegistry,
  createDefaultKeybindingRegistry,
  createShortcutSettingsEntries,
  DEFAULT_SHORTCUT_COMMANDS,
  KeybindingConflictError,
  KeybindingSettingsStore,
  registerMermaidQuickInsertCommands,
  type ShortcutSettingsEntry,
} from './application/commands'
import { createTableCommands } from './application/table'
import type { TableCommandId } from './core/table'
import { AnnotationService, MemoryAnnotationRepository } from './application/annotation'
import { GitWorkbenchService } from './application/git'
import { SearchService, type SearchQuery } from './application/search'
import { ValidationService } from './application/validation'
import { TemplateCatalog, TemplateService } from './application/template'
import { ExportService, type ExportFormat } from './application/export'
import { CreateFromTemplateService } from './application/workspace'
import { MemoryGitAdapter, type GitDiffResult, type GitFileStatus, type GitRepositoryInfo } from './platform/git'
import {
  createDocumentId,
  createDocumentPath,
  documentById,
  documentByPath,
  DocumentStore,
} from './core/document'
import {
  createWorkspacePath,
  findWorkspaceNode,
  workspaceName,
  workspaceParent,
} from './core/workspace'
import {
  ReferenceGraph,
  ReferenceHealthService,
} from './core/reference'
import { composedContentStats, flattenOutline, parseOutline } from './core'
import {
  ReferenceClipboardService,
  ReferenceRenameService,
} from './application/reference'
import type { DocumentId, DocumentState } from './core/document'
import type {
  ImagePasteMode,
  ImagePasteOrphanDiagnostic,
  ImagePasteResult,
  WorkspacePath,
} from './core/workspace'
import {
  createCompletionExtension,
  createAnnotationExtension,
  createEmbedProjectionExtension,
  createImagePasteExtension,
  createLivePreviewExtension,
  createReferenceClipboardExtension,
  createReferenceNavigationExtension,
  createSlashQuickInsertExtension,
  copyImageToClipboard,
  mountBasicLivePreview,
  mountSingleDocumentView,
  WorkspaceImageProjectionResolver,
  type BasicLivePreview,
  type EmbedProjectionMissingTargetContext,
  type ImagePasteExtensionOptions,
  type ImageProjectionResource,
  type PresentationMode,
  type SingleDocumentView,
} from './editor'
import {
  adjacentWorkspaceFilePath,
  decideWorkspaceOpen,
  DocumentPersistenceService,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  orderedWorkspaceFilePaths,
  WorkspaceRecoveryStore,
  WorkspaceSettingsStore,
  WorkspaceTabManager,
  WorkspaceTreeService,
  type WorkspaceDeletionDecision,
  type WorkspaceDeletionPlan,
  type WorkspaceProjectionBinding,
} from './application/workspace'
import { MemoryFileSystem } from './platform/filesystem'
import { createBrowserReferenceClipboard } from './platform/clipboard'
import { BrowserSettingsStorage } from './platform/settings'
import {
  SearchPanel,
  WorkspaceTabs as WorkspaceTabsPanel,
  WorkspaceTree as WorkspaceTreePanel,
} from './ui/workspace'
import { ShortcutSettings as ShortcutSettingsPanel } from './ui/settings'
import { ImagePreviewModal } from './ui/media'
import { AnnotationDrawer, GitWorkbenchPanel } from './ui/review'

const documentId = createDocumentId('welcome')
const documentPath = createDocumentPath('welcome.md')
const initialMarkdown = `# WriteIt v2

This is the **DocumentStore** source. Edit it and watch the [live preview](https://writeit.example).

The editor is a CM6 projection, not a second document authority.

:::unknown-syntax
Unknown Markdown remains source text.
:::
`

const store = new DocumentStore()
const workspaceFileSystem = new MemoryFileSystem({
  'welcome.md': initialMarkdown,
  'notes/architecture.md': '# Architecture notes\n',
  'notes/workspace.md': '# Workspace tree\n',
})
const settingsStorage = new BrowserSettingsStorage()
const workspaceSettingsStore = new WorkspaceSettingsStore(settingsStorage)
const keybindingRegistry = createDefaultKeybindingRegistry()
const keybindingSettingsStore = new KeybindingSettingsStore(
  settingsStorage,
  keybindingRegistry,
)
const workspaceRecoveryStore = new WorkspaceRecoveryStore(settingsStorage, {
  workspacePath: createWorkspacePath(''),
})
const workspaceTreeService = new WorkspaceTreeService(workspaceFileSystem, {
  rootName: 'Workspace',
  // Tabs retain only DocumentIds, while persistence and P4-09 can retain
  // loaded Documents after a tab change. Protect every Store path binding so
  // a directory move cannot strand an apparently closed or embedded source.
  getOpenDocuments: () =>
    store.getAll().map((document) => ({
      documentId: document.id,
      path: createWorkspacePath(document.path),
      dirty: document.dirty,
    })),
  getRecoveryPaths: () => workspaceRecoveryStore.getSnapshot().openDocumentPaths,
})
const templateCatalog = new TemplateCatalog({
  list: async (scope) => {
    if (scope === 'global') return [{ path: 'meeting.md', content: '# Meeting\n\nDate: {{date}}\n\n## Notes\n' }]
    return [...workspaceFileSystem.snapshot().entries()]
      .filter(([path]) => path.startsWith('.template/'))
      .map(([path, content]) => ({ path, content }))
  },
})
const templateService = new TemplateService(templateCatalog)
const templateCreationService = new CreateFromTemplateService(workspaceTreeService, {
  provider: { resolve: ({ templateId }) => {
    const template = templateService.get(templateId)
    return template ? { markdown: template.markdown } : undefined
  } },
})
const exportService = new ExportService()
const imageAttachmentService = new ImageAttachmentService({
  fileSystem: workspaceFileSystem,
})
const imageProjectionResolver = new WorkspaceImageProjectionResolver({
  reader: workspaceFileSystem,
})
const initialSettings = workspaceSettingsStore.getSnapshot()
const persistence = new DocumentPersistenceService(store, workspaceFileSystem, {
  autoSaveDelayMs: initialSettings.autoSaveDelayMs,
})
const quickInsertRegistry = createBasicMarkdownCommandRegistry()
registerMermaidQuickInsertCommands(quickInsertRegistry)
const completionRegistry = new CompletionProviderRegistry()
completionRegistry.register(
  createReferenceCompletionProvider({
    workspace: workspaceFileSystem,
    // A loaded document's Store snapshot is the runtime source authority;
    // unopened files still come from the workspace persistence adapter.
    contentReader: {
      readFile: async (path) => {
        const document = store.get(documentByPath(createDocumentPath(path)))
        return document?.markdown ?? workspaceFileSystem.readFile(createDocumentPath(path))
      },
    },
  }),
)
interface ApplicationCommandContext {
  readonly source: 'shortcut' | 'settings'
}
const applicationCommandRegistry = new CommandRegistry<ApplicationCommandContext>()
const annotationService = new AnnotationService(new MemoryAnnotationRepository())
const gitService = new GitWorkbenchService(new MemoryGitAdapter({ info: { isGitRepository: false, branches: [] } }))
const initialDocument = store.load({
  id: documentId,
  path: documentPath,
  markdown: initialMarkdown,
})
const referenceGraph = new ReferenceGraph({
  documents: [initialDocument],
})
const referenceHealth = new ReferenceHealthService({
  graph: referenceGraph,
  // Loaded documents remain Store-authoritative; unopened targets are read
  // through the workspace persistence adapter for fragment health checks.
  contentReader: {
    readFile: async (path: WorkspacePath) => {
      const document = store.get(documentByPath(createDocumentPath(path)))
      return document?.markdown ?? workspaceFileSystem.readFile(createDocumentPath(path))
    },
  },
})
persistence.track(documentById(documentId), {
  persistedMarkdown: initialDocument.markdown,
})
const referenceRenameService = new ReferenceRenameService({
  fileSystem: workspaceFileSystem,
  store,
  graph: referenceGraph,
  persistence,
})
const referenceClipboard = new ReferenceClipboardService()
const browserReferenceClipboard = createBrowserReferenceClipboard({
  store: referenceClipboard.store,
  resolveExternalPath: (absolutePath) =>
    resolveExternalReferencePath(absolutePath),
})
const initialWorkspacePath = createWorkspacePath(documentPath)
const documentIdsByPath = new Map<WorkspacePath, DocumentId>([
  [initialWorkspacePath, documentId],
])
const embeddedDocumentLoads = new Map<WorkspacePath, Promise<void>>()
const embeddedDocumentLoadFailures = new Map<WorkspacePath, number>()
let workspaceDeletionGeneration = 0
const tabs = new WorkspaceTabManager()
const tabSnapshot = ref(tabs.getSnapshot())
const documentRevisionSignal = ref(0)
const documentSubscriptions = new Map<DocumentId, () => void>()
/**
 * Tab metadata is a projection of the authoritative Store snapshot. Keep its
 * Vue invalidation independent from tab lifetime: a loaded Document can lose
 * its tab while an Embed projection continues editing it.
 */
const stopDocumentTimelineSubscription = store.subscribeTimeline((event) => {
  if (
    event.type === 'DocumentChanged' ||
    event.type === 'DocumentPersisted' ||
    event.type === 'DocumentRenamed'
  ) {
    documentRevisionSignal.value += 1
  }
})
const persistenceRevisionSignal = ref(0)
const persistenceSubscriptions = new Map<DocumentId, () => void>()
const stopKeybindingSubscription = keybindingSettingsStore.subscribe(() => {
  shortcutRevisionSignal.value += 1
})
const shortcutEntries = computed<readonly ShortcutSettingsEntry[]>(() => {
  shortcutRevisionSignal.value
  return createShortcutSettingsEntries(
    keybindingRegistry,
    DEFAULT_SHORTCUT_COMMANDS,
  )
})
const sidebarCollapsed = ref(initialSettings.sidebarCollapsed)
const sidebarPinned = ref(initialSettings.sidebarPinned)
const sidebarWidth = ref(initialSettings.sidebarWidth)
const activeWorkspaceTool = ref<'files' | 'search' | 'git'>('files')
const autoSaveDelay = ref(initialSettings.autoSaveDelayMs)
const imagePasteMode = ref<ImagePasteMode>(initialSettings.imagePasteMode)
const restoreLastWorkspace = ref(initialSettings.restoreLastWorkspace)
const settingsPanelOpen = ref(false)
const settingsError = ref<string | null>(null)
const shortcutRevisionSignal = ref(0)
const shortcutError = ref<string | null>(null)
const recoveryError = ref<string | null>(null)
const lastWorkspaceRestoreStatus = ref<'pending' | 'restored' | 'default'>('pending')
let restoringWorkspace = false

const editorHost = ref<HTMLDivElement | null>(null)
const previewHost = ref<HTMLDivElement | null>(null)
const splitEditorHost = ref<HTMLDivElement | null>(null)
const projection = ref<SingleDocumentView | null>(null)
const preview = ref<BasicLivePreview | null>(null)
const splitProjection = ref<SingleDocumentView | null>(null)
const splitDocumentId = ref<DocumentId | null>(null)
const mountedDocumentId = ref<DocumentId | null>(null)
const presentationMode = ref<PresentationMode>('source')
const presentationModes = new Map<DocumentId, PresentationMode>()
const workspaceTreeSnapshot = ref(workspaceTreeService.getSnapshot())
const referenceHealthSnapshot = ref(referenceHealth.getSnapshot())
const referenceHealthRevisionSignal = ref(0)
const stopReferenceHealthSubscription = referenceHealth.subscribe((snapshot) => {
  referenceHealthSnapshot.value = snapshot
  referenceHealthRevisionSignal.value += 1
})
const selectedWorkspacePath = ref<WorkspacePath | null>(initialWorkspacePath)
const workspaceRevealPath = ref<WorkspacePath | null>(initialWorkspacePath)
const workspaceRevealVersion = ref(0)
const workspaceNameInput = ref('')
const workspaceBusy = ref(false)
const persistenceBusy = ref(false)
const workspaceError = ref<string | null>(null)
const persistenceError = ref<string | null>(null)
const referenceHealthError = ref<string | null>(null)
const referenceClipboardStatus = ref<string | null>(null)
const referenceClipboardError = ref<string | null>(null)
const workspaceContextMenu = ref<{
  readonly path: WorkspacePath
  readonly x: number
  readonly y: number
} | null>(null)
const pendingWorkspaceDeletion = ref<{
  readonly plan: WorkspaceDeletionPlan
  readonly resolve: (decision: WorkspaceDeletionDecision) => void
} | null>(null)
const imagePasteStatus = ref<string | null>(null)
const imageActionStatus = ref<string | null>(null)
const imagePreview = ref<ImageProjectionResource | null>(null)
const annotationItems = ref<readonly import('./core/annotation').Annotation[]>([])
const activeAnnotationId = ref<string | null>(null)
const annotationDrawerOpen = ref(false)
const annotationDrawerWidth = ref(360)
const gitInfo = ref<GitRepositoryInfo | null>(null)
const gitStatuses = ref<readonly GitFileStatus[]>([])
const gitDiff = ref<GitDiffResult | null>(null)
const gitHistory = ref<readonly import('./platform/git').GitCommit[]>([])
const gitSelectedPath = ref<string | null>(null)
const gitLayout = ref<'unified' | 'split'>('unified')
const gitLoading = ref(false)
const gitError = ref<string | null>(null)
const searchResults = ref<readonly import('./core/search').SearchFileResult[]>([])
const searchQuery = ref<SearchQuery | null>(null)
const searchError = ref<string | null>(null)
const searchReplacement = ref('')
const searchService = new SearchService({
  list: () => workspaceFiles.value.flatMap((path) => {
    const loaded = store.get(documentByPath(createDocumentPath(path)))
    const disk = workspaceFileSystem.snapshot().get(createDocumentPath(path))
    const markdown = loaded?.markdown ?? disk
    return markdown === undefined ? [] : [{ path, markdown }]
  }),
})
const validationService = new ValidationService()
const validationIssues = ref<readonly import('./core/validation').ValidationIssue[]>([])
const strictValidation = ref(false)
const templateRecords = ref<readonly import('./application/template').TemplateRecord[]>([])
const selectedTemplateId = ref('meeting')
const templateName = ref('new-note.md')
const templateError = ref<string | null>(null)
const exportFormat = ref<ExportFormat>('markdown')
const exportStatus = ref<string | null>(null)
let annotationSequence = 0
let pendingFragmentNavigation: {
  readonly documentId: DocumentId
  readonly fragment: string
} | null = null

function workspaceDocumentPathForId(
  documentIdToResolve: DocumentId,
): WorkspacePath | undefined {
  const document = store.get(documentById(documentIdToResolve))
  if (!document) return undefined
  try {
    return createWorkspacePath(document.path)
  } catch {
    return undefined
  }
}

function persistWorkspaceRecovery(): void {
  const openDocumentPaths = tabSnapshot.value.tabs.flatMap((tab) => {
    const path = workspaceDocumentPathForId(tab.documentId)
    return path === undefined || path === '' ? [] : [path]
  })
  const activeDocumentPath =
    tabSnapshot.value.activeDocumentId === null
      ? null
      : workspaceDocumentPathForId(tabSnapshot.value.activeDocumentId) ?? null

  try {
    workspaceRecoveryStore.record({
      workspacePath: workspaceTreeService.getRootPath(),
      openDocumentPaths,
      activeDocumentPath,
      selectedWorkspacePath: selectedWorkspacePath.value,
    })
    recoveryError.value = null
  } catch (error) {
    recoveryError.value = workspaceErrorMessage(error)
  }
}

const stopTabsSubscription = tabs.subscribe((snapshot) => {
  tabSnapshot.value = snapshot
  persistWorkspaceRecovery()
})

function refreshReferenceHealth(): void {
  void referenceHealth.refresh().catch((error: unknown) => {
    referenceHealthError.value = workspaceErrorMessage(error)
  })
}

function refreshValidation(document: DocumentState | undefined = activeDocument.value): void {
  validationIssues.value = document
    ? validationService.validate(document.markdown, document.revision).issues
    : []
}

function cleanupLateEmbeddedDocument(
  path: WorkspacePath,
  documentIdToCleanup: DocumentId,
): void {
  const document = store.get(documentById(documentIdToCleanup))
  if (!document) {
    documentIdsByPath.delete(path)
    return
  }
  for (const attached of store.getProjections(documentById(document.id))) {
    try {
      store.detachProjection(documentById(document.id), attached.projectionId)
    } catch {
      // A parent projection may already have detached this child.
    }
  }
  persistence.untrack(documentById(document.id))
  referenceGraph.removeDocument({ kind: 'path', path })
  store.unload(documentById(document.id))
  documentIdsByPath.delete(path)
}

function indexReferenceDocument(document: DocumentState | undefined): void {
  if (!document) return
  try {
    referenceGraph.indexDocument(document)
    referenceHealthError.value = null
    refreshReferenceHealth()
  } catch (error) {
    referenceHealthError.value = workspaceErrorMessage(error)
  }
}

function observeDocument(documentIdToObserve: DocumentId): void {
  if (documentSubscriptions.has(documentIdToObserve)) return
  documentSubscriptions.set(
    documentIdToObserve,
    store.subscribe(documentById(documentIdToObserve), (event) => {
      if (event.type === 'changed' || event.type === 'renamed') {
        searchService.invalidate()
        refreshValidation(event.document)
        indexReferenceDocument(event.document)
        if (event.type === 'changed') {
          void annotationService
            .reanchor(event.document.path, event.document, event.change)
            .then((annotations) => {
              if (activeDocument.value?.id !== event.document.id) return
              annotationItems.value = annotations
              projection.value?.updateAnnotations(annotations)
            })
            .catch((error: unknown) => {
              workspaceError.value = workspaceErrorMessage(error)
            })
        }
      }
    }),
  )
}

function observePersistence(documentIdToObserve: DocumentId): void {
  if (persistenceSubscriptions.has(documentIdToObserve)) return
  persistenceSubscriptions.set(
    documentIdToObserve,
    persistence.subscribe(documentById(documentIdToObserve), () => {
      persistenceRevisionSignal.value += 1
    }),
  )
}

observeDocument(documentId)
observePersistence(documentId)

const activeDocument = computed<DocumentState | undefined>(() => {
  documentRevisionSignal.value
  const activeDocumentId = tabSnapshot.value.activeDocumentId
  return activeDocumentId === null
    ? undefined
    : store.get(documentById(activeDocumentId))
})

const splitDocument = computed<DocumentState | undefined>(() => {
  documentRevisionSignal.value
  return splitDocumentId.value === null
    ? undefined
    : store.get(documentById(splitDocumentId.value))
})

const activePersistenceState = computed(() => {
  persistenceRevisionSignal.value
  const activeDocumentId = tabSnapshot.value.activeDocumentId
  return activeDocumentId === null
    ? undefined
    : persistence.getState(documentById(activeDocumentId))
})

const activeReferenceHealth = computed(() => {
  referenceHealthRevisionSignal.value
  const path = workspacePathForDocument(activeDocument.value)
  if (path === undefined) return []
  return referenceHealthSnapshot.value.references.filter(
    (fact) => fact.sourcePath === path,
  )
})
const activeBrokenReferenceCount = computed(
  () => activeReferenceHealth.value.filter((fact) => fact.broken).length,
)
const activeOutline = computed(() => {
  documentRevisionSignal.value
  return activeDocument.value ? parseOutline(activeDocument.value.markdown) : []
})
const activeBacklinks = computed(() => {
  documentRevisionSignal.value
  const path = workspacePathForDocument(activeDocument.value)
  return path ? referenceGraph.getBacklinks(path) : []
})
const activeComposedStats = computed(() => {
  documentRevisionSignal.value
  const document = activeDocument.value
  if (!document) return { wordCount: 0, referenceCount: 0, embedCount: 0, outline: [], circularEmbeds: [] }
  return composedContentStats(document.path, document.markdown, {
    read: (path) => {
      const loaded = store.get(documentByPath(createDocumentPath(path)))
      return loaded?.markdown ?? workspaceFileSystem.snapshot().get(createDocumentPath(path))
    },
  })
})

const canAddAnnotation = computed(() => {
  const view = projection.value?.view
  if (!view) return false
  const { from, to } = view.state.selection.main
  return to > from
})

function workspacePathForDocument(
  document: DocumentState | undefined,
): WorkspacePath | undefined {
  if (!document) return undefined
  try {
    return createWorkspacePath(document.path)
  } catch {
    return undefined
  }
}

async function refreshGitWorkbench(): Promise<void> {
  gitLoading.value = true
  gitError.value = null
  try {
    gitInfo.value = await gitService.repositoryInfo(true)
    gitStatuses.value = gitInfo.value.isGitRepository
      ? await gitService.fileStatuses(true)
      : []
    gitDiff.value = null
    gitHistory.value = []
  } catch (error) {
    gitError.value = workspaceErrorMessage(error)
  } finally {
    gitLoading.value = false
  }
}

async function switchGitBranch(branch: string): Promise<void> {
  try {
    await gitService.switchBranch(branch)
    await refreshGitWorkbench()
  } catch (error) {
    gitError.value = workspaceErrorMessage(error)
  }
}

async function selectGitPath(path: string): Promise<void> {
  gitSelectedPath.value = path
  gitError.value = null
  try {
    gitDiff.value = await gitService.diff({
      kind: 'worktree-vs-head',
      path: createWorkspacePath(path),
    })
    gitHistory.value = await gitService.history(createWorkspacePath(path))
  } catch (error) {
    gitDiff.value = null
    gitError.value = workspaceErrorMessage(error)
  }
}

function toggleGitLayout(): void {
  gitLayout.value = gitLayout.value === 'unified' ? 'split' : 'unified'
}

async function discardGitFile(path: string): Promise<void> {
  if (!window.confirm(`Discard all Git changes in ${path}?`)) return
  try {
    await gitService.discardFile(createWorkspacePath(path))
    await refreshGitWorkbench()
  } catch (error) {
    gitError.value = workspaceErrorMessage(error)
  }
}

async function discardGitHunk(path: string, hunkId: string): Promise<void> {
  if (!window.confirm(`Discard Git hunk ${hunkId} in ${path}?`)) return
  try {
    await gitService.discardHunk(createWorkspacePath(path), hunkId)
    await selectGitPath(path)
  } catch (error) {
    gitError.value = workspaceErrorMessage(error)
  }
}

async function refreshActiveAnnotations(
  document: DocumentState | undefined = activeDocument.value,
): Promise<void> {
  if (!document) {
    annotationItems.value = []
    activeAnnotationId.value = null
    return
  }
  const annotations = await annotationService.list(document.path)
  if (activeDocument.value?.id !== document.id) return
  annotationItems.value = annotations
  if (activeAnnotationId.value && !annotations.some((item) => item.id === activeAnnotationId.value)) {
    activeAnnotationId.value = null
  }
  projection.value?.updateAnnotations(annotations)
}

function selectAnnotation(annotationId: string): void {
  const annotation = annotationItems.value.find((item) => item.id === annotationId)
  if (!annotation) return
  activeAnnotationId.value = annotationId
  annotationDrawerOpen.value = true
  void nextTick(() => {
    const mark = document.querySelector<HTMLElement>(
      `[data-annotation-id="${CSS.escape(annotationId)}"]`,
    )
    mark?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  })
}

function activateAnnotation(
  annotation: import('./core/annotation').Annotation,
  _view: EditorView,
): void {
  selectAnnotation(annotation.id)
}

async function addAnnotationFromSelection(): Promise<void> {
  const document = activeDocument.value
  const view = projection.value?.view
  if (!document || !view) return
  const { from, to } = view.state.selection.main
  if (to <= from) {
    workspaceError.value = 'Select a non-empty range before adding an annotation.'
    return
  }
  const selectedText = view.state.doc.sliceString(from, to)
  const first = document.markdown.indexOf(selectedText)
  const last = document.markdown.lastIndexOf(selectedText)
  const sourceFrom = first >= 0 && first === last
    ? first
    : document.markdown.slice(from, to) === selectedText
      ? from
      : -1
  if (sourceFrom < 0 || sourceFrom + selectedText.length > document.markdown.length) {
    workspaceError.value = 'The selected range is not source-backed.'
    return
  }
  const now = new Date().toISOString()
  const sequence = ++annotationSequence
  try {
    const annotation = await annotationService.create({
      id: `annotation-${sequence}`,
      document,
      from: sourceFrom,
      to: sourceFrom + selectedText.length,
      comment: {
        id: `comment-${sequence}`,
        author: 'You',
        body: 'Review this selection.',
        createdAt: now,
      },
    })
    annotationItems.value = [...annotationItems.value, annotation]
    activeAnnotationId.value = annotation.id
    annotationDrawerOpen.value = true
    projection.value?.updateAnnotations(annotationItems.value)
    workspaceError.value = null
  } catch (error) {
    workspaceError.value = workspaceErrorMessage(error)
  }
}

async function replyAnnotation(annotationId: string, body: string): Promise<void> {
  const document = activeDocument.value
  if (!document || !body.trim()) return
  try {
    const sequence = ++annotationSequence
    const updated = await annotationService.reply(document.path, annotationId, {
      id: `comment-${sequence}`,
      author: 'You',
      body: body.trim(),
      createdAt: new Date().toISOString(),
    })
    annotationItems.value = annotationItems.value.map((item) =>
      item.id === annotationId ? updated : item,
    )
    projection.value?.updateAnnotations(annotationItems.value)
    workspaceError.value = null
  } catch (error) {
    workspaceError.value = workspaceErrorMessage(error)
  }
}

async function resolveAnnotation(annotationId: string, resolved: boolean): Promise<void> {
  const document = activeDocument.value
  if (!document) return
  try {
    const updated = await annotationService.setResolved(
      document.path,
      annotationId,
      resolved ? 'resolved' : 'open',
      new Date().toISOString(),
    )
    annotationItems.value = annotationItems.value.map((item) =>
      item.id === annotationId ? updated : item,
    )
    projection.value?.updateAnnotations(annotationItems.value)
    workspaceError.value = null
  } catch (error) {
    workspaceError.value = workspaceErrorMessage(error)
  }
}

function resizeAnnotationDrawer(width: number): void {
  annotationDrawerWidth.value = Math.max(280, Math.min(560, Math.round(width)))
}

const documentTabViews = computed(() => {
  documentRevisionSignal.value
  persistenceRevisionSignal.value
  return tabSnapshot.value.tabs.map((tab) => {
    const document = store.get(documentById(tab.documentId))
    // A WorkspaceTab must always have an authoritative Store binding. Fail
    // visibly on a broken lifecycle invariant; never turn it into a clean tab.
    if (!document) {
      throw new Error(
        `Workspace tab ${tab.documentId} has no DocumentStore snapshot`,
      )
    }
    const persistenceState = persistence.getState(documentById(tab.documentId))
    const path = document.path
    let name: string = path
    try {
      name = workspaceName(createWorkspacePath(path))
    } catch {
      // A platform adapter may expose a path outside the workspace format;
      // keep the full path visible rather than dropping the tab.
    }
    return {
      documentId: tab.documentId,
      path,
      name,
      dirty: document.dirty,
      persistenceStatus: persistenceState.status,
    }
  })
})

const workspaceTreeUnsubscribe = workspaceTreeService.subscribe((snapshot) => {
  workspaceTreeSnapshot.value = snapshot
  searchService.invalidate()
  referenceGraph.setWorkspacePaths(orderedWorkspaceFilePaths(snapshot.tree))
  refreshReferenceHealth()
})
const selectedWorkspaceNode = computed(() =>
  selectedWorkspacePath.value === null
    ? undefined
    : findWorkspaceNode(
        workspaceTreeSnapshot.value.tree,
        selectedWorkspacePath.value,
      ),
)
const workspaceCreationParent = computed<WorkspacePath>(() => {
  const selected = selectedWorkspaceNode.value
  if (selected?.kind === 'directory') return selected.path
  if (selected?.kind === 'file') return workspaceParent(selected.path)
  return workspaceTreeService.getRootPath()
})
const workspaceCreationParentLabel = computed(
  () => workspaceCreationParent.value || '.',
)
const workspaceFiles = computed(() =>
  orderedWorkspaceFilePaths(workspaceTreeSnapshot.value.tree),
)

/**
 * Embeds are projections, not a second filesystem authority. If an embed
 * points at an unopened workspace file, load it through the normal persistence
 * service and let the DocumentStore snapshot become the child projection's
 * source. Concurrent embeds share one load promise.
 */
async function ensureEmbeddedDocument(
  context: EmbedProjectionMissingTargetContext,
): Promise<void> {
  let path: WorkspacePath
  try {
    path = createWorkspacePath(context.path ?? context.reference.path)
  } catch {
    return
  }
  const node = findWorkspaceNode(workspaceTreeSnapshot.value.tree, path)
  if (node?.kind !== 'file') return

  const existing = store.get(documentByPath(createDocumentPath(path)))
  if (existing) {
    documentIdsByPath.set(path, existing.id)
    observeDocument(existing.id)
    observePersistence(existing.id)
    return
  }

  const currentLoad = embeddedDocumentLoads.get(path)
  if (currentLoad) return currentLoad

  const loadGeneration = workspaceDeletionGeneration
  const load = (async () => {
    let id = documentIdsByPath.get(path)
    if (id === undefined) {
      id = createDocumentId(`workspace:${path}`)
      documentIdsByPath.set(path, id)
    }
    if (!store.get(documentById(id))) {
      const remainingFailures = embeddedDocumentLoadFailures.get(path) ?? 0
      if (remainingFailures > 0) {
        if (remainingFailures === 1) embeddedDocumentLoadFailures.delete(path)
        else embeddedDocumentLoadFailures.set(path, remainingFailures - 1)
        throw new Error(`Simulated transient Embed load failure: ${path}`)
      }
      await persistence.loadFromFile({
        id,
        path: createDocumentPath(path),
      })
    }
    if (
      loadGeneration !== workspaceDeletionGeneration ||
      findWorkspaceNode(workspaceTreeSnapshot.value.tree, path)?.kind !== 'file'
    ) {
      cleanupLateEmbeddedDocument(path, id)
      return
    }
    observeDocument(id)
    observePersistence(id)
    indexReferenceDocument(store.get(documentById(id)))
  })()
  embeddedDocumentLoads.set(path, load)
  try {
    await load
  } finally {
    embeddedDocumentLoads.delete(path)
  }
}

/**
 * Browser file managers provide absolute file:// paths while the workspace
 * contract is relative. Prefer a unique workspace suffix when available and
 * otherwise let the core clipboard policy fall back to the basename.
 */
function resolveExternalReferencePath(
  absolutePath: string,
): WorkspacePath | undefined {
  const normalized = absolutePath.replaceAll('\\', '/').replace(/\/+$/u, '')
  const lower = normalized.toLocaleLowerCase('en-US')
  const matches = workspaceFiles.value.filter((path) => {
    const candidate = String(path).toLocaleLowerCase('en-US')
    return lower === candidate || lower.endsWith(`/${candidate}`)
  })
  return matches.length === 1 ? matches[0] : undefined
}

referenceGraph.setWorkspacePaths(workspaceFiles.value)
refreshReferenceHealth()

watch(
  () => tabSnapshot.value.activeDocumentId,
  (activeDocumentId) => {
    refreshValidation(activeDocument.value)
    if (restoringWorkspace) return
    void nextTick(() => {
      if (
        !restoringWorkspace &&
        tabSnapshot.value.activeDocumentId === activeDocumentId
      ) {
        mountActiveDocument()
      }
    })
  },
)

function toggleEditorPresentation(): void {
  const next = projection.value?.togglePresentationMode()
  if (next) presentationMode.value = next
}

function workspaceErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function persistenceErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function handleReferenceClipboardApplied(result: {
  readonly items: readonly unknown[]
  readonly mode: string
}): void {
  const modeLabel =
    result.mode === 'link'
      ? 'link'
      : result.mode === 'embed-readonly' || result.mode === 'embed-ro'
        ? 'readonly embed'
        : 'editable embed'
  referenceClipboardStatus.value =
    `Pasted ${result.items.length} workspace entr${result.items.length === 1 ? 'y' : 'ies'} as ${modeLabel}.`
  referenceClipboardError.value = null
}

function handleReferenceClipboardError(error: unknown): void {
  referenceClipboardError.value = workspaceErrorMessage(error)
}

function referenceContextTargetPath(
  reference: { readonly raw: string; readonly from: number; readonly to: number },
  from: number,
  to: number,
): WorkspacePath | undefined {
  const fact = activeReferenceHealth.value.find(
    (candidate) =>
      candidate.from === from &&
      candidate.to === to &&
      candidate.raw === reference.raw,
  )
  return fact?.targetPath
}

function handleReferenceContextCopied(syntax: string): void {
  referenceClipboardStatus.value = `Copied reference syntax ${syntax}.`
  referenceClipboardError.value = null
}

function handleReferenceContextModeChanged(result: {
  readonly edit: { readonly mode: string; readonly insert: string }
}): void {
  const modeLabel =
    result.edit.mode === 'link'
      ? 'link'
      : result.edit.mode === 'embed-readonly'
        ? 'readonly embed'
        : 'editable embed'
  referenceClipboardStatus.value = `Changed reference to ${modeLabel}.`
  referenceClipboardError.value = null
}

function openReferenceContext(request: {
  readonly path: string
  readonly fragment: string | null
}): void {
  try {
    void openWorkspaceFile(createWorkspacePath(request.path), request.fragment)
  } catch (error) {
    handleReferenceClipboardError(error)
  }
}

async function copyWorkspaceEntry(path: WorkspacePath): Promise<void> {
  const node = findWorkspaceNode(workspaceTreeSnapshot.value.tree, path)
  if (!node || node === workspaceTreeSnapshot.value.tree.root) return

  referenceClipboardStatus.value = null
  referenceClipboardError.value = null
  try {
    const result = await referenceClipboard.copy(
      [{ kind: node.kind, path: node.path }],
      browserReferenceClipboard.writer,
    )
    referenceClipboardStatus.value = result.systemClipboardWritten
      ? `Copied ${node.path}. Ctrl/Cmd+V pastes it as a link reference.`
      : `Copied ${node.path} for in-app paste; browser clipboard access is unavailable.`
  } catch (error) {
    referenceClipboardError.value = workspaceErrorMessage(error)
  }
}

function openWorkspaceContextMenu(
  path: WorkspacePath,
  x: number,
  y: number,
): void {
  const node = findWorkspaceNode(workspaceTreeSnapshot.value.tree, path)
  if (!node || node === workspaceTreeSnapshot.value.tree.root) return
  selectedWorkspacePath.value = path
  workspaceContextMenu.value = { path, x, y }
  persistWorkspaceRecovery()
}

function closeWorkspaceContextMenu(): void {
  workspaceContextMenu.value = null
}

function copyWorkspaceContextEntry(): void {
  const path = workspaceContextMenu.value?.path
  closeWorkspaceContextMenu()
  if (path !== undefined) void copyWorkspaceEntry(path)
}

function handleImagePasteApplied(result: ImagePasteResult): void {
  const saved = result.savedPaths.length
  const inlined = result.inlinedCount
  imagePasteStatus.value =
    saved > 0 && inlined > 0
      ? `Pasted ${saved} image${saved === 1 ? '' : 's'}; ${inlined} kept inline as a safe fallback.`
      : saved > 0
        ? `Pasted ${saved} image${saved === 1 ? '' : 's'} to the workspace.`
        : `Pasted ${inlined} image${inlined === 1 ? '' : 's'} inline.`
  void workspaceTreeService.refresh().catch((error: unknown) => {
    workspaceError.value = workspaceErrorMessage(error)
  })
}

function handleImagePasteError(error: unknown): void {
  imagePasteStatus.value = `Image paste failed: ${workspaceErrorMessage(error)}`
}

function handleImagePasteDiagnostic(
  diagnostic: ImagePasteOrphanDiagnostic,
): void {
  imagePasteStatus.value =
    `Orphan attachment ${diagnostic.path}: ${diagnostic.reason}`
}

/**
 * Shared application policy for both the main editor and editable Embed
 * children. The Embed adapter supplies the target DocumentState.path and its
 * own projection mutation capability; this object never captures the host
 * document path.
 */
function createImagePasteBridgeOptions(): Omit<
  ImagePasteExtensionOptions,
  'getDocumentPath' | 'mutation'
> {
  return {
    handle: (images, context) =>
      imageAttachmentService.paste({
        images,
        mode: imagePasteMode.value,
        hostPath: context.documentPath,
      }),
    cleanupAttachments: (attachments, context) =>
      imageAttachmentService.cleanup(attachments, context),
    onApplied: handleImagePasteApplied,
    onDiagnostic: handleImagePasteDiagnostic,
    onError: handleImagePasteError,
  }
}

function openImagePreview(resource: ImageProjectionResource): void {
  imagePreview.value = resource
  imageActionStatus.value = null
}

async function copyImage(resource: ImageProjectionResource): Promise<void> {
  const copied = await copyImageToClipboard(resource)
  imageActionStatus.value = copied
    ? `Copied ${resource.name} to the clipboard.`
    : `Could not copy ${resource.name}; image clipboard access is unavailable.`
}

function revealImageInWorkspace(path: WorkspacePath): void {
  selectedWorkspacePath.value = path
  workspaceRevealPath.value = path
  workspaceRevealVersion.value += 1
  imageActionStatus.value = `Located ${path} in the workspace tree.`
  imagePreview.value = null
  workspaceError.value = null
  persistWorkspaceRecovery()
}

function applySettingsSnapshot(
  next: ReturnType<WorkspaceSettingsStore['getSnapshot']>,
  previousAutoSaveDelay: ReturnType<WorkspaceSettingsStore['getSnapshot']>['autoSaveDelayMs'],
): void {
  sidebarCollapsed.value = next.sidebarCollapsed
  sidebarPinned.value = next.sidebarPinned
  sidebarWidth.value = next.sidebarWidth
  autoSaveDelay.value = next.autoSaveDelayMs
  imagePasteMode.value = next.imagePasteMode
  restoreLastWorkspace.value = next.restoreLastWorkspace
  if (previousAutoSaveDelay !== next.autoSaveDelayMs) {
    persistence.setAutoSaveDelay(next.autoSaveDelayMs)
  }
}

function updateWorkspaceSettings(
  patch: Parameters<WorkspaceSettingsStore['update']>[0],
): void {
  try {
    const previous = workspaceSettingsStore.getSnapshot()
    const next = workspaceSettingsStore.update(patch)
    applySettingsSnapshot(next, previous.autoSaveDelayMs)
    settingsError.value = null
  } catch (error) {
    settingsError.value = workspaceErrorMessage(error)
  }
}

function shortcutErrorMessage(error: unknown): string {
  if (error instanceof KeybindingConflictError) {
    return `${error.keybinding} is already assigned to ${error.conflictingCommandIds.join(', ')}.`
  }
  return error instanceof Error ? error.message : String(error)
}

function setShortcutBinding(commandId: string, keybinding: string | null): void {
  try {
    keybindingSettingsStore.set(commandId, keybinding)
    shortcutError.value = null
  } catch (error) {
    shortcutError.value = shortcutErrorMessage(error)
  }
}

function resetShortcutBinding(commandId: string): void {
  try {
    keybindingSettingsStore.reset(commandId)
    shortcutError.value = null
  } catch (error) {
    shortcutError.value = shortcutErrorMessage(error)
  }
}

function resetAllShortcutBindings(): void {
  try {
    keybindingSettingsStore.resetAll()
    shortcutError.value = null
  } catch (error) {
    shortcutError.value = shortcutErrorMessage(error)
  }
}

function toggleSettingsPanel(): void {
  settingsPanelOpen.value = !settingsPanelOpen.value
  settingsError.value = null
  shortcutError.value = null
}

function closeSettingsPanel(): void {
  settingsPanelOpen.value = false
  settingsError.value = null
  shortcutError.value = null
}

function toggleSidebar(): void {
  updateWorkspaceSettings({ sidebarCollapsed: !sidebarCollapsed.value })
}

function toggleSidebarPinned(): void {
  updateWorkspaceSettings({ sidebarPinned: !sidebarPinned.value })
}

function selectWorkspaceTool(tool: 'files' | 'search' | 'git'): void {
  activeWorkspaceTool.value = tool
  if (tool === 'git' && gitInfo.value === null) void refreshGitWorkbench()
}

function runWorkspaceSearch(query: SearchQuery): void {
  searchError.value = null
  try {
    searchQuery.value = query
    searchResults.value = searchService.search(query)
  } catch (error) {
    searchResults.value = []
    searchError.value = workspaceErrorMessage(error)
  }
}

async function selectSearchMatch(path: string, from: number, to: number): Promise<void> {
  try {
    await openWorkspaceFile(createWorkspacePath(path))
    await nextTick()
    const document = activeDocument.value
    const view = projection.value?.view
    if (!document || document.path !== createDocumentPath(path) || !view) {
      throw new Error(`Search result could not be opened: ${path}`)
    }
    if (from < 0 || to < from || to > view.state.doc.length) {
      throw new Error(`Search result is no longer source-backed: ${path}:${from}`)
    }
    view.selectRange(from, to)
    searchError.value = null
  } catch (error) {
    searchError.value = workspaceErrorMessage(error)
  }
}

async function replaceSearchMatch(
  path: string,
  from: number,
  to: number,
  replacement: string,
): Promise<void> {
  try {
    const normalizedPath = createWorkspacePath(path)
    const id = await ensureWorkspaceDocumentLoaded(normalizedPath)
    searchService.replaceInDocument(store, documentById(id), from, to, replacement)
    searchService.invalidate()
    if (searchQuery.value) searchResults.value = searchService.search(searchQuery.value)
    searchError.value = `Replaced 1 occurrence in ${path}.`
  } catch (error) {
    searchError.value = `Replace failed for ${path}: ${workspaceErrorMessage(error)}`
  }
}

async function replaceAllSearchMatches(replacement: string): Promise<void> {
  const query = searchQuery.value
  if (!query) return
  const failures: string[] = []
  let replaced = 0
  for (const file of searchResults.value) {
    try {
      const id = await ensureWorkspaceDocumentLoaded(createWorkspacePath(file.path))
      // Apply from the end so all source offsets remain valid. Each operation
      // carries the current revision and therefore cannot overwrite an
      // external or concurrent change silently.
      for (const match of [...file.matches].sort((a, b) => b.from - a.from)) {
        searchService.replaceInDocument(store, documentById(id), match.from, match.to, replacement)
        replaced += 1
      }
    } catch (error) {
      failures.push(`${file.path}: ${workspaceErrorMessage(error)}`)
    }
  }
  searchService.invalidate()
  searchResults.value = searchService.search(query)
  searchError.value = failures.length > 0
    ? `Replaced ${replaced} occurrence${replaced === 1 ? '' : 's'}; failures: ${failures.join('; ')}`
    : `Replaced ${replaced} occurrence${replaced === 1 ? '' : 's'}.`
}

async function refreshTemplates(): Promise<void> {
  templateError.value = null
  templateRecords.value = await templateService.refresh()
  if (templateRecords.value.length > 0 && !templateRecords.value.some((item) => item.id === selectedTemplateId.value)) selectedTemplateId.value = templateRecords.value[0].id
  if (templateCatalog.getFailure()) templateError.value = templateCatalog.getFailure()
}

async function createFromSelectedTemplate(): Promise<void> {
  const name = templateName.value.trim()
  if (!name) { templateError.value = 'Enter a file name first.'; return }
  try {
    const result = await templateCreationService.create({ templateId: selectedTemplateId.value, parentPath: '', name })
    await refreshWorkspace()
    await openWorkspaceFile(result.path)
    templateError.value = `Created ${result.path}.`
  } catch (error) { templateError.value = workspaceErrorMessage(error) }
}

function insertSelectedTemplate(): void {
  const document = activeDocument.value
  const template = templateService.get(selectedTemplateId.value)
  const view = projection.value?.view
  if (!document || !template || !view) { templateError.value = 'Open a document before inserting a template.'; return }
  const at = view.state.selection.main.from
  try {
    view.dispatch({ changes: { from: at, to: view.state.selection.main.to, insert: template.markdown } })
    templateError.value = `Inserted ${template.name}.`
  } catch (error) { templateError.value = workspaceErrorMessage(error) }
}

function selectOutlineHeading(from: number): void {
  try {
    projection.value?.view.selectRange(from, from)
  } catch (error) {
    workspaceError.value = workspaceErrorMessage(error)
  }
}

async function selectBacklink(edge: { readonly sourcePath: string; readonly from: number; readonly to: number }): Promise<void> {
  try {
    await openWorkspaceFile(createWorkspacePath(edge.sourcePath))
    await nextTick()
    if (activeDocument.value?.path !== createDocumentPath(edge.sourcePath) || !projection.value) throw new Error('Backlink source is unavailable')
    projection.value.view.selectRange(edge.from, edge.to)
  } catch (error) {
    workspaceError.value = workspaceErrorMessage(error)
  }
}

function maybeAutoCollapseSidebar(): void {
  if (!sidebarPinned.value && !sidebarCollapsed.value) {
    updateWorkspaceSettings({ sidebarCollapsed: true })
  }
}

function handleMainFocusIn(event: FocusEvent): void {
  const target = event.target
  if (target instanceof Element && target.closest('.editor-host')) {
    maybeAutoCollapseSidebar()
  }
}

function changeSidebarCollapsed(event: Event): void {
  updateWorkspaceSettings({
    sidebarCollapsed: (event.target as HTMLInputElement).checked,
  })
}

function changeSidebarPinned(event: Event): void {
  updateWorkspaceSettings({
    sidebarPinned: (event.target as HTMLInputElement).checked,
  })
}

function changeRestoreLastWorkspace(event: Event): void {
  updateWorkspaceSettings({
    restoreLastWorkspace: (event.target as HTMLInputElement).checked,
  })
}

function resetWorkspaceSettings(): void {
  try {
    const previous = workspaceSettingsStore.getSnapshot()
    const next = workspaceSettingsStore.reset()
    applySettingsSnapshot(next, previous.autoSaveDelayMs)
    settingsError.value = null
  } catch (error) {
    settingsError.value = workspaceErrorMessage(error)
  }
}

function changeAutoSaveDelay(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  updateWorkspaceSettings({
    autoSaveDelayMs: value === 'manual' ? null : Number(value),
  })
}

function changeImagePasteMode(event: Event): void {
  const value = (event.target as HTMLSelectElement).value as ImagePasteMode
  updateWorkspaceSettings({ imagePasteMode: value })
}

function changeSidebarWidth(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(value)) return
  setSidebarWidth(value)
}

function setSidebarWidth(value: number): void {
  const bounded = Math.min(
    MAX_SIDEBAR_WIDTH,
    Math.max(MIN_SIDEBAR_WIDTH, Math.round(value)),
  )
  updateWorkspaceSettings({ sidebarWidth: bounded })
}

let sidebarResizeState: {
  readonly pointerId: number
  readonly startX: number
  readonly startWidth: number
} | null = null

function handleSidebarResizeMove(event: PointerEvent): void {
  const state = sidebarResizeState
  if (!state || event.pointerId !== state.pointerId) return
  setSidebarWidth(state.startWidth + event.clientX - state.startX)
}

function endSidebarResize(event?: PointerEvent): void {
  if (event && sidebarResizeState && event.pointerId !== sidebarResizeState.pointerId) {
    return
  }
  sidebarResizeState = null
  window.removeEventListener('pointermove', handleSidebarResizeMove)
  window.removeEventListener('pointerup', endSidebarResize)
  window.removeEventListener('pointercancel', endSidebarResize)
}

function beginSidebarResize(event: PointerEvent): void {
  if (event.button !== 0 || sidebarCollapsed.value) return
  event.preventDefault()
  sidebarResizeState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startWidth: sidebarWidth.value,
  }
  const target = event.currentTarget
  if (target instanceof HTMLElement) {
    try {
      target.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture is an enhancement; window listeners remain the guard.
    }
  }
  window.addEventListener('pointermove', handleSidebarResizeMove)
  window.addEventListener('pointerup', endSidebarResize)
  window.addEventListener('pointercancel', endSidebarResize)
}

function handleSidebarResizeKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault()
    setSidebarWidth(
      sidebarWidth.value + (event.key === 'ArrowRight' ? 16 : -16),
    )
  } else if (event.key === 'Home') {
    event.preventDefault()
    setSidebarWidth(MIN_SIDEBAR_WIDTH)
  } else if (event.key === 'End') {
    event.preventDefault()
    setSidebarWidth(MAX_SIDEBAR_WIDTH)
  }
}

async function saveActiveDocument(): Promise<void> {
  const document = activeDocument.value
  if (!document || persistenceBusy.value) return

  persistenceBusy.value = true
  persistenceError.value = null
  try {
    const validation = validationService.validate(document.markdown, document.revision)
    validationIssues.value = validation.issues
    if (strictValidation.value && validation.issues.some((issue) => issue.severity === 'error')) {
      throw new Error(`Save blocked by ${validation.issues.filter((issue) => issue.severity === 'error').length} validation error(s).`)
    }
    await persistence.save(documentById(document.id))
  } catch (error) {
    persistenceError.value = persistenceErrorMessage(error)
  } finally {
    persistenceBusy.value = false
  }
}

async function exportActiveDocument(): Promise<void> {
  const document = activeDocument.value
  if (!document) return
  const result = await exportService.export(exportService.snapshot(store, documentById(document.id)), { format: exportFormat.value })
  exportStatus.value = result.success
    ? `Exported ${result.output?.path} (${result.output?.bytes.length ?? 0} bytes).`
    : `Export failed: ${result.failure?.message}`
}

async function checkActiveExternalFile(): Promise<void> {
  const document = activeDocument.value
  if (!document || persistenceBusy.value) return

  persistenceBusy.value = true
  persistenceError.value = null
  try {
    const result = await persistence.checkExternalChange(documentById(document.id))
    if (!result.changed) persistenceError.value = null
  } catch (error) {
    persistenceError.value = persistenceErrorMessage(error)
  } finally {
    persistenceBusy.value = false
  }
}

async function reloadActiveFromDisk(): Promise<void> {
  const document = activeDocument.value
  if (!document || persistenceBusy.value) return

  persistenceBusy.value = true
  persistenceError.value = null
  try {
    if (document.dirty) {
      await persistence.discardLocalChanges(documentById(document.id))
    } else {
      await persistence.reloadFromDisk(documentById(document.id))
    }
  } catch (error) {
    persistenceError.value = persistenceErrorMessage(error)
  } finally {
    persistenceBusy.value = false
  }
}

function syncActiveWorkspaceSelection(reveal = true): void {
  const path = workspacePathForDocument(activeDocument.value)
  selectedWorkspacePath.value = path ?? null
  if (path !== undefined && reveal) {
    workspaceRevealPath.value = path
    workspaceRevealVersion.value += 1
  }
  persistWorkspaceRecovery()
}

function destroyActiveProjections(): void {
  const activeProjection = projection.value
  const activePreview = preview.value
  const previousDocumentId = mountedDocumentId.value
  if (previousDocumentId !== null && activeProjection) {
    presentationModes.set(previousDocumentId, activeProjection.presentationMode)
  }

  projection.value = null
  preview.value = null
  imagePreview.value = null
  imageActionStatus.value = null
  annotationItems.value = []
  activeAnnotationId.value = null
  annotationDrawerOpen.value = false
  mountedDocumentId.value = null
  try {
    activeProjection?.destroy()
  } finally {
    activePreview?.destroy()
  }
}

function destroySplitProjection(): void {
  const activeSplit = splitProjection.value
  splitProjection.value = null
  activeSplit?.destroy()
}

function closeSplitPane(): void {
  destroySplitProjection()
  splitDocumentId.value = null
}

function mountSplitDocument(fragment: string | null = null): void {
  destroySplitProjection()
  const host = splitEditorHost.value
  const documentIdToMount = splitDocumentId.value
  if (!host || documentIdToMount === null) return
  const document = store.get(documentById(documentIdToMount))
  if (!document) return
  const next = mountSingleDocumentView({
    store,
    locator: documentById(document.id),
    parent: host,
    projectionId: `cm6-split-${document.id}`,
    editable: true,
    presentationMode: presentationModes.get(document.id) ?? 'source',
  })
  splitProjection.value = next
  if (fragment !== null) next.jumpToFragment(fragment)
}

function mountActiveDocument(): void {
  if (!editorHost.value || !previewHost.value) return

  destroyActiveProjections()
  const document = activeDocument.value
  if (!document) {
    presentationMode.value = 'source'
    return
  }

  const locator = documentById(document.id)
  const initialPresentationMode =
    presentationModes.get(document.id) ?? 'source'
  const imageProjectionOptions = {
    imageResolver: imageProjectionResolver,
    documentPath: document.path,
    onPreview: openImagePreview,
    onCopy: copyImage,
    onReveal: revealImageInWorkspace,
  }
  try {
    const nextProjection = mountSingleDocumentView({
      store,
      locator,
      parent: editorHost.value,
      editable: true,
      presentationMode: initialPresentationMode,
      extensions: [
        createLivePreviewExtension({
          ...imageProjectionOptions,
          initialMode: initialPresentationMode,
          onOpenMermaidReference: (path, event) => {
            try {
              const target = createWorkspacePath(path)
              if (event.shiftKey) void openWorkspaceFileInSplit(target)
              else void openWorkspaceFile(target)
            } catch (error) {
              workspaceError.value = workspaceErrorMessage(error)
            }
          },
          isMermaidReferenceAvailable: (path) => {
            try {
              return findWorkspaceNode(
                workspaceTreeSnapshot.value.tree,
                createWorkspacePath(path),
              )?.kind === 'file'
            } catch {
              return false
            }
          },
        }),
        EditorView.updateListener.of(() => {
          if (
            projection.value &&
            mountedDocumentId.value === document.id
          ) {
            presentationMode.value = projection.value.presentationMode
          }
        }),
        createImagePasteExtension({
          ...createImagePasteBridgeOptions(),
          getDocumentPath: () => activeDocument.value?.path ?? null,
        }),
        createAnnotationExtension({
          getAnnotations: () => annotationItems.value,
          onActivate: activateAnnotation,
        }),
        createReferenceClipboardExtension({
          store: referenceClipboard.store,
          readClipboard: browserReferenceClipboard.read,
          resolveExternalPath: resolveExternalReferencePath,
          onApplied: handleReferenceClipboardApplied,
          onError: handleReferenceClipboardError,
          contextActions: {
            getTargetPath: referenceContextTargetPath,
            onOpen: openReferenceContext,
            copyText: async (syntax) => {
              if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
                throw new Error('Text clipboard access is unavailable')
              }
              await navigator.clipboard.writeText(syntax)
            },
            onCopied: handleReferenceContextCopied,
            onModeChanged: handleReferenceContextModeChanged,
          },
        }),
        createSlashQuickInsertExtension({
          registry: quickInsertRegistry,
        }),
        createReferenceNavigationExtension({
          getSourcePath: () => workspacePathForDocument(activeDocument.value) ?? null,
          healthResolver: referenceHealth,
          reselectProvider: (_request) =>
            referenceGraph
              .getWorkspacePaths()
              .filter((path) => /\.(?:md|markdown|txt)$/iu.test(path))
              .filter((path) =>
                path
                  .split('/')
                  .slice(0, -1)
                  .every((segment) => !segment.startsWith('.')),
              )
              .map((path) => ({ path, label: path })),
          onOpen: (path, fragment) => {
            void openWorkspaceFile(path, fragment)
          },
          onOpenInSplit: (path, fragment) => {
            void openWorkspaceFileInSplit(path, fragment)
          },
        }),
        createCompletionExtension({
          registry: completionRegistry,
        }),
        createEmbedProjectionExtension({
          store,
          locator,
          getAvailablePaths: () => workspaceFiles.value,
          onTargetMissing: ensureEmbeddedDocument,
          subscribeTargets: (listener) =>
            referenceHealth.subscribe(() => listener()),
          imageProjection: imageProjectionOptions,
          slashQuickInsert: {
            registry: quickInsertRegistry,
          },
          completion: {
            registry: completionRegistry,
          },
          imagePaste: createImagePasteBridgeOptions(),
          onOpen: (path, fragment) =>
            openReferenceContext({ path, fragment }),
          onOpenInSplit: (path, fragment) =>
            openWorkspaceFileInSplit(createWorkspacePath(path), fragment),
        }),
      ],
      imageProjection: imageProjectionOptions,
    })
    projection.value = nextProjection
    mountedDocumentId.value = document.id
    presentationMode.value = nextProjection.presentationMode
    void refreshActiveAnnotations(document).catch((error: unknown) => {
      workspaceError.value = workspaceErrorMessage(error)
    })
    preview.value = mountBasicLivePreview({
      store,
      locator,
      parent: previewHost.value,
      ...imageProjectionOptions,
    })
    if (pendingFragmentNavigation?.documentId === document.id) {
      nextProjection.jumpToFragment(pendingFragmentNavigation.fragment)
      pendingFragmentNavigation = null
    }
  } catch (error) {
    destroyActiveProjections()
    workspaceError.value = workspaceErrorMessage(error)
  }
}

function activateWorkspaceTab(documentIdToActivate: DocumentId): void {
  if (!tabs.isOpen(documentIdToActivate)) return
  if (tabSnapshot.value.activeDocumentId === documentIdToActivate) {
    syncActiveWorkspaceSelection()
    return
  }

  destroyActiveProjections()
  tabs.activate(documentIdToActivate)
  syncActiveWorkspaceSelection()
}

function navigateTabs(direction: -1 | 1): void {
  const next = tabs.getAdjacentTab(direction)
  if (next) activateWorkspaceTab(next.documentId)
}

async function ensureWorkspaceDocumentLoaded(
  normalizedPath: WorkspacePath,
): Promise<DocumentId> {
  const documentPathForOpen = createDocumentPath(normalizedPath)
  let loadedDocument = store.get(documentByPath(documentPathForOpen))
  let mappedDocumentId = documentIdsByPath.get(normalizedPath)

  if (!loadedDocument && mappedDocumentId !== undefined) {
    const mappedDocument = store.get(documentById(mappedDocumentId))
    if (mappedDocument?.path === documentPathForOpen) loadedDocument = mappedDocument
    else {
      documentIdsByPath.delete(normalizedPath)
      mappedDocumentId = undefined
    }
  }
  if (loadedDocument) {
    mappedDocumentId = loadedDocument.id
    documentIdsByPath.set(normalizedPath, loadedDocument.id)
  }

  const decision = decideWorkspaceOpen({
    loadedDocumentId: loadedDocument?.id,
    dirty: loadedDocument?.dirty ?? false,
    tabOpen: loadedDocument !== undefined && tabs.isOpen(loadedDocument.id),
  })
  let documentIdForPath: DocumentId
  if (decision.kind === 'load') {
    documentIdForPath = mappedDocumentId ?? createDocumentId(`workspace:${normalizedPath}`)
    await persistence.loadFromFile({ id: documentIdForPath, path: documentPathForOpen })
    documentIdsByPath.set(normalizedPath, documentIdForPath)
  } else {
    documentIdForPath = decision.documentId
    if (decision.kind === 'reopen-clean') {
      await persistence.reopen(documentById(documentIdForPath))
    }
  }
  observeDocument(documentIdForPath)
  observePersistence(documentIdForPath)
  indexReferenceDocument(store.get(documentById(documentIdForPath)))
  return documentIdForPath
}

async function openWorkspaceFileInSplit(
  path: WorkspacePath,
  fragment: string | null = null,
): Promise<void> {
  if (workspaceBusy.value) return
  const normalizedPath = createWorkspacePath(path)
  if (findWorkspaceNode(workspaceTreeSnapshot.value.tree, normalizedPath)?.kind !== 'file') return
  workspaceBusy.value = true
  workspaceError.value = null
  try {
    splitDocumentId.value = await ensureWorkspaceDocumentLoaded(normalizedPath)
    await nextTick()
    mountSplitDocument(fragment)
  } catch (error) {
    workspaceError.value = workspaceErrorMessage(error)
  } finally {
    workspaceBusy.value = false
  }
}

async function openWorkspaceFile(
  path: WorkspacePath,
  fragment: string | null = null,
): Promise<void> {
  if (workspaceBusy.value) return
  const normalizedPath = createWorkspacePath(path)
  const node = findWorkspaceNode(
    workspaceTreeSnapshot.value.tree,
    normalizedPath,
  )
  if (node?.kind !== 'file') {
    selectedWorkspacePath.value = normalizedPath
    return
  }

  workspaceBusy.value = true
  workspaceError.value = null
  try {
    const documentIdForPath = await ensureWorkspaceDocumentLoaded(normalizedPath)
    pendingFragmentNavigation =
      fragment === null
        ? null
        : { documentId: documentIdForPath, fragment }

    const previousActive = tabSnapshot.value.activeDocumentId
    if (previousActive !== documentIdForPath) destroyActiveProjections()
    tabs.open(documentIdForPath)
    maybeAutoCollapseSidebar()
    selectedWorkspacePath.value = normalizedPath
    workspaceRevealPath.value = normalizedPath
    workspaceRevealVersion.value += 1
    persistWorkspaceRecovery()
    await nextTick()
    if (
      fragment !== null &&
      tabSnapshot.value.activeDocumentId === documentIdForPath &&
      mountedDocumentId.value === documentIdForPath
    ) {
      projection.value?.jumpToFragment(fragment)
      pendingFragmentNavigation = null
    }
  } catch (error) {
    workspaceError.value = workspaceErrorMessage(error)
  } finally {
    workspaceBusy.value = false
  }
}

function navigateFiles(direction: -1 | 1): void {
  const currentPath = workspacePathForDocument(activeDocument.value)
  const nextPath = adjacentWorkspaceFilePath(
    workspaceTreeSnapshot.value.tree,
    currentPath,
    direction,
  )
  if (nextPath !== undefined) void openWorkspaceFile(nextPath)
}

function revealActiveFile(): void {
  const path = workspacePathForDocument(activeDocument.value)
  if (path === undefined) {
    workspaceError.value = 'There is no active document to reveal.'
    return
  }
  selectedWorkspacePath.value = path
  workspaceRevealPath.value = path
  workspaceRevealVersion.value += 1
  workspaceError.value = null
  persistWorkspaceRecovery()
}

async function closeWorkspaceTab(
  documentIdToClose: DocumentId,
): Promise<void> {
  if (workspaceBusy.value || persistenceBusy.value) return
  const documentToClose = store.get(documentById(documentIdToClose))
  if (
    documentToClose?.dirty &&
    !window.confirm(
      `${documentToClose.path} has unsaved changes. Close without saving? Local changes will be discarded.`,
    )
  ) {
    return
  }

  if (documentToClose?.dirty) {
    persistenceBusy.value = true
    persistenceError.value = null
    try {
      await persistence.discardLocalChanges(documentById(documentIdToClose))
    } catch (error) {
      persistenceError.value = persistenceErrorMessage(error)
      return
    } finally {
      persistenceBusy.value = false
    }
  }

  const wasActive = tabSnapshot.value.activeDocumentId === documentIdToClose
  if (wasActive) destroyActiveProjections()
  tabs.close(documentIdToClose)
  documentSubscriptions.get(documentIdToClose)?.()
  documentSubscriptions.delete(documentIdToClose)
  presentationModes.delete(documentIdToClose)

  if (wasActive) {
    syncActiveWorkspaceSelection()
  }
}

function selectWorkspaceEntry(path: WorkspacePath): void {
  selectedWorkspacePath.value = path
  workspaceError.value = null
  persistWorkspaceRecovery()
}

async function refreshWorkspace(): Promise<void> {
  if (workspaceBusy.value) return
  workspaceBusy.value = true
  workspaceError.value = null
  try {
    await workspaceTreeService.refresh()
  } catch (error) {
    workspaceError.value = workspaceErrorMessage(error)
  } finally {
    workspaceBusy.value = false
  }
}

async function createWorkspaceEntry(kind: 'file' | 'directory'): Promise<void> {
  if (workspaceBusy.value) return
  const name = workspaceNameInput.value.trim()
  if (name.length === 0) {
    workspaceError.value = 'Enter a file or directory name first.'
    return
  }

  workspaceBusy.value = true
  workspaceError.value = null
  try {
    const created =
      kind === 'file'
        ? await workspaceTreeService.createFile(
            workspaceCreationParent.value,
            name,
          )
        : await workspaceTreeService.createDirectory(
            workspaceCreationParent.value,
            name,
          )
    selectedWorkspacePath.value = created
    workspaceNameInput.value = ''
    persistWorkspaceRecovery()
  } catch (error) {
    workspaceError.value = workspaceErrorMessage(error)
  } finally {
    workspaceBusy.value = false
  }
}

async function renameWorkspaceEntry(
  path: WorkspacePath,
  name: string,
): Promise<void> {
  if (workspaceBusy.value) return
  workspaceBusy.value = true
  workspaceError.value = null
  try {
    const node = findWorkspaceNode(workspaceTreeSnapshot.value.tree, path)
    const renamed =
      node?.kind === 'file'
        ? await referenceRenameService.rename(path, name)
        : { targetPath: await workspaceTreeService.rename(path, name) }
    const documentIdForPath = documentIdsByPath.get(path)
    if (documentIdForPath !== undefined) {
      documentIdsByPath.delete(path)
      documentIdsByPath.set(renamed.targetPath, documentIdForPath)
    }
    if (node?.kind === 'file') await workspaceTreeService.refresh()
    selectedWorkspacePath.value = renamed.targetPath
    persistWorkspaceRecovery()
  } catch (error) {
    workspaceError.value = workspaceErrorMessage(error)
  } finally {
    workspaceBusy.value = false
  }
}

async function deleteWorkspaceEntry(path: WorkspacePath): Promise<void> {
  if (workspaceBusy.value) return
  workspaceBusy.value = true
  workspaceError.value = null
  try {
    const result = await workspaceTreeService.delete(path)
    if (!result.deleted) return
    selectedWorkspacePath.value = workspaceParent(path)
    persistWorkspaceRecovery()
    await nextTick()
    if (activeDocument.value && projection.value === null) {
      mountActiveDocument()
    }
  } catch (error) {
    workspaceError.value = workspaceErrorMessage(error)
  } finally {
    workspaceBusy.value = false
  }
}

async function moveWorkspaceEntry(
  source: WorkspacePath,
  destination: WorkspacePath,
): Promise<void> {
  if (workspaceBusy.value) return
  workspaceBusy.value = true
  workspaceError.value = null
  try {
    const node = findWorkspaceNode(workspaceTreeSnapshot.value.tree, source)
    const moved =
      node?.kind === 'file'
        ? await referenceRenameService.move(source, destination)
        : { targetPath: await workspaceTreeService.move(source, destination) }
    const documentIdForPath = documentIdsByPath.get(source)
    if (documentIdForPath !== undefined) {
      documentIdsByPath.delete(source)
      documentIdsByPath.set(moved.targetPath, documentIdForPath)
    }
    if (node?.kind === 'file') await workspaceTreeService.refresh()
    selectedWorkspacePath.value = moved.targetPath
    persistWorkspaceRecovery()
  } catch (error) {
    workspaceError.value = workspaceErrorMessage(error)
  } finally {
    workspaceBusy.value = false
  }
}

function requestWorkspaceDeletionDecision(
  plan: WorkspaceDeletionPlan,
): Promise<WorkspaceDeletionDecision> {
  return new Promise((resolve) => {
    pendingWorkspaceDeletion.value = { plan, resolve }
  })
}

function chooseWorkspaceDeletionDecision(
  decision: WorkspaceDeletionDecision,
): void {
  const pending = pendingWorkspaceDeletion.value
  if (!pending) return
  pendingWorkspaceDeletion.value = null
  pending.resolve(decision)
}

function activeProjectionBindings(): readonly WorkspaceProjectionBinding[] {
  const documentId = mountedDocumentId.value
  if (documentId === null) return Object.freeze([])

  const editor = projection.value
  const livePreview = preview.value
  const bindings: WorkspaceProjectionBinding[] = []
  if (editor) {
    bindings.push({
      documentId,
      projectionId: editor.projectionId,
      destroy: () => editor.destroy(),
    })
  }
  if (livePreview) {
    bindings.push({
      documentId,
      projectionId: livePreview.projectionId,
      destroy: () => livePreview.destroy(),
    })
  }
  return Object.freeze(bindings)
}

function forgetDeletedDocuments(plan: WorkspaceDeletionPlan): void {
  const deletedIds = new Set(
    plan.documents.map((document) => document.documentId),
  )
  for (const [path, documentId] of documentIdsByPath) {
    if (deletedIds.has(documentId) || plan.affectedPaths.includes(path)) {
      documentIdsByPath.delete(path)
    }
  }
  for (const documentId of deletedIds) {
    documentSubscriptions.get(documentId)?.()
    documentSubscriptions.delete(documentId)
    persistenceSubscriptions.get(documentId)?.()
    persistenceSubscriptions.delete(documentId)
    presentationModes.delete(documentId)
  }
  if (
    pendingFragmentNavigation &&
    deletedIds.has(pendingFragmentNavigation.documentId)
  ) {
    pendingFragmentNavigation = null
  }
  for (const path of plan.affectedPaths) embeddedDocumentLoads.delete(path)
  workspaceDeletionGeneration += 1
}

function configureWorkspaceDeletion(): void {
  workspaceTreeService.configureDeletion({
    store,
    tabs,
    persistence,
    recovery: workspaceRecoveryStore,
    referenceGraph,
    getProjectionBindings: activeProjectionBindings,
    resolveDirty: requestWorkspaceDeletionDecision,
    onDeleteCommitted: () => {
      // The active host may own nested embed projections for a descendant
      // document, so a successful deletion tears down the whole projection
      // tree before Store documents are unloaded.
      destroyActiveProjections()
    },
    onDocumentsUnloaded: forgetDeletedDocuments,
  })
}

configureWorkspaceDeletion()

function handleWorkspaceKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return
  const modifier = event.ctrlKey || event.metaKey
  if (modifier && event.key === 'Tab') {
    event.preventDefault()
    navigateTabs(event.shiftKey ? -1 : 1)
    return
  }
  if (
    event.altKey &&
    !modifier &&
    (event.key === 'ArrowUp' || event.key === 'ArrowDown')
  ) {
    event.preventDefault()
    navigateFiles(event.key === 'ArrowUp' ? -1 : 1)
  }
}

async function restoreWorkspaceSession(): Promise<void> {
  const recovery = workspaceRecoveryStore.getSnapshot()
  const rootPath = workspaceTreeService.getRootPath()
  const canRestore =
    workspaceSettingsStore.getSnapshot().restoreLastWorkspace &&
    workspaceRecoveryStore.hasStoredSession() &&
    workspaceRecoveryStore.isForWorkspace(rootPath)

  restoringWorkspace = true
  try {
    if (!canRestore) {
      await openWorkspaceFile(initialWorkspacePath)
      lastWorkspaceRestoreStatus.value = 'default'
      return
    }

    const availablePaths = new Set(workspaceFiles.value)
    const pathsToOpen = workspaceRecoveryStore.validDocumentPaths(availablePaths)
    for (const path of pathsToOpen) {
      await openWorkspaceFile(path)
    }

    if (recovery.activeDocumentPath !== null) {
      const activeId = documentIdsByPath.get(recovery.activeDocumentPath)
      if (activeId !== undefined && tabs.isOpen(activeId)) {
        tabs.activate(activeId)
      }
    }

    const selectedPath = recovery.selectedWorkspacePath
    if (selectedPath !== null && findWorkspaceNode(workspaceTreeSnapshot.value.tree, selectedPath)) {
      selectedWorkspacePath.value = selectedPath
    } else {
      syncActiveWorkspaceSelection(false)
    }
    const revealPath = selectedWorkspacePath.value ?? recovery.activeDocumentPath
    if (revealPath !== null && revealPath !== undefined) {
      workspaceRevealPath.value = revealPath
      workspaceRevealVersion.value += 1
    }
    lastWorkspaceRestoreStatus.value = 'restored'
    persistWorkspaceRecovery()
  } finally {
    restoringWorkspace = false
  }
}

function registerApplicationCommands(): void {
  applicationCommandRegistry.register({
    id: 'document.save',
    label: 'Save document',
    group: 'File',
    keywords: ['save', 'write', 'persist'],
    availability: () => activeDocument.value !== undefined && !persistenceBusy.value,
    execute: () => {
      void saveActiveDocument()
    },
  })
  applicationCommandRegistry.register({
    id: 'editor.toggle-preview',
    label: 'Toggle live preview',
    group: 'Editor',
    keywords: ['source', 'preview', 'presentation'],
    availability: () => projection.value !== null,
    execute: () => toggleEditorPresentation(),
  })
  applicationCommandRegistry.register({
    id: 'workspace.next-tab',
    label: 'Next tab',
    group: 'Workspace',
    keywords: ['tab', 'document', 'forward'],
    availability: () => tabSnapshot.value.tabs.length > 1,
    execute: () => navigateTabs(1),
  })
  applicationCommandRegistry.register({
    id: 'workspace.previous-tab',
    label: 'Previous tab',
    group: 'Workspace',
    keywords: ['tab', 'document', 'back'],
    availability: () => tabSnapshot.value.tabs.length > 1,
    execute: () => navigateTabs(-1),
  })
  for (const tableCommand of createTableCommands()) {
    const commandId = tableCommand.id as TableCommandId
    applicationCommandRegistry.register({
      id: commandId,
      label: tableCommand.label,
      group: tableCommand.group,
      keywords: tableCommand.keywords,
      availability: () => projection.value?.canExecuteTableCommand(commandId) ?? false,
      execute: () => projection.value?.executeTableCommand(commandId),
    })
  }
}

function handleShortcutKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.isComposing) return

  const commandId = keybindingRegistry.resolveInput(event)
  if (commandId === undefined) return

  const command = applicationCommandRegistry.get(commandId)
  if (!command) return

  const context: ApplicationCommandContext = { source: 'shortcut' }
  try {
    const available = command.availability(context)
    if (typeof available === 'boolean') {
      if (!available) return
      event.preventDefault()
      void applicationCommandRegistry
        .execute(commandId, context)
        .catch((error: unknown) => {
          workspaceError.value = workspaceErrorMessage(error)
        })
      return
    }

    event.preventDefault()
    void available
      .then((isAvailable) => {
        if (!isAvailable) return
        return applicationCommandRegistry.execute(commandId, context)
      })
      .catch((error: unknown) => {
        workspaceError.value = workspaceErrorMessage(error)
      })
  } catch (error) {
    workspaceError.value = workspaceErrorMessage(error)
  }
}

registerApplicationCommands()

async function initializeWorkspace(): Promise<void> {
  await refreshWorkspace()
  await refreshTemplates()
  await restoreWorkspaceSession()
  await nextTick()
  mountActiveDocument()
}

onMounted(() => {
  if (import.meta.env.DEV) {
    ;(window as unknown as {
      __writeItV2AppTest?: {
        failNextEmbeddedLoad(path: string, count?: number): void
      }
    }).__writeItV2AppTest = {
      failNextEmbeddedLoad(path, count = 1) {
        const normalized = createWorkspacePath(path)
        embeddedDocumentLoadFailures.set(
          normalized,
          Math.max(1, Math.trunc(count)),
        )
      },
    }
  }
  window.addEventListener('keydown', handleWorkspaceKeydown)
  window.addEventListener('keydown', handleShortcutKeydown)
  void initializeWorkspace().catch((error: unknown) => {
    workspaceError.value = workspaceErrorMessage(error)
    restoringWorkspace = false
    mountActiveDocument()
  })
})

onBeforeUnmount(() => {
  if (import.meta.env.DEV) {
    delete (window as unknown as { __writeItV2AppTest?: unknown })
      .__writeItV2AppTest
  }
  if (pendingWorkspaceDeletion.value) {
    const pending = pendingWorkspaceDeletion.value
    pendingWorkspaceDeletion.value = null
    pending.resolve('cancel')
  }
  window.removeEventListener('keydown', handleWorkspaceKeydown)
  window.removeEventListener('keydown', handleShortcutKeydown)
  endSidebarResize()
  persistWorkspaceRecovery()
  destroyActiveProjections()
  destroySplitProjection()
  imagePreview.value = null
  imageProjectionResolver.dispose()
  for (const unsubscribe of documentSubscriptions.values()) unsubscribe()
  documentSubscriptions.clear()
  for (const unsubscribe of persistenceSubscriptions.values()) unsubscribe()
  persistenceSubscriptions.clear()
  stopDocumentTimelineSubscription()
  persistence.destroy()
  stopTabsSubscription()
  stopKeybindingSubscription()
  stopReferenceHealthSubscription()
  referenceHealth.dispose()
  workspaceTreeUnsubscribe()
  projection.value = null
  preview.value = null
})
</script>

<template>
  <main class="app-shell" @click="closeWorkspaceContextMenu">
    <header class="app-header">
      <div>
        <p class="eyebrow">WriteIt v2 · P4-09</p>
        <h1>Markdown-first editor surface</h1>
        <p class="subtitle">
          一个 DocumentStore；源码与 Live Preview 共用同一个 CM6 编辑器状态。
        </p>
        <button
          type="button"
          class="settings-toggle"
          data-testid="workspace-settings-toggle"
          :aria-expanded="settingsPanelOpen"
          aria-controls="workspace-settings-panel"
          @click="toggleSettingsPanel"
        >
          Settings
        </button>
      </div>
      <dl class="document-meta" aria-label="Document status">
        <div>
          <dt>Document</dt>
          <dd>{{ activeDocument?.path ?? '—' }}</dd>
        </div>
        <div>
          <dt>Revision</dt>
          <dd>{{ activeDocument?.revision ?? '—' }}</dd>
        </div>
        <div>
          <dt>State</dt>
          <dd>{{ activeDocument ? (activeDocument.dirty ? 'dirty' : 'clean') : '—' }}</dd>
        </div>
        <div>
          <dt>Persistence</dt>
          <dd data-testid="persistence-status">{{ activePersistenceState?.status ?? '—' }}</dd>
        </div>
      </dl>
    </header>

    <section
      v-if="settingsPanelOpen"
      id="workspace-settings-panel"
      class="workspace-settings"
      role="dialog"
      aria-label="Workspace settings"
      data-testid="workspace-settings-panel"
    >
      <div class="workspace-settings__header">
        <div>
          <p class="workspace-eyebrow">Workspace shell</p>
          <h2>Settings</h2>
        </div>
        <button
          type="button"
          class="workspace-settings__close"
          data-testid="workspace-settings-close"
          aria-label="Close settings"
          @click="closeSettingsPanel"
        >
          ×
        </button>
      </div>
      <div class="workspace-settings__body">
        <label class="workspace-settings__check">
          <input
            type="checkbox"
            data-testid="settings-sidebar-collapsed"
            :checked="sidebarCollapsed"
            @change="changeSidebarCollapsed"
          />
          <span>Collapse sidebar</span>
        </label>
        <label class="workspace-settings__check">
          <input
            type="checkbox"
            data-testid="settings-sidebar-pinned"
            :checked="sidebarPinned"
            @change="changeSidebarPinned"
          />
          <span>Pin sidebar open</span>
        </label>
        <label class="workspace-settings__field" for="settings-sidebar-width">
          <span>
            Sidebar width
            <output data-testid="settings-sidebar-width-value">{{ sidebarWidth }}px</output>
          </span>
          <input
            id="settings-sidebar-width"
            type="range"
            data-testid="settings-sidebar-width"
            :min="MIN_SIDEBAR_WIDTH"
            :max="MAX_SIDEBAR_WIDTH"
            step="1"
            :value="sidebarWidth"
            @input="changeSidebarWidth"
          />
        </label>
        <label class="workspace-settings__field" for="settings-auto-save">
          <span>Auto-save</span>
          <select
            id="settings-auto-save"
            data-testid="settings-auto-save"
            :value="autoSaveDelay === null ? 'manual' : String(autoSaveDelay)"
            :disabled="persistenceBusy"
            @change="changeAutoSaveDelay"
          >
            <option value="manual">Manual</option>
            <option value="500">0.5s</option>
            <option value="1000">1s</option>
            <option value="2000">2s</option>
          </select>
        </label>
        <label class="workspace-settings__field" for="settings-image-paste-mode">
          <span>Image paste</span>
          <select
            id="settings-image-paste-mode"
            data-testid="settings-image-paste-mode"
            :value="imagePasteMode"
            :disabled="persistenceBusy"
            @change="changeImagePasteMode"
          >
            <option
              v-for="option in IMAGE_PASTE_MODE_OPTIONS"
              :key="option.id"
              :value="option.id"
              :title="option.description"
            >
              {{ option.label }}
            </option>
          </select>
        </label>
        <label class="workspace-settings__check">
          <input
            type="checkbox"
            data-testid="settings-restore-workspace"
            :checked="restoreLastWorkspace"
            @change="changeRestoreLastWorkspace"
          />
          <span>Restore last workspace session</span>
        </label>
        <p class="workspace-settings__hint" data-testid="workspace-recovery-status">
          {{ lastWorkspaceRestoreStatus === 'pending' ? 'Restoring workspace…' : lastWorkspaceRestoreStatus === 'restored' ? 'Last workspace session restored.' : 'Started the default workspace.' }}
        </p>
        <p v-if="settingsError || recoveryError" class="workspace-settings__error" data-testid="settings-error">
          {{ settingsError ?? recoveryError }}
        </p>
        <div class="workspace-settings__actions">
          <button
            type="button"
            class="workspace-settings__reset"
            data-testid="settings-reset"
            @click="resetWorkspaceSettings"
          >
            Reset defaults
          </button>
        </div>

        <ShortcutSettingsPanel
          :entries="shortcutEntries"
          :error="shortcutError"
          @set="setShortcutBinding"
          @reset="resetShortcutBinding"
          @reset-all="resetAllShortcutBindings"
        />
      </div>
    </section>

    <div
      class="workspace-layout"
      :class="{ 'workspace-layout--sidebar-collapsed': sidebarCollapsed }"
      :style="{ '--workspace-sidebar-width': `${sidebarWidth}px` }"
    >
      <aside
        class="workspace-card"
        :class="{ 'workspace-card--collapsed': sidebarCollapsed }"
        aria-label="Workspace tree"
      >
        <div class="workspace-heading">
          <div>
            <p class="workspace-eyebrow">Workspace</p>
            <h2>Files</h2>
          </div>
          <div class="workspace-heading-actions">
            <button
              type="button"
              class="workspace-shell-action"
              data-testid="workspace-sidebar-toggle"
              :aria-expanded="!sidebarCollapsed"
              :aria-label="sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
              @click="toggleSidebar"
            >
              {{ sidebarCollapsed ? 'Expand' : 'Collapse' }}
            </button>
            <button
              type="button"
              class="workspace-shell-action"
              data-testid="workspace-sidebar-pin"
              :aria-pressed="sidebarPinned"
              :title="sidebarPinned ? 'Unpin sidebar' : 'Pin sidebar'"
              @click="toggleSidebarPinned"
            >
              {{ sidebarPinned ? 'Pinned' : 'Pin' }}
            </button>
            <button
              type="button"
              class="workspace-reveal"
              data-testid="workspace-reveal-current"
              aria-label="Reveal current file"
              :disabled="workspaceBusy || !activeDocument"
              @click="revealActiveFile"
            >
              Reveal current
            </button>
            <button
              type="button"
              class="workspace-refresh"
              data-testid="workspace-refresh"
              :disabled="workspaceBusy"
              @click="refreshWorkspace"
            >
              Refresh
            </button>
          </div>
        </div>
        <div class="workspace-card__body">
        <nav class="workspace-tools" aria-label="Workspace tools">
          <button
            v-for="tool in (['files', 'search', 'git'] as const)"
            :key="tool"
            type="button"
            class="workspace-tool"
            :class="{ 'workspace-tool--active': activeWorkspaceTool === tool }"
            :data-testid="`workspace-tool-${tool}`"
            :aria-pressed="activeWorkspaceTool === tool"
            @click="selectWorkspaceTool(tool)"
          >
            {{ tool === 'files' ? 'Files' : tool === 'search' ? 'Search' : 'Git' }}
          </button>
        </nav>
        <aside v-if="activeDocument" class="workspace-derived" aria-label="Derived document views">
          <section class="workspace-derived__section" data-testid="workspace-outline">
            <h3>Outline</h3>
            <ul>
              <li v-for="heading in flattenOutline(activeOutline)" :key="heading.id">
                <button type="button" :style="{ marginLeft: `${(heading.level - 1) * 8}px` }" @click="selectOutlineHeading(heading.from)">{{ heading.text }}</button>
              </li>
              <li v-if="activeOutline.length === 0" class="workspace-derived__empty">No headings</li>
            </ul>
          </section>
          <section class="workspace-derived__section" data-testid="workspace-backlinks">
            <h3>Backlinks</h3>
            <ul>
              <li v-for="(edge, index) in activeBacklinks" :key="edge.id">
                <button type="button" @click="selectBacklink(edge)">{{ edge.sourcePath }} · {{ index + 1 }} ({{ edge.status }})</button>
              </li>
              <li v-if="activeBacklinks.length === 0" class="workspace-derived__empty">No backlinks</li>
            </ul>
          </section>
        </aside>
        <div v-if="activeWorkspaceTool === 'files'" data-testid="workspace-files-tool">
        <div class="workspace-create">
          <label for="workspace-entry-name">New entry</label>
          <input
            id="workspace-entry-name"
            v-model="workspaceNameInput"
            data-testid="workspace-entry-name"
            placeholder="name.md or folder"
            :disabled="workspaceBusy"
            @keydown.enter="createWorkspaceEntry('file')"
          />
          <p class="workspace-create-location">
            In <code>{{ workspaceCreationParentLabel }}</code>
          </p>
          <div class="workspace-create-actions">
            <button
              type="button"
              data-testid="workspace-create-file"
              :disabled="workspaceBusy"
              @click="createWorkspaceEntry('file')"
            >
              New file
            </button>
            <button
              type="button"
              data-testid="workspace-create-directory"
              :disabled="workspaceBusy"
              @click="createWorkspaceEntry('directory')"
            >
              New folder
            </button>
          </div>
        </div>
        <p v-if="workspaceError" class="workspace-error" data-testid="workspace-error">
          {{ workspaceError }}
        </p>
        <WorkspaceTreePanel
          :tree="workspaceTreeSnapshot.tree"
          :selected-path="selectedWorkspacePath"
          :busy="workspaceBusy"
          :reveal-path="workspaceRevealPath"
          :reveal-version="workspaceRevealVersion"
          @select="selectWorkspaceEntry"
          @open="openWorkspaceFile"
          @rename="renameWorkspaceEntry"
          @delete="deleteWorkspaceEntry"
          @copy="copyWorkspaceEntry"
          @contextmenu="openWorkspaceContextMenu"
          @move="moveWorkspaceEntry"
        />
        <div
          v-if="workspaceContextMenu"
          class="workspace-context-menu"
          data-testid="workspace-context-menu"
          :style="{ left: `${workspaceContextMenu.x}px`, top: `${workspaceContextMenu.y}px` }"
          @click.stop
          @contextmenu.prevent.stop
        >
          <button
            type="button"
            class="workspace-context-menu__item"
            data-testid="workspace-context-copy"
            @click="copyWorkspaceContextEntry"
          >
            Copy {{ workspaceName(workspaceContextMenu.path) }}
          </button>
        </div>
        <p class="workspace-note">
          拖动文件或文件夹到另一个文件夹即可移动；树状态来自 filesystem refresh。
        </p>
        </div>
        <section
          v-else-if="activeWorkspaceTool === 'git'"
          class="workspace-tool-placeholder"
          data-testid="workspace-git-tool"
          aria-label="git workspace tool"
        >
          <GitWorkbenchPanel
            :info="gitInfo"
            :statuses="gitStatuses"
            :diff="gitDiff"
            :history="gitHistory"
            :selected-path="gitSelectedPath"
            :layout="gitLayout"
            :loading="gitLoading"
            :error="gitError"
            @refresh="refreshGitWorkbench"
            @switch-branch="switchGitBranch"
            @select-path="selectGitPath"
            @toggle-layout="toggleGitLayout"
            @discard-file="discardGitFile"
            @discard-hunk="discardGitHunk"
          />
          <ul class="workspace-git-preview" aria-label="Changed files preview">
            <li
              v-if="activeDocument?.dirty"
              class="workspace-git-preview__current"
              data-testid="workspace-git-current-document"
            >
              <span>{{ activeDocument.path }}</span>
              <span>Unsaved</span>
            </li>
            <li v-else class="workspace-git-preview__empty">No current unsaved change.</li>
          </ul>
        </section>
        <section
          v-else
          class="workspace-tool-placeholder"
          :data-testid="`workspace-${activeWorkspaceTool}-tool`"
          :aria-label="`${activeWorkspaceTool} workspace tool`"
        >
          <SearchPanel
            :results="searchResults"
            :query="searchQuery?.text"
            :case-sensitive="searchQuery?.caseSensitive"
            :replace-text="searchReplacement"
            :error="searchError"
            @search="runWorkspaceSearch"
            @select="selectSearchMatch"
            @replace="replaceSearchMatch"
            @replace-all="replaceAllSearchMatches"
          />
          <section class="template-panel" data-testid="template-panel" aria-label="Templates">
            <div class="template-panel__header"><h3>Templates</h3><button type="button" data-testid="template-refresh" @click="refreshTemplates">Rescan</button></div>
            <select v-model="selectedTemplateId" data-testid="template-select">
              <option v-for="template in templateRecords" :key="template.id" :value="template.id">{{ template.name }} ({{ template.scope }})</option>
            </select>
            <input v-model="templateName" data-testid="template-name" placeholder="new-file.md" />
            <div class="template-panel__actions">
              <button type="button" data-testid="template-create" @click="createFromSelectedTemplate">New from template</button>
              <button type="button" data-testid="template-insert" @click="insertSelectedTemplate">Insert at selection</button>
            </div>
            <p v-if="templateError" class="workspace-error" data-testid="template-error">{{ templateError }}</p>
          </section>
        </section>
        </div>
        <div
          v-if="!sidebarCollapsed"
          class="workspace-resize-handle"
          data-testid="workspace-sidebar-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          :aria-valuemin="MIN_SIDEBAR_WIDTH"
          :aria-valuemax="MAX_SIDEBAR_WIDTH"
          :aria-valuenow="sidebarWidth"
          :aria-valuetext="`${sidebarWidth}px`"
          tabindex="0"
          @pointerdown="beginSidebarResize"
          @keydown="handleSidebarResizeKeydown"
        ></div>
      </aside>

      <section class="workspace-main" aria-label="Open documents" @focusin="handleMainFocusIn">
        <div class="workspace-tab-toolbar">
          <WorkspaceTabsPanel
            :tabs="documentTabViews"
            :active-document-id="tabSnapshot.activeDocumentId"
            @select="activateWorkspaceTab"
            @close="closeWorkspaceTab"
          />
          <div class="workspace-navigation" aria-label="Document navigation">
            <button
              type="button"
              data-testid="workspace-prev-tab"
              aria-label="Previous tab"
              :disabled="workspaceBusy || documentTabViews.length < 2"
              @click="navigateTabs(-1)"
            >
              ‹ Tab
            </button>
            <button
              type="button"
              data-testid="workspace-next-tab"
              aria-label="Next tab"
              :disabled="workspaceBusy || documentTabViews.length < 2"
              @click="navigateTabs(1)"
            >
              Tab ›
            </button>
            <span class="workspace-navigation__separator" aria-hidden="true"></span>
            <button
              type="button"
              data-testid="workspace-prev-file"
              aria-label="Previous file"
              :disabled="workspaceBusy || workspaceFiles.length < 2"
              @click="navigateFiles(-1)"
            >
              ↑ File
            </button>
            <button
              type="button"
              data-testid="workspace-next-file"
              aria-label="Next file"
              :disabled="workspaceBusy || workspaceFiles.length < 2"
              @click="navigateFiles(1)"
            >
              ↓ File
            </button>
          </div>
        </div>

        <section
          v-if="activeDocument"
          class="surface-grid"
          :class="{ 'surface-grid--annotations': annotationDrawerOpen }"
          aria-label="Document surfaces"
        >
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
                  class="persistence-action"
                  data-testid="workspace-save"
                  :disabled="persistenceBusy"
                  @click="saveActiveDocument"
                >
                  {{ persistenceBusy ? 'Saving…' : 'Save' }}
                </button>
                <label class="autosave-control"><span>Export</span><select v-model="exportFormat" data-testid="export-format"><option value="markdown">Markdown</option><option value="pdf">PDF</option><option value="docx">DOCX</option></select></label>
                <button type="button" class="persistence-action" data-testid="workspace-export" @click="exportActiveDocument">Export</button>
                <label class="autosave-control">
                  <span>Auto-save</span>
                  <select
                    aria-label="Auto-save delay"
                    :value="autoSaveDelay === null ? 'manual' : String(autoSaveDelay)"
                    :disabled="persistenceBusy"
                    @change="changeAutoSaveDelay"
                  >
                    <option value="manual">Manual</option>
                    <option value="500">0.5s</option>
                    <option value="1000">1s</option>
                    <option value="2000">2s</option>
                  </select>
                </label>
                <button
                  type="button"
                  class="persistence-action"
                  data-testid="check-external-file"
                  :disabled="persistenceBusy"
                  @click="checkActiveExternalFile"
                >
                  Check file
                </button>
                <button
                  v-if="activePersistenceState?.status === 'external-change' || activePersistenceState?.status === 'conflict'"
                  type="button"
                  class="persistence-action persistence-action--warning"
                  data-testid="reload-external-file"
                  :disabled="persistenceBusy"
                  @click="reloadActiveFromDisk"
                >
                  Reload external
                </button>
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
                <button
                  type="button"
                  class="persistence-action"
                  data-testid="annotation-add"
                  :disabled="!canAddAnnotation"
                  @click="addAnnotationFromSelection"
                >
                  Add annotation
                </button>
                <label class="autosave-control">
                  <input type="checkbox" data-testid="validation-strict" v-model="strictValidation" />
                  Strict validation
                </label>
              </div>
            </div>
            <div ref="editorHost" class="editor-host"></div>
            <p v-if="persistenceError" class="persistence-error" data-testid="persistence-error">
              {{ persistenceError }}
            </p>
            <p v-if="exportStatus" class="persistence-hint" data-testid="export-status">{{ exportStatus }}</p>
            <p v-if="referenceClipboardStatus" class="persistence-hint" data-testid="reference-clipboard-status">
              {{ referenceClipboardStatus }}
            </p>
            <p v-if="referenceClipboardError" class="persistence-error" data-testid="reference-clipboard-error">
              {{ referenceClipboardError }}
            </p>
            <p v-if="imagePasteStatus" class="persistence-hint" data-testid="image-paste-status">
              {{ imagePasteStatus }}
            </p>
            <p v-if="imageActionStatus" class="persistence-hint" data-testid="image-action-status">
              {{ imageActionStatus }}
            </p>
            <p v-if="activePersistenceState?.status === 'external-change' && !persistenceError" class="persistence-warning" data-testid="external-change-warning">
              文件已在编辑器外修改；保存前请重新加载或解决冲突。
            </p>
            <p v-if="activePersistenceState?.status === 'conflict' && !persistenceError" class="persistence-warning" data-testid="save-conflict-warning">
              本地修改与外部文件冲突；不会覆盖外部内容。
            </p>
            <ul v-if="validationIssues.length > 0" class="validation-issues" data-testid="validation-issues" aria-label="Validation issues">
              <li v-for="issue in validationIssues" :key="`${issue.ruleId}-${issue.from ?? 0}`" :data-severity="issue.severity">
                {{ issue.severity }} · {{ issue.message }}
              </li>
            </ul>
            <p
              v-if="activeBrokenReferenceCount > 0 || referenceHealthError"
              class="reference-health-warning"
              data-testid="reference-health"
            >
              {{ referenceHealthError ?? `${activeBrokenReferenceCount} broken reference${activeBrokenReferenceCount === 1 ? '' : 's'}; click a reference to reselect.` }}
            </p>
            <p class="projection-note">
              同一 CM6 document 在 Raw Source 与 Live Preview decorations/widgets 间切换；不创建第二个 textarea authority。试试 <code>Ctrl/Cmd+E</code>、<code>@</code>、<code>[[</code> 或 <code>![[</code>。
            </p>
            <footer class="document-stats" data-testid="document-stats" aria-label="Document statistics">
              {{ activeComposedStats.wordCount }} words · {{ activeComposedStats.referenceCount }} references · {{ activeComposedStats.embedCount }} embeds
              <span v-if="activeComposedStats.circularEmbeds.length > 0"> · {{ activeComposedStats.circularEmbeds.length }} circular embed{{ activeComposedStats.circularEmbeds.length === 1 ? '' : 's' }}</span>
            </footer>
          </section>

          <section
            v-if="splitDocument"
            class="editor-card editor-card--split"
            data-testid="workspace-split-pane"
            aria-label="Split Markdown editor projection"
          >
            <div class="surface-heading">
              <div>
                <h2>Split editor</h2>
                <span class="presentation-status" data-testid="workspace-split-path">
                  {{ splitDocument.path }}
                </span>
              </div>
              <button
                type="button"
                data-testid="workspace-split-close"
                aria-label="Close split editor"
                @click="closeSplitPane"
              >
                Close split
              </button>
            </div>
            <div ref="splitEditorHost" class="editor-host split-editor-host"></div>
            <p class="projection-note">
              分屏与其他编辑区共享同一 DocumentStore 内容和 revision。
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

          <AnnotationDrawer
            :annotations="annotationItems"
            :active-id="activeAnnotationId"
            :open="annotationDrawerOpen"
            :width="annotationDrawerWidth"
            @close="annotationDrawerOpen = false"
            @select="selectAnnotation"
            @reply="replyAnnotation"
            @resolve="resolveAnnotation"
            @resize="resizeAnnotationDrawer"
          />
        </section>

        <section v-else class="workspace-empty" data-testid="workspace-empty" aria-label="No open document">
          <h2>No open document</h2>
          <p>从左侧文件树选择 Markdown 文件以打开一个标签。</p>
        </section>
      </section>
    </div>
  </main>
  <div
    v-if="pendingWorkspaceDeletion"
    class="workspace-delete-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="workspace-delete-dialog-title"
    data-testid="workspace-delete-dialog"
    @click.stop
  >
    <div class="workspace-delete-dialog__surface">
      <h2 id="workspace-delete-dialog-title">Unsaved changes before delete</h2>
      <p>
        The selected entry contains unsaved Markdown. Choose how to continue;
        the entry is not deleted until the selected action succeeds.
      </p>
      <ul class="workspace-delete-dialog__documents">
        <li
          v-for="document in pendingWorkspaceDeletion.plan.documents"
          :key="document.documentId"
        >
          <strong>{{ document.path }}</strong>
          <span> ({{ document.dirty ? 'dirty' : 'clean' }})</span>
        </li>
      </ul>
      <div class="workspace-delete-dialog__actions">
        <button
          type="button"
          data-testid="workspace-delete-save"
          @click="chooseWorkspaceDeletionDecision('save')"
        >
          Save and delete
        </button>
        <button
          type="button"
          class="workspace-delete-dialog__discard"
          data-testid="workspace-delete-discard"
          @click="chooseWorkspaceDeletionDecision('discard')"
        >
          Discard and delete
        </button>
        <button
          type="button"
          class="workspace-delete-dialog__cancel"
          data-testid="workspace-delete-cancel"
          @click="chooseWorkspaceDeletionDecision('cancel')"
        >
          Cancel
        </button>
      </div>
    </div>
  </div>
  <ImagePreviewModal
    :image="imagePreview"
    @close="imagePreview = null"
    @copy="copyImage"
    @reveal="revealImageInWorkspace"
  />
</template>
