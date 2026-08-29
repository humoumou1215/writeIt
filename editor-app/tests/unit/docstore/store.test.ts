// ============================================================
// unit: docstore/store —— 影子模式语义（spec §9.1 M1）
//   record / markDiskSynced / dirty / subscribe / gc / snapshot / reconcile / inspect
// ============================================================
// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { EditorState } from '@milkdown/kit/prose/state'
import { createTestParser } from '../helpers/parser'
import { docStore, setDocStoreIo, setDocStorePipeline } from '../../../src/editor/docstore/store'
import type { DocPipeline } from '../../../src/editor/docstore/serialize'

let p: DocPipeline
let destroyParser: () => Promise<void>

beforeAll(async () => {
  const r = await createTestParser()
  p = { parse: r.parser, serialize: r.serialize }
  destroyParser = r.destroy
})
afterAll(async () => {
  await destroyParser?.()
})

const MD_B = '# B 文件\n\n内容 abc\n\n结束\n'

beforeEach(() => {
  docStore.resetForTest()
  setDocStorePipeline(p)
  setDocStoreIo({
    readFile: async () => MD_B,
    writeFile: async () => undefined,
  })
})

describe('docstore/store（M1 影子语义）', () => {
  it('load：磁盘 → 解析模型；rev/diskRev 基线一致', async () => {
    const m = await docStore.load('B.md')
    expect(m.doc).not.toBeNull()
    expect(m.diskHash).toBeDefined()
    expect(m.rev).toBe(m.diskRev)
    expect(m.blocks.length).toBeGreaterThan(0)
  })

  it('record：影子记录 registry 真相 → rev 递增、块摘要重建、脏判定', () => {
    const r1 = docStore.record('B.md', MD_B)
    expect(r1).toBe(2) // ensure 建模型 rev=1 → record rev=2
    expect(docStore.isDirty('B.md')).toBe(true) // rev 2 > diskRev 1
    expect(docStore.inspect().models[0].blocks.length).toBeGreaterThan(0)
    const r2 = docStore.record('B.md', MD_B + '追加一行\n')
    expect(r2).toBe(3)
  })

  it('record 后再 markDiskSynced → 不脏', () => {
    docStore.record('B.md', MD_B)
    expect(docStore.isDirty('B.md')).toBe(true)
    docStore.markDiskSynced('B.md', MD_B)
    expect(docStore.isDirty('B.md')).toBe(false)
  })

  it('apply：steps 事务应用（I1 唯一写入入口形态）；无误时 rev++', () => {
    docStore.record('B.md', MD_B)
    const m = docStore.getModel('B.md')!
    const doc = m.doc!
    const st = EditorState.create({ doc })
    const tr = st.tr
    tr.insertText('X', doc.content.size - 1)
    const before = m.rev
    const after = docStore.apply('B.md', tr.steps, { originKey: null, reason: 'user' })
    expect(after).toBe(before + 1)
    expect(docStore.isDirty('B.md')).toBe(true)
  })

  it('subscribe/unsubscribe + gc：订阅清零且不脏 → 模型释放', async () => {
    await docStore.load('B.md') // 脏=false（基线一致）
    const sub = docStore.subscribe('B.md', { kind: 'doc', tabId: 't1' })
    expect(docStore.inspect().models.filter((m) => m.realPath === 'B.md').length).toBe(1)
    sub.unsubscribe()
    // 不脏且无订阅 → gc 删除
    expect(docStore.inspect().models.filter((m) => m.realPath === 'B.md').length).toBe(0)
    // 脏态不回收
    docStore.record('B.md', MD_B)
    expect(docStore.inspect().models.filter((m) => m.realPath === 'B.md').length).toBe(1)
  })

  it('unregisterTab：清理该标签全部订阅', () => {
    docStore.record('B.md', MD_B) // 脏 → 防 gc
    docStore.subscribeShadow('B.md', { kind: 'doc', tabId: 't1' })
    docStore.subscribeShadow('B.md', { kind: 'block', tabId: 't1', blockId: 'b1' })
    docStore.subscribeShadow('B.md', { kind: 'block', tabId: 't2', blockId: 'b2' })
    docStore.unregisterTab('t1')
    const subs = docStore.inspect().models[0].subscribers
    expect(subs.length).toBe(1)
    expect(subs[0].tabId).toBe('t2')
  })

  it('snapshot：rev 定格；请求历史 rev（未保留）→ null（I4）', () => {
    docStore.record('B.md', MD_B)
    const snap = docStore.snapshot('B.md')
    expect(snap).not.toBeNull()
    expect(snap!.realPath).toBe('B.md')
    expect(snap!.dirty).toBe(true)
    expect(docStore.snapshot('B.md', 1)).toBeNull() // 历史未保留
  })

  it('reconcile：外部变更两分支（未脏→采用磁盘；脏→conflict）', async () => {
    const changed = '# B 文件（外部改过！）\n'
    const changed2 = '# B 文件（又外部改了！）\n'
    // 未脏：磁盘变了 → external-change + 模型重建
    await docStore.load('B.md')
    setDocStoreIo({ readFile: async () => changed, writeFile: async () => undefined })
    expect(await docStore.reconcile('B.md')).toBe('external-change')
    // 脏：磁盘再变 + 本地有未保存编辑 → conflict（M5 UI）
    docStore.record('B.md', MD_B + '本地编辑\n')
    setDocStoreIo({ readFile: async () => changed2, writeFile: async () => undefined })
    expect(await docStore.reconcile('B.md')).toBe('conflict')
  })

  it('inspect：模型/块/订阅者基线齐全（CLI docstore.inspect 数据源）', () => {
    docStore.record('B.md', MD_B)
    docStore.record('A.md', '# A\n\n![[B]]\n')
    docStore.subscribeShadow('B.md', { kind: 'block', tabId: 'a1', blockId: 'b2' })
    docStore.markDiskSynced('B.md', MD_B)
    const snap = docStore.inspect()
    expect(snap.mode).toBe('shadow')
    const b = snap.models.find((m) => m.realPath === 'B.md')!
    expect(b.dirty).toBe(false)
    expect(b.subscribers.length).toBe(1)
    expect(b.subscribers[0].kind).toBe('block')
    expect(b.subscribers[0].blockId).toBe('b2')
    expect(snap.models.find((m) => m.realPath === 'A.md')).toBeDefined()
  })

  it('assertConsistent：影子一致性断言（record 后 hash 对齐）', () => {
    docStore.record('B.md', MD_B)
    const r = docStore.assertConsistent('B.md')
    expect(r?.ok).toBe(true)
  })

  it('拦截器一致性：同一 steps 序列应用模型与独立 EditorState → canonical 相等（M2 不变量）', () => {
    const md = '# 标题\n\n正文 abc\n\n末尾\n'
    docStore.record('B.md', md)
    // 独立 EditorState：模拟编辑器视图侧
    const st = EditorState.create({ doc: p.parse(md)! })
    const tr = st.tr
    tr.insertText('X1', 6)
    tr.insertText('Y2', 2)
    // 模型侧：同一 steps
    docStore.apply('B.md', tr.steps, { originKey: null, reason: 'user' })
    const modelCanonical = p.serialize(docStore.getModel('B.md')!.doc!)
    const viewCanonical = p.serialize(tr.doc)
    expect(modelCanonical).toBe(viewCanonical)
  })

  // ---------- I3 一致性回归（修复：磁盘指纹统一 canonical 语义，不再拿 doc JSON hash 与磁盘 md 文本 hash 直接比较） ----------

  it('I3：load 后未编辑的模型一致且磁盘对齐（回归：此前恒误报不一致）', async () => {
    await docStore.load('B.md')
    const b = docStore.inspect().models.find((m) => m.realPath === 'B.md')!
    expect(b.rev).toBe(b.diskRev) // 干净基线
    expect(b.dirty).toBe(false)
    expect(b.consistent).toBe(true)
    expect(b.diskAligned).toBe(true)
    expect(docStore.assertConsistent('B.md')?.ok).toBe(true)
  })

  it('I3：外部变更重建后模型与磁盘对齐（consistent=true）', async () => {
    await docStore.load('B.md')
    setDocStoreIo({ readFile: async () => '# B 文件（外部改过！）\n\n正文 2\n', writeFile: async () => undefined })
    expect(await docStore.reconcile('B.md')).toBe('external-change')
    const b = docStore.inspect().models.find((m) => m.realPath === 'B.md')!
    expect(b.consistent).toBe(true)
    expect(b.diskAligned).toBe(true)
    expect(docStore.assertConsistent('B.md')?.ok).toBe(true)
  })

  it('I3：flush 落盘后模型一致且不脏', async () => {
    await docStore.load('B.md')
    docStore.record('B.md', MD_B + '追加行\n')
    expect(docStore.isDirty('B.md')).toBe(true)
    expect(docStore.inspect().models[0].consistent).toBe(true) // 脏态允许超前
    await docStore.flush('B.md')
    const b = docStore.inspect().models.find((m) => m.realPath === 'B.md')!
    expect(b.dirty).toBe(false)
    expect(b.consistent).toBe(true)
    expect(b.diskAligned).toBe(true)
  })

  it('I3：非 canonical 磁盘（- 列表/多余空行）load 后仍一致（canonical 语义归一）', async () => {
    const flaky = '# 标题\n\n- a\n- b\n\n\n'
    setDocStoreIo({ readFile: async () => flaky, writeFile: async () => undefined })
    await docStore.load('B.md')
    const b = docStore.inspect().models.find((m) => m.realPath === 'B.md')!
    expect(b.blocks.length).toBeGreaterThan(0) // 内容确实解析了
    expect(b.consistent).toBe(true)
    expect(b.diskAligned).toBe(true)
  })

  it('I3：markDiskSynced（写回/saveTab 直写）后模型一致', () => {
    docStore.record('B.md', MD_B)
    docStore.markDiskSynced('B.md', MD_B)
    const b = docStore.inspect().models.find((m) => m.realPath === 'B.md')!
    expect(b.dirty).toBe(false)
    expect(b.consistent).toBe(true)
  })
})