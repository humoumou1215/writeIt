import { markdownDiff, renderDiff } from './core/diff'
import { DocumentStore } from './core/document-store'
import { installDebugApi, SpikeController } from './editor/spike-controller'
import './style.css'

const fixtures: Record<string, string> = {
  'A.md': '# A\n\nHello **world**.\n\n| Name | Age | Note |\n| --- | ---: | :---: |\n| Alice | 20 | primary |\n| Bob | 30 | second |\n\n:::unknown-syntax\nhello\n:::\n\n```mermaid\ngraph LR\nA --> B\n```\n',
  'B.md': `# B\n\nThis is the host document.\n\n![[A.md]]\n`,
  'C.md': `# C\n\nNested projection test: B contains an editable projection of A.\n\n![[B.md]]\n`,
  'CycleA.md': `# Cycle A\n\n![[CycleB.md]]\n`,
  'CycleB.md': `# Cycle B\n\n![[CycleA.md]]\n`,
}

const store = new DocumentStore(fixtures)
const controller = new SpikeController(store)
installDebugApi(controller)

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('missing #app')

app.innerHTML = `
  <main class="shell">
    <header class="topbar">
      <div>
        <h1>WriteIt · CM6 Architecture Spike</h1>
        <p>Markdown-first · one DocumentStore · editable projections</p>
      </div>
      <div class="top-actions">
        <button id="undo">Undo</button>
        <button id="redo">Redo</button>
        <button id="save">Save active</button>
        <button id="force-stale">Force stale</button>
        <button id="lifecycle">Lifecycle 100x</button>
        <button id="stress">Run stress probes</button>
        <button id="open-visible-stress">Open visible stress fixtures</button>
        <button id="reopen-b">Close B.md</button>
      </div>
    </header>
    <nav id="tabs" class="tabs" aria-label="Documents"></nav>
    <section class="workspace">
      <div class="editors" id="editors"></div>
      <aside class="side-panel">
        <section class="panel-card">
          <h2>Source probe</h2>
          <p class="muted">Direct source edit must reparse the projection without changing other documents.</p>
          <textarea id="source-editor" spellcheck="false"></textarea>
          <button id="apply-source">Apply source to active document</button>
          <pre id="disk-state" class="small-output"></pre>
        </section>
        <section class="panel-card">
          <h2>Markdown diff</h2>
          <pre id="diff-output" class="diff-output"></pre>
          <pre id="lifecycle-output" class="small-output"></pre>
          <pre id="stress-output" class="small-output"></pre>
        </section>
        <section class="panel-card diagnostics-card">
          <h2>Diagnostics</h2>
          <div id="diagnostics"></div>
        </section>
      </aside>
    </section>
  </main>
`

let activeDocument = 'A.md'
let bClosed = false
const editorRoot = document.querySelector<HTMLDivElement>('#editors')!
const tabsRoot = document.querySelector<HTMLElement>('#tabs')!
const sourceEditor = document.querySelector<HTMLTextAreaElement>('#source-editor')!
const diagnostics = document.querySelector<HTMLDivElement>('#diagnostics')!
const diskState = document.querySelector<HTMLPreElement>('#disk-state')!
const diffOutput = document.querySelector<HTMLPreElement>('#diff-output')!
const lifecycleOutput = document.querySelector<HTMLPreElement>('#lifecycle-output')!
const stressOutput = document.querySelector<HTMLPreElement>('#stress-output')!
const editorMounts = new Map<string, HTMLDivElement>()
const tabNodes = new Map<string, HTMLButtonElement>()

function registerDocument(documentId: string): void {
  if (tabNodes.has(documentId)) return
  const tab = document.createElement('button')
  tab.className = 'tab'
  tab.dataset.document = documentId
  tab.textContent = documentId
  tab.addEventListener('click', () => selectDocument(documentId))
  tabsRoot.append(tab)
  tabNodes.set(documentId, tab)

  const mount = document.createElement('div')
  mount.className = 'editor-mount'
  mount.dataset.document = documentId
  editorRoot.append(mount)
  editorMounts.set(documentId, mount)
  controller.mountHost(documentId, mount)
}

for (const documentId of Object.keys(fixtures)) registerDocument(documentId)

