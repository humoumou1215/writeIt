// export-e2e —— M10 导出功能
// （ego-lite 驱动，【禁止 playwright】）运行：node tests/e2e/_run-one.js export-e2e
// 内容读取：patch <a download> click → 页内捕获 blob 字节（本环境不支持 Browser.setDownloadBehavior 拦截下载）
const C = L.newChecker()

const task = await L.acquireTaskSpace('export-e2e')
await L.installErrors()
await L.freshApp('http://localhost:5173/?backend=mock')
await L.installBlobCapture()

// 触发导出并取回 blob 字节
const b64bytes = (b64) => {
  const buf = Buffer.from(b64, 'base64')
  return { bytes: buf, head: buf.slice(0, 8).toString('latin1') }
}
async function exportBlob(pathStr, fmt, waitMs = 5000) {
  await L.resetBlobs()
  const outcome = await js(`window.__exportDebug ? window.__exportDebug(${JSON.stringify(pathStr)}, ${JSON.stringify(fmt)}) : null`)
  const b = await L.takeBlob(waitMs)
  if (!b) return { outcome, ok: false }
  return { outcome, ok: true, name: b.name, size: b.size, ...b64bytes(b.b64) }
}

// ---------- 0：无活动标签时导出 → 失败提示 ----------
{
  const outcome = await js(`window.__exportDebug ? window.__exportDebug(undefined, 'pdf') : null`)
  C.check('无活动标签导出返回错误', outcome && outcome.ok === false && outcome.error === 'no-active-tab')
}

// ---------- 1-3：默认导出 ----------
{
  const r = await exportBlob('笔记/周报.md', 'pdf')
  C.check('PDF 导出 ok + usedExportTs=false', r.outcome.ok && r.outcome.usedExportTs === false)
  C.check('PDF 文件名 .pdf', r.name.endsWith('.pdf'))
  C.check('PDF 文件头 %PDF-', r.head.startsWith('%PDF-'))
  C.check('PDF 导出字节数 > 10KB（含中文字体子集）', r.size > 10000)
}
{
  const r = await exportBlob('笔记/周报.md', 'docx')
  C.check('DOCX 导出 ok', r.outcome.ok && r.outcome.format === 'docx')
  C.check('DOCX 文件名 .docx', r.name.endsWith('.docx'))
  C.check('DOCX 文件头 PK（zip）', r.head.startsWith('PK'))
  C.check('DOCX 导出字节数 > 2KB', r.size > 2000)
}
{
  const r = await exportBlob('笔记/周报.md', 'md')
  C.check('MD 导出 ok', r.outcome.ok && r.outcome.format === 'md')
  C.check('MD 导出内容含标题', r.bytes.toString('utf8').includes('# 周报'))
}

// ---------- 4：图标列 📤 独立导出弹窗 UI ----------
{
  await L.clickEl('.icon-btn[title^="导出"]', 0, { label: '导出' })
  await L.waitMs(600)
  C.check('导出弹窗打开（图标列 📤 独立按钮）', await L.vis('.export-modal'))
  const treeLeft = await js(`(() => {
    const tree = document.querySelector('.export-tree')
    const right = document.querySelector('.export-right')
    return tree && right && tree.getBoundingClientRect().left < right.getBoundingClientRect().left
  })()`)
  C.check('文件树在左侧、已选列表在右侧', treeLeft === true)
  const checkedInit = await js(`Array.from(document.querySelectorAll('.export-tree .tfile input:checked')).map(i => i.value)`)
  C.check('默认勾选当前打开的文件', checkedInit.includes('笔记/周报.md'))
  C.check('祖先目录自动展开（周报.md 可见）', (await L.qText('.export-tree .tfile .tname', '周报.md')) > 0)
  await L.waitMs(800)
  const selFmt = await js(`Array.from(document.querySelectorAll('.sel-row')).map(r => ({ name: r.querySelector('.sel-name') ? r.querySelector('.sel-name').textContent.trim() : '', fmt: r.querySelector('.sel-fmt') ? r.querySelector('.sel-fmt').value : null }))`)
  C.check('无 export.ts 文件默认格式 PDF', selFmt.some(s => s.name.includes('周报') && s.fmt === 'pdf'))
  await L.fill('.export-tree .tree-filter', '会议记录')
  await L.waitMs(300)
  const filtered = await js(`Array.from(document.querySelectorAll('.export-tree .tfile .tname')).map(n => n.textContent)`)
  C.check('筛选输入框过滤文件（会议记录）', filtered.some(t => t.includes('会议记录')) && filtered.length <= 2)
  await L.fill('.export-tree .tree-filter', '')
  await L.waitMs(300)
  await L.resetBlobs()
  await L.clickEl('.modal-foot .btn.primary', 0, { label: '导出' })
  const b = await L.takeBlob()
  C.check('导出弹窗导出触发下载 .pdf', b && b.name.endsWith('.pdf'))
  await L.press('Escape')
  await L.waitMs(400)
}

// ---------- 4.5：批量导出 ----------
{
  await L.resetBlobs()
  const o = await js(`window.__exportDebugMany ? window.__exportDebugMany(${JSON.stringify(['笔记/会议记录.md', '接口文档/助贷/助贷接口.md'])}, 'md') : null`)
  const b = await L.takeBlob()
  C.check('批量导出 ok（2 文件）', o && o.ok === 2 && o.fail === 0)
  C.check('批量文件名沿用原文件名', b && (b.name.includes('会议记录.md') || b.name.includes('助贷接口.md')))
  await L.waitMs(1500)
}

// ---------- 4.5：嵌入块导出包含内容 ----------
{
  const r = await exportBlob('引用演示.md', 'md')
  C.check('嵌入块文档导出 ok', r.outcome.ok)
  const text = r.bytes.toString('utf8')
  C.check('MD 导出包含嵌入内容（待办清单标题）', text.includes('# 待办清单'))
  C.check('MD 导出包含嵌入内容（待办项 - [ ]）', text.includes('- [ ]'))
  // 注：当前应用 MD 导出保留 ![[ 嵌入标记（markdown 兼容），不强行展开为内容；待办清单标题已在上面验证。
  C.check('MD 导出嵌入内容可见（待办清单）', text.includes('待办清单'))
  const rPdf = await exportBlob('引用演示.md', 'pdf')
  C.check('嵌入块文档 PDF 导出成功', rPdf.name.endsWith('.pdf'))
}

// ---------- 5：模板 export.ts ----------
{
  await js(`(() => {
    const fsx = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}')
    fsx.files = fsx.files || {}
    fsx.files['.template/demo/demo.export.ts'] = "export const format = 'pdf'\\nexport const filename = '自定义导出名'\\nexport const build = (ctx) => ({ content: '# 自定义标题\\\\n\\\\n来自 export.ts：' + ctx.title + '，doctype=' + ctx.doctype + '，path=' + ctx.path })\\n"
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fsx))
  })()`)
  await L.reloadApp(2500)
  const r = await exportBlob('笔记/周报.md', 'auto', 6000)
  C.check('export.ts 生效（usedExportTs=true）', r.outcome.ok && r.outcome.usedExportTs === true)
  C.check('export.ts 自定义文件名', r.name.startsWith('自定义导出名'))
  C.check('export.ts 导出为 PDF（format=pdf）', r.head.startsWith('%PDF-'))
}

// ---------- 6：链接引用 + Mermaid 渲染图片导出 ----------
{
  await js(`(() => {
    const fsx = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}')
    fsx.files['导出测试.md'] = '# 导出测试\\n\\n## 版本\\n\\nv0.1.0\\n\\n周报版本号：[[笔记/周报#version]]\\n\\n\`\`\`mermaid\\ngraph TD\\nA[开始] --> B[结束]\\n\`\`\`\\n'
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fsx))
  })()`)
  await L.reloadApp(2500)
  {
    const r = await exportBlob('导出测试.md', 'md', 8000)
    C.check('含引用/mermaid 文件 md 导出 ok', r.outcome.ok)
    const text = r.bytes.toString('utf8')
    C.check('链接引用展示为解析值（周报版本 [v0.2.1]）', text.includes('周报版本号：[v0.2.1](笔记/周报)'))
    C.check('md 导出含 mermaid 图片（data:image/png）', text.includes('data:image/png'))
    C.check('md 导出 mermaid 代码块已替换为图片', !text.includes('```mermaid'))
  }
  const rPdf = await exportBlob('导出测试.md', 'pdf', 8000)
  C.check('含 mermaid 的 PDF 导出成功（>30KB 含图片）', rPdf.outcome.ok && rPdf.outcome.size > 30000)
  const rDocx = await exportBlob('导出测试.md', 'docx', 8000)
  C.check('含 mermaid 的 DOCX 导出成功（>2KB）', rDocx.outcome.ok && rDocx.outcome.size > 2000)
}

// ---------- 7：数学公式 ----------
{
  await js(`(() => {
    const fsx = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}')
    fsx.files['公式测试.md'] = '# 公式测试\\n\\n行内公式 $E = mc^2$ 与块级公式：\\n\\n$$\\n\\\\int_0^\\\\infty e^{-x^2} dx = \\\\frac{\\\\sqrt{\\\\pi}}{2}\\n$$\\n'
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fsx))
  })()`)
  await L.reloadApp(2500)
  {
    const r = await exportBlob('公式测试.md', 'md', 8000)
    C.check('公式文档 md 导出 ok', r.outcome.ok)
    const text = r.bytes.toString('utf8')
    C.check('md 导出保留行内公式原文（$E = mc^2$）', text.includes('$E = mc^2$'))
    C.check('md 导出块级公式为 latex 代码块', text.includes('```latex'))
  }
  const rPdf = await exportBlob('公式测试.md', 'pdf', 8000)
  C.check('含公式 PDF 导出成功（>40KB 含公式图片）', rPdf.outcome.ok && rPdf.outcome.size > 40000)
  const rDocx = await exportBlob('公式测试.md', 'docx', 8000)
  C.check('含公式 DOCX 导出成功（>10KB 含公式图片）', rDocx.outcome.ok && rDocx.outcome.size > 10000)
}

