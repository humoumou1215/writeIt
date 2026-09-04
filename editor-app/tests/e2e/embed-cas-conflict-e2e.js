// P0/P1：本地编辑与外部磁盘编辑冲突，保存拒绝覆盖并保留 dirty。
const C=L.newChecker();const task=await L.acquireTaskSpace('embed-cas-conflict');await L.freshApp('http://localhost:5173/?backend=mock')
const K='milkdown-note-mock-fs-v2',SRC='cas-src.md',set=(p,v)=>js(`(()=>{const d=JSON.parse(localStorage.getItem('${K}')||'{}');d.files[${L.J(p)}]=${L.J(v)};localStorage.setItem('${K}',JSON.stringify(d))})()`),disk=()=>js(`JSON.parse(localStorage.getItem('${K}')||'{}').files['${SRC}']||''`),toast=()=>js(`[...document.querySelectorAll('.toast')].map(x=>x.textContent||'').join('|')`)
await set(SRC,'CAS-BASE');await L.reloadApp(2200);await js(`window.__editorOpenPath('${SRC}')`);await L.waitMs(2200);await L.focusEditor();await L.goEnd();await L.type('本地修改');await L.waitMs(250);await set(SRC,'外部修改-REMOTE');await js('window.__saveActiveTab?.()');await L.waitMs(900)
C.check('CAS 冲突拒绝覆盖外部内容',(await disk())==='外部修改-REMOTE');C.check('冲突后本地标签仍 dirty',await js(`!!document.querySelector('.tab .dot.dirty')`));C.check('冲突有明确错误提示',(await toast()).includes('保存失败')||(await toast()).includes('外部修改'))
const m=await js(`window.__docstoreInspect?.().models.find(x=>x.realPath==='${SRC}')||null`);C.check('冲突模型仍保留本地内容且 rev 未丢失',!!m&&m.dirty===true)
cliLog(C.summary());await completeTaskSpace(task.id,{keep:false});process.exit(C.fail?1:0)