document.querySelector<HTMLButtonElement>('#undo')!.addEventListener('click', () => controller.undo(activeDocument))
document.querySelector<HTMLButtonElement>('#redo')!.addEventListener('click', () => controller.redo(activeDocument))
document.querySelector<HTMLButtonElement>('#save')!.addEventListener('click', () => controller.save(activeDocument))
document.querySelector<HTMLButtonElement>('#force-stale')!.addEventListener('click', () => {
  const projection = controller.projectionIds(activeDocument)[0]
  if (projection) store.markStale(activeDocument, projection)
})
document.querySelector<HTMLButtonElement>('#lifecycle')!.addEventListener('click', () => {
  lifecycleOutput.textContent = JSON.stringify(controller.lifecycleProbe(activeDocument), null, 2)
})
document.querySelector<HTMLButtonElement>('#stress')!.addEventListener('click', () => {
  stressOutput.textContent = JSON.stringify(controller.stressProbe(), null, 2)
})
document.querySelector<HTMLButtonElement>('#open-visible-stress')!.addEventListener('click', () => {
  const largeDocumentId = 'visible-10k.md'
  const tableDocumentId = 'visible-table-100x20.md'
  if (!store.has(largeDocumentId)) store.seed(largeDocumentId, makeLargeDocument(10_000))
  if (!store.has(tableDocumentId)) store.seed(tableDocumentId, makeStressTable(100, 20))
  registerDocument(largeDocumentId)
  registerDocument(tableDocumentId)
  selectDocument(tableDocumentId)
})
document.querySelector<HTMLButtonElement>('#reopen-b')!.addEventListener('click', (event) => {
  const button = event.currentTarget as HTMLButtonElement
  const mount = editorMounts.get('B.md')!
  if (!bClosed) {
    controller.destroyView('view-B.md-tab')
    mount.replaceChildren()
    bClosed = true
    button.textContent = 'Reopen B.md'
    if (activeDocument === 'B.md') selectDocument('A.md')
  } else {
    controller.mountHost('B.md', mount)
    bClosed = false
    button.textContent = 'Close B.md'
  }
})
document.querySelector<HTMLButtonElement>('#apply-source')!.addEventListener('click', () => {
  controller.applySource(activeDocument, sourceEditor.value)
})

function selectDocument(documentId: string): void {
  activeDocument = documentId
  for (const tab of tabsRoot.querySelectorAll<HTMLButtonElement>('.tab')) tab.classList.toggle('active', tab.dataset.document === documentId)
  for (const [id, mount] of editorMounts) mount.classList.toggle('active', id === documentId)
  refresh()
}

function refresh(): void {
  const state = store.get(activeDocument)
  if (document.activeElement !== sourceEditor) sourceEditor.value = state.markdown
  const disk = store.diskContents()
  diskState.textContent = JSON.stringify(disk, null, 2)
  diffOutput.innerHTML = renderDiff(markdownDiff(disk[activeDocument], state.markdown))
  const snapshot = store.diagnostics()
  diagnostics.innerHTML = `
    <div class="diag-block"><strong>Documents</strong>${snapshot.documents.map((doc) => `<div class="diag-row"><span>${doc.id}</span><span>rev=${doc.revision} ${doc.dirty ? 'DIRTY' : 'clean'}</span></div>`).join('')}</div>
    <div class="diag-block"><strong>Views / projections</strong>${snapshot.projections.map((view) => `<div class="diag-row ${view.stale ? 'stale' : ''}"><span>${view.key}</span><span>${view.documentId} rev=${view.revision}${view.stale ? ' · STALE' : ''}</span></div>`).join('')}</div>
    <details><summary>Last events</summary><pre>${snapshot.events.slice(-16).join('\n')}</pre></details>
  `
}

function makeLargeDocument(lines: number): string {
  return Array.from({ length: lines }, (_, index) => `line ${index} — scroll and type here`).join('\n')
}

function makeStressTable(rows: number, columns: number): string {
  const header = `| ${Array.from({ length: columns }, (_, index) => `H${index}`).join(' | ')} |`
  const divider = `| ${Array.from({ length: columns }, () => '---').join(' | ')} |`
  const body = Array.from({ length: rows }, (_, row) => `| ${Array.from({ length: columns }, (_, column) => `${row}-${column}`).join(' | ')} |`)
  return [header, divider, ...body].join('\n') + '\n'
}

selectDocument(activeDocument)
setInterval(refresh, 250)