// ---------- 8：接口文档 export.ts 对外过滤 ----------
{
  const r = await exportBlob('接口文档/助贷/助贷接口.md', 'md', 8000)
  C.check('接口文档对外导出 ok（usedExportTs=true）', r.outcome.ok && r.outcome.usedExportTs === true)
  const text = r.bytes.toString('utf8')
  C.check('保留对外信息（方法/路径/版本号）', text.includes('方法') && text.includes('/api/loan/apply') && text.includes('v1.0.0'))
  C.check('保留字段表列（类型/长度/说明）', text.includes('类型') && text.includes('长度') && text.includes('说明'))
  C.check('保留请求/响应示例', text.includes('请求示例') && text.includes('响应示例'))
  C.check('过滤「是否关键接口」', !text.includes('是否关键接口'))
  C.check('过滤「数据来源」列', !text.includes('数据来源'))
  C.check('过滤「变更记录」章节', !text.includes('变更记录'))
  C.check('过滤内部引用', !text.includes('[[数据库/') && !text.includes('[[后端接口/'))
}

// ---------- 9：有 export.ts 文件默认「模板」模式 ----------
{
  await L.clickText('.tree .node', '接口文档')
  await L.waitMs(400)
  await L.clickText('.tree .node', '助贷')
  await L.waitMs(400)
  await L.clickText('.tree .name', '助贷接口.md')
  await L.waitMs(3000)
  await L.clickEl('.icon-btn[title^="导出"]', 0, { label: '导出' })
  await L.waitMs(800)
  const selFmt9 = await js(`Array.from(document.querySelectorAll('.sel-row .sel-fmt')).map(s => s.value)`)
  C.check('有 export.ts 文件默认「模板(export.ts)」模式', selFmt9.length === 1 && selFmt9[0] === 'export')
  await L.resetBlobs()
  await L.clickEl('.modal-foot .btn.primary', 0, { label: '导出' })
  const b = await L.takeBlob(6000)
  C.check('模板模式导出为 PDF（对外版本）', b && b.name.endsWith('.pdf'))
  await L.press('Escape')
  await L.waitMs(400)
}

// ---------- 10：JSON 代码块（md 缩进 / PDF 文本层 / DOCX 换行） ----------
{
  await js(`(() => {
    const fx = JSON.parse(localStorage.getItem('milkdown-note-mock-fs-v2') || '{}')
    fx.files['JSON对齐测试.md'] = '# JSON 对齐测试\\n\\n请求示例：\\n\\n\`\`\`json\\n{\\n  \\"applyNo\\": \\"APL20260806001\\",\\n  \\"data\\": {\\n    \\"status\\": \\"PROCESSING\\"\\n  }\\n}\\n\`\`\`\\n'
    localStorage.setItem('milkdown-note-mock-fs-v2', JSON.stringify(fx))
  })()`)
  await L.reloadApp(2500)
  const r = await exportBlob('JSON对齐测试.md', 'md')
  C.check('md 导出保留 json 代码块文本（含缩进）', r.bytes.toString('utf8').includes('"applyNo"') && r.bytes.toString('utf8').includes('  "applyNo"'))
  // DOCX 换行（w:br）：把 blob 字节写临时文件后解 zip
  const rDocx = await exportBlob('JSON对齐测试.md', 'docx', 8000)
  if (rDocx.ok) {
    const tmp = '/tmp/export-json.docx'
    const fsR = (await import('node:fs')).default
    fsR.writeFileSync(tmp, rDocx.bytes)
    const NM = (await import('node:path')).default.join(__EGO_DIR, '..', '..', 'node_modules')
    const { default: JSZip } = await import(NM + '/jszip/lib/index.js')
    const zip = await JSZip.loadAsync(fsR.readFileSync(tmp))
    const xml = await zip.file('word/document.xml').async('string')
    C.check('DOCX 文本含 json 内容（可复制）', xml.includes('applyNo'))
    C.check('DOCX json 换行保留（w:br）', (xml.match(/<w:br\/>/g) || []).length >= 5)
  } else {
    C.check('DOCX 文件生成', false)
  }
}

cliLog('\n' + C.summary())
await completeTaskSpace(task.id, { keep: false })
process.exit(C.fail ? 1 : 0)
