// 判定矩阵单测（设计文档 §5 是主判；本文件直接覆盖判定矩阵，双视图共用）
// 被测模块：src/editor/ref/embed-chain.ts（esbuild 编译产物 .cache/embed-chain.cjs）
const assert = require('node:assert/strict')
const {
  MAX_EMBED_DEPTH,
  classifyEmbed,
  chainKey,
  buildCollapseChain,
} = require('./.cache/embed-chain.cjs')

const ok = (anc, self) => {
  const v = classifyEmbed(anc, self)
  assert.equal(v.kind, 'ok', `期望 ok: ${JSON.stringify({ anc, self })} → ${JSON.stringify(v)}`)
}
const cycle = (anc, self) => {
  const v = classifyEmbed(anc, self)
  assert.equal(v.kind, 'cycle', `期望 cycle: ${JSON.stringify({ anc, self })} → ${JSON.stringify(v)}`)
}
const deep = (anc, self) => {
  const v = classifyEmbed(anc, self)
  assert.equal(v.kind, 'too-deep', `期望 too-deep: ${JSON.stringify({ anc, self })} → ${JSON.stringify(v)}`)
}

// ---------- 常量与深度语义 ----------
assert.equal(MAX_EMBED_DEPTH, 10, 'MAX_EMBED_DEPTH 按用户裁决 = 10')

// ---------- 环：自嵌 / 间接环 / 命中祖先 ----------
ok(['自嵌/S.md'], '兄弟/B.md') // 宿主嵌入一个不同文件：正常
cycle(['自嵌/S.md'], '自嵌/S.md') // A 嵌 A（自嵌）：内层 A 折叠
cycle(['环/A.md', '环/B.md'], '环/A.md') // A 嵌 B 嵌 A：内层 A 折叠（链根含宿主的用例）
cycle(['环/A.md', '环/B.md', '环/C.md'], '环/B.md') // A 嵌 B 嵌 C 嵌 B：内层 B 折叠（非宿主命中）
cycle([...Array(11).fill('深/层x')].map((_, i) => `深/层${i}`), '深/层5') // 深链中命中祖先：环优先于深度
cycle(['a.md'], 'a.MD') // 大小写不敏感文件系统：同一文件判环（chainKey 归一）

// ---------- 兄弟重复 / 菱形：不是环 ----------
ok(['A.md', 'A.md'], 'B.md') // A 嵌 B ×2：两处 B 均正常（ancestors 含同路径两次不构成环）
ok(['A.md', 'B.md'], 'C.md') // A 嵌 B、B 嵌…：C 非祖先
ok(['A.md', 'B.md', 'C.md'], 'D.md') // 菱形：D 不在祖先链
ok(['A.md', 'B.md'], 'C.md') // 菱形 A→B→C 与 A→C 中，C 的 ancestors=[A,B]，不含 C

// ---------- 深度边界：第 10 层渲染，第 11 层折叠 ----------
// 第 N 层块的 ancestors 长度 = N（宿主 + N-1 个父嵌入）：
//   ancestors = [host, 层1, …, 层(N-1)]
// 第 10 层：ancestors 长度 10 → depth 9 → ok
ok(
  ['host.md', '深/层1.md', '深/层2.md', '深/层3.md', '深/层4.md', '深/层5.md', '深/层6.md', '深/层7.md', '深/层8.md'],
  '深/层9.md'
)
// 第 11 层：ancestors 长度 11（host + 层1..层10 十个父嵌入）→ depth 10 → too-deep
deep(
  ['host.md', '深/层1.md', '深/层2.md', '深/层3.md', '深/层4.md', '深/层5.md', '深/层6.md', '深/层7.md', '深/层8.md', '深/层9.md', '深/层10.md'],
  '深/层11.md'
)

// ---------- 别名写法规格：解析同 realPath → 正确判环 ----------
// 别名写法 ![[B]] / ![[folder/B.md]] 解析到同一 realPath → 环判定一致（探测归一的单测代理）
cycle(['A.md', 'folder/B.md'], 'folder/B.md') // 同一 realPath 在祖先链中 → 环
// 互为前缀的两个文件是两个文件：精确比较，互不误判（M16 路径匹配事故教训）
ok(['数据/需求.md'], '数据/需求表.md')
ok(['数据/需求表.md'], '数据/需求.md')

// ---------- chainKey 归一（精确相等之上的规范化；严禁前缀匹配） ----------
assert.equal(chainKey('数据/需求.md'), '数据/需求.md')
assert.equal(chainKey('数据\\需求.md'), '数据/需求.md') // 反斜杠归一
assert.equal(chainKey('A/B.C.md'), 'a/b.c.md') // 大小写折叠
assert.notEqual(chainKey('数据/需求.md'), chainKey('数据/需求表.md')) // 前缀不误判
assert.equal(chainKey('NOTES.MD'), 'notes.md') // 大小写折叠

// ---------- buildCollapseChain：链路含结尾本块 ----------
assert.deepEqual(buildCollapseChain(['A.md', 'B.md'], 'A.md'), ['A.md', 'B.md', 'A.md'])

module.exports = {} // 供 runner 的 require 一致性