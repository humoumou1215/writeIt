// P0：打开后外部改盘，再保存；必须拒绝覆盖并提示冲突。
const C=L.newChecker();const task=await L.acquireTaskSpace('embed-external-change');await L.freshApp('http://localhost:5173/?backend=mock')
const K='milkdown-note-mock-fs-v2',S='external-src.md',set=(p,v)=>js(`(()=>{const d=JSON.parse(localStorage.getItem('${K}')||'{}');d.files[${L.J(p)}]=${L.J(v)};localStorage.setItem('${K}',JSON.stringify(d))})()`),disk=()=>js(`JSON.parse(localStorage.getItem('${K}')||'{}').files['${S}']||''`),toast=()=>js(`[...document.querySelectorAll('.toast')].map(x=>x.textContent||'').join('|')`)
await set(S,'外部基线');await L.reloadApp(2200);await js(`window.__editorOpenPath('${S}')`);await L.waitMs(2200);await L.focusEditor();await L.goEnd();await L.type('本地未保存');await set(S,'磁盘外部新版本');await js('window.__saveActiveTab?.()');await L.waitMs(800)
C.check('外部变更后保存不覆盖磁盘',(await disk())==='磁盘外部新版本');C.check('外部变更提示冲突或保存失败',(await toast()).includes('外部修改')||(await toast()).includes('保存失败'));C.check('外部变更后本地编辑仍 dirty',await js(`!!document.querySelector('.tab .dot.dirty')`))
cliLog(C.summary());await completeTaskSpace(task.id,{keep:false});process.exit(C.fail?1:0)
