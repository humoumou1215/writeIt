// P0：A→B→C 最深层编辑，重载后保持三层结构和 A/B 内容。
const C=L.newChecker(); const task=await L.acquireTaskSpace('embed-nested-writeback'); await L.freshApp('http://localhost:5173/?backend=mock')
const K='milkdown-note-mock-fs-v2', set=(p,v)=>js(`(()=>{const d=JSON.parse(localStorage.getItem('${K}')||'{}');d.files[${L.J(p)}]=${L.J(v)};localStorage.setItem('${K}',JSON.stringify(d))})()`), disk=p=>js(`JSON.parse(localStorage.getItem('${K}')||'{}').files[${L.J(p)}]||''`)
const blocks=()=>js(`(()=>{const p=[...document.querySelectorAll('.editor-pane')].find(x=>x.getClientRects().length);return p?[...p.querySelectorAll('.ref-file-block')].map(x=>x.textContent||''):[]})()`)
const waitFor=async(f,ms=12000)=>{const t=Date.now();while(Date.now()-t<ms){if(await f())return true;await L.waitMs(120)}return false}
await set('deep/A.md','# A标记\n\n![[deep/B]]');await set('deep/B.md','# B标记\n\nB保留内容\n\n![[deep/C]]');await set('deep/C.md','# C标记\n\nC初始');await L.reloadApp(2500);await js(`window.__editorOpenPath('deep/A.md')`)
C.check('A/B/C 三层全部物化',await waitFor(async()=>{const b=await blocks();return b.length===2&&b.some(x=>x.includes('B保留内容'))&&b.some(x=>x.includes('C初始'))}))
await js(`window.__editorBlockAppend('deep/C','C最深层编辑',0)`);await L.press('Control+s')
C.check('最深层编辑即时显示',await waitFor(()=>js(`!![...document.querySelectorAll('.ref-file-block-content')].find(x=>(x.textContent||'').includes('C最深层编辑'))`)))
C.check('C 写回且 A/B 原文件未损坏', (await disk('deep/C.md')).includes('C最深层编辑')&&(await disk('deep/A.md')).includes('![[deep/B]]')&&(await disk('deep/B.md')).includes('B保留内容'))
await L.reloadApp(2500);await js(`window.__editorOpenPath('deep/A.md')`)
C.check('重载后 C 仍更新',await waitFor(()=>js(`!![...document.querySelectorAll('.ref-file-block-content')].find(x=>(x.textContent||'').includes('C最深层编辑'))`)))
C.check('重载后 B/A 标记与内容保留',(await disk('deep/A.md')).includes('![[deep/B]]')&&(await disk('deep/B.md')).includes('B保留内容'))
cliLog(C.summary());await completeTaskSpace(task.id,{keep:false});process.exit(C.fail?1:0)
