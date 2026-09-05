// 静态投影 + 全局共享编辑器复杂拓扑回归：
// A 嵌 B×2，B 嵌 C/D，A 另嵌 C；同时打开 B/C/D，编辑 C 后所有投影收敛且保存不污染 A/B/D。
const C = L.newChecker(); const task = await L.acquireTaskSpace('embed-shared-complex'); await L.freshApp('http://localhost:5173/?backend=mock')
const K='milkdown-note-mock-fs-v2', P='复杂共享/'
const set=(p,v)=>js(`(()=>{const d=JSON.parse(localStorage.getItem('${K}')||'{}');d.files[${L.J(p)}]=${L.J(v)};localStorage.setItem('${K}',JSON.stringify(d))})()`)
const disk=p=>js(`JSON.parse(localStorage.getItem('${K}')||'{}').files[${L.J(p)}]||''`)
const waitFor=async(f,ms=12000)=>{const t=Date.now();while(Date.now()-t<ms){if(await f())return true;await L.waitMs(120)}return false}
await set(P+'A.md','# A\n\n![[复杂共享/B]]\n\n![[复杂共享/B]]\n\n![[复杂共享/C]]')
await set(P+'B.md','# B\n\nB原文\n\n![[复杂共享/C]]\n\n![[复杂共享/D]]')
await set(P+'C.md','# C\n\nC原文')
await set(P+'D.md','# D\n\nD原文')
await L.reloadApp(2200); await js(`window.__editorOpenPath('${P}A.md')`)
C.check('复杂拓扑共 7 张投影卡',await waitFor(()=>js(`document.querySelectorAll('.editor-pane:not([style*="display: none"]) .ref-file-block').length===7`)))
C.check('B 两份、C 三份、D 两份',await js(`(()=>{const p=[...document.querySelectorAll('.editor-pane')].find(x=>x.getClientRects().length);const a=[...p.querySelectorAll('.ref-file-block-path')].map(x=>x.textContent);return a.filter(x=>x==='复杂共享/B').length===2&&a.filter(x=>x==='复杂共享/C').length===3&&a.filter(x=>x==='复杂共享/D').length===2})()`))
for(const f of ['B.md','C.md','D.md']){await js(`window.__editorOpenPath('${P}${f}')`);await L.waitMs(500)}
await js(`window.__editorOpenPath('${P}A.md')`);await L.waitMs(700)
const models=await js(`window.__docstoreInspect?.().models.filter(x=>x.realPath.startsWith('${P}')).map(x=>x.realPath)||[]`)
C.check('DocStore A/B/C/D 各一份模型',models.length===4&&new Set(models).size===4)
await L.clickEl(`.ref-file-block-content[data-embed-real-path="${P}C.md"]`,0);await L.type('C共享更新');await L.press('Control+s')
C.check('C 三处投影即时收敛',await waitFor(()=>js(`(()=>{const a=[...document.querySelectorAll('.editor-pane:not([style*="display: none"]) .ref-file-block-content[data-embed-real-path="${P}C.md"]')];return a.length===3&&a.every(x=>(x.textContent||'').includes('C共享更新'))})()`)))
C.check('C 保存成功',await waitFor(async()=>String(await disk(P+'C.md')).includes('C共享更新')))
const a=await disk(P+'A.md'),b=await disk(P+'B.md'),d=await disk(P+'D.md')
C.check('保存 C 未污染 A/B/D',((a.match(/!\[\[复杂共享\/B\]\]/g)||[]).length===2)&&a.includes('![[复杂共享/C]]')&&b.includes('B原文')&&b.includes('![[复杂共享/D]]')&&d.includes('D原文'))
await L.reloadApp(2200);await js(`window.__editorOpenPath('${P}A.md')`)
C.check('重载后复杂拓扑与 C 更新保持',await waitFor(()=>js(`document.querySelectorAll('.editor-pane:not([style*="display: none"]) .ref-file-block').length===7&&document.body.textContent.includes('C共享更新')`)))
const errs=await L.errors();cliLog(C.summary());await completeTaskSpace(task.id,{keep:false});process.exit(C.fail||errs.length?1:0)
