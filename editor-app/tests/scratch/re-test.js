const OPEN_RE = /^<mark\s+data-note=(["'])((?:(?!\1).)*)\1\s*>$/i
const cases = [
  `<mark data-note='[{"a":"我","c":"评论"}]'>文本</mark>`,
  `<mark data-note="[{&quot;a&quot;:&quot;旧&quot;,&quot;c&quot;:&quot;评论&quot;}]">文本</mark>`,
  `<mark data-note='[{"c":"含&#39;单引号&#39; 与 \\"双引号\\""}]'>文本</mark>`,
  `<mark data-note='[{"c":"a > b"}]'>文本</mark>`,
  `<mark data-note='简单值'>文本</mark>`,
]
for (const s of cases) {
  const m = OPEN_RE.exec(s)
  console.log(m ? 'OK  note=' + JSON.stringify(m[2]).slice(0, 70) : 'FAIL ' + s.slice(0, 70))
}
