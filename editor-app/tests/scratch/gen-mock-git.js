// 生成 Git 演示仓库的真实 mock 数据（M14）
// 在 /tmp 建真实 git 仓库 → 跑真实 git diff → 输出 mock.ts 可用的静态 TS 数据
// 用法：node tests/scratch/gen-mock-git.js > /tmp/mock-git-data.ts
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const DIR = '/tmp/writeit-git-demo'
const sh = (cmd, cwd = DIR) => execSync(cmd, { cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })

// ---------- 文件版本设计 ----------
// 提交1（初始骨架）→ 提交2（HEAD，优化）→ 工作区改动（未提交）
// feature 分支：README 换 feature 版本

const README_V1 = `# 演示笔记

本仓库演示 Git 工作台的全部效果：

- 打开工作区文件查看未提交改动
- 切「文本」模式查看分栏与词级高亮

## 需求清单

- 需求一：登录模块
- 需求二：支付模块

## 流程图

\`\`\`mermaid
graph TD
  A[开始] --> B{是否有余额}
  B -- 是 --> C[支付成功]
  B -- 否 --> D[余额不足]
  D --> E[引导充值]
\`\`\`

## 嵌入笔记

![[Git演示/笔记/会议纪要.md]]
`

const README_V2 = `# 演示笔记

> 旧版本说明：这段提醒只存在于 HEAD，工作区版本中已删除（展示纯删除块的红底划线效果）。

本仓库演示 Git 工作台的全部效果：

- 打开工作区文件查看未提交改动（默认渲染模式：mermaid 图/嵌入卡片真实对比）
- 切「文本」模式查看分栏与词级高亮
- 历史区点提交查看 commit diff；Shift+点击两提交做范围对比
- 工具栏「还原…」可还原整文件或单段改动

## 需求清单

- 需求一：登录模块
- 需求二：支付模块
- 需求三：报表模块

## 流程图

\`\`\`mermaid
graph TD
  A[开始] --> B{是否有余额}
  B -- 是 --> C[支付成功]
  B -- 否 --> D[余额不足]
  D --> E[引导充值]
  G[余额查询] --> B
\`\`\`

## 嵌入笔记

![[Git演示/笔记/会议纪要.md]]

## 数据表

![[Git演示/数据/需求表.md]]

## 相关引用

- 参见 [[Git演示/笔记/会议纪要.md#议题]]
- 参见 [[README#需求清单]]
`

const README_WORKTREE = `# 演示笔记

本仓库演示 Git 工作台的全部效果：

- 打开工作区文件查看未提交改动（默认渲染模式：mermaid 图/嵌入卡片真实对比 + 批注连线）
- 切「文本」模式查看分栏与**词级**高亮
- 历史区点提交查看 commit diff；Shift+点击两提交做范围对比
- 工具栏「还原…」可还原整文件或单段改动

## 需求清单

- 需求一：登录与权限模块
- 需求二：支付与退款模块
- 需求三：报表与统计模块
- 需求四：消息通知模块

## 流程图

\`\`\`mermaid
graph TD
  A[开始] --> B{是否有余额}
  B -- 是 --> C[授信成功]
  B -- 否 --> D[余额不足]
  D --> E[引导充值]
  F[额度查询] --> D
\`\`\`

## 嵌入笔记

![[Git演示/笔记/会议纪要.md]]

## 数据表

![[Git演示/数据/需求表.md]]

## 相关引用

- 参见 [[Git演示/笔记/会议纪要.md#议题]]
- 参见 [[README#需求清单]]
`

const MEETING_V1 = `# 会议记录

## 议题

1. 支付流程评审

> 备注：本期只做支付，不做退款。
`

const MEETING_V2 = `# 会议记录

## 议题

1. 支付流程评审
2. 报表口径确认

> 备注：本期只做支付，不做退款。
`

const MEETING_WORKTREE = `# 会议记录

## 议题

1. 支付流程评审
2. 报表口径确认
3. 消息通知需求收集

> 备注：本期只做支付，退款下期排期。
`

const TABLE_V1 = `# 需求表

| 模块 | 状态 | 优先级 |
| --- | --- | --- |
| 登录 | 开发中 | P1 |
| 支付 | 待评审 | P2 |
`

const TABLE_V2 = `# 需求表

| 模块 | 状态 | 优先级 |
| --- | --- | --- |
| 登录 | 开发中 | P1 |
| 支付 | 待评审 | P2 |
| 报表 | 未开始 | P3 |
`

const TABLE_WORKTREE = `# 需求表

| 模块 | 状态 | 优先级 |
| --- | --- | --- |
| 登录 | 开发中 | P1 |
| 支付 | 评审中 | P2 |
| 报表 | 未开始 | P3 |
| 消息通知 | 未开始 | P2 |
`

const FEATURE_README = `# 演示笔记（feature 分支版本）

功能分支：仅演示切换分支后内容与 diff 状态变化。
`

// ---------- 建仓库 ----------
fs.rmSync(DIR, { recursive: true, force: true })
fs.mkdirSync(DIR, { recursive: true })
fs.mkdirSync(path.join(DIR, '笔记'), { recursive: true })
fs.mkdirSync(path.join(DIR, '数据'), { recursive: true })
sh('git init -q -b main')
sh('git config user.email pi@writeit.dev')
sh('git config user.name pi')
const now = Math.floor(Date.now() / 1000)

// 提交1：初始骨架
fs.writeFileSync(path.join(DIR, 'README.md'), README_V1)
fs.writeFileSync(path.join(DIR, '笔记/会议纪要.md'), MEETING_V1)
fs.writeFileSync(path.join(DIR, '数据/需求表.md'), TABLE_V1)
sh(`GIT_AUTHOR_NAME=Bob GIT_AUTHOR_EMAIL=bob@x GIT_AUTHOR_DATE=@${now - 86400 * 5} GIT_COMMITTER_NAME=Bob GIT_COMMITTER_EMAIL=bob@x GIT_COMMITTER_DATE=@${now - 86400 * 5} git add -A && GIT_AUTHOR_NAME=Bob GIT_AUTHOR_EMAIL=bob@x GIT_AUTHOR_DATE=@${now - 86400 * 5} GIT_COMMITTER_NAME=Bob GIT_COMMITTER_EMAIL=bob@x GIT_COMMITTER_DATE=@${now - 86400 * 5} git commit -qm "初始提交：演示笔记骨架"`)

// 提交2：HEAD（优化）
fs.writeFileSync(path.join(DIR, 'README.md'), README_V2)
fs.writeFileSync(path.join(DIR, '笔记/会议纪要.md'), MEETING_V2)
fs.writeFileSync(path.join(DIR, '数据/需求表.md'), TABLE_V2)
sh(`GIT_AUTHOR_NAME=Alice GIT_AUTHOR_EMAIL=alice@x GIT_AUTHOR_DATE=@${now - 86400 * 2} GIT_COMMITTER_NAME=Alice GIT_COMMITTER_EMAIL=alice@x GIT_COMMITTER_DATE=@${now - 86400 * 2} git add -A && GIT_AUTHOR_NAME=Alice GIT_AUTHOR_EMAIL=alice@x GIT_AUTHOR_DATE=@${now - 86400 * 2} GIT_COMMITTER_NAME=Alice GIT_COMMITTER_EMAIL=alice@x GIT_COMMITTER_DATE=@${now - 86400 * 2} git commit -qm "优化流程图与需求清单"`)

// feature 分支：README 换版本后 commit
sh('git branch feature/图表优化')
sh('git checkout -q feature/图表优化')
fs.writeFileSync(path.join(DIR, 'README.md'), FEATURE_README)
sh('git add -A && git commit -qm "feature：图表优化演示"')
sh('git checkout -q main')

// 工作区改动
fs.writeFileSync(path.join(DIR, 'README.md'), README_WORKTREE)
fs.writeFileSync(path.join(DIR, '笔记/会议纪要.md'), MEETING_WORKTREE)
fs.writeFileSync(path.join(DIR, '数据/需求表.md'), TABLE_WORKTREE)

// ---------- 收集真实数据 ----------
const hashes = sh('git log --format=%H').trim().split('\n')
const logLines = sh('git log --format=%H%x1f%an%x1f%at%x1f%s').trim().split('\n')
const statusBuf = execSync('git status --porcelain=v1 -z', { cwd: DIR, encoding: 'buffer' })
const status = []
{
  let i = 0
  while (i < statusBuf.length) {
    const end = statusBuf.indexOf(0, i)
    const rec = statusBuf.slice(i, end === -1 ? statusBuf.length : end).toString('utf8')
    i = end + 1
    if (rec.length < 3) continue
    const code = rec.slice(0, 2).trim()
    status.push({ code, path: rec.slice(3) })
  }
}
const numstat = sh('git -c core.quotepath=false diff --numstat HEAD').trim().split('\n')
const branchList = sh("git branch --format='%(refname:short)%1f%(HEAD)%1f%(upstream:short)'").trim().split('\n')

// ---------- unified diff 解析（照搬 Rust parse_unified_diff） ----------
function parseHunkHeader(line) {
  const rest = line.replace(/^@@/, '').replace(/@@$/, '').trim()
  const parts = rest.split(/\s+/)
  const old = parts[0].replace(/^-/, '')
  const neu = parts[1].replace(/^\+/, '')
  const oldParts = old.split(',')
  const oldStart = parseInt(oldParts[0], 10)
  const oldLines = oldParts[1] ? parseInt(oldParts[1], 10) : 1
  const newParts = neu.split(',')
  const newStart = parseInt(newParts[0], 10)
  const newLines = newParts[1] ? parseInt(newParts[1], 10) : 1
  return { oldStart, oldLines, newStart, newLines }
}

function parseWordGroups(text) {
  const groups = []
  let cur = []
  for (const line of text.split('\n')) {
    if (line === '~') { groups.push(cur); cur = []; continue }
    if (!line || line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('@@')) continue
    const kind = line[0] === '+' ? 'add' : line[0] === '-' ? 'del' : 'ctx'
    cur.push({ kind, text: line.slice(1) })
  }
  if (cur.length) groups.push(cur)
  return groups
}

function groupsToRows(groups) {
  const rows = []
  for (const g of groups) {
    const hasDel = g.some((w) => w.kind === 'del')
    const hasAdd = g.some((w) => w.kind === 'add')
    const common = (k) => g.filter((w) => w.kind === 'ctx' || w.kind === k).map((w) => ({ ...w }))
    if (hasDel && hasAdd) { rows.push(['del', common('del')]); rows.push(['add', common('add')]) }
    else if (hasDel) rows.push(['del', common('del')])
    else if (hasAdd) rows.push(['add', common('add')])
    else if (g.length) rows.push(['ctx', g])
  }
  return rows
}

function parseUnifiedDiff(text, wordGroups) {
  const wordRows = wordGroups ? groupsToRows(wordGroups).map(([k, toks]) => [k, toks.map((w) => w.text).join(''), toks]) : []
  const hunks = []
  let added = 0, deleted = 0, cur = null
  for (const line of text.split('\n')) {
    if (line.startsWith('@@')) {
      if (cur) hunks.push(cur)
      cur = line.includes('@@', 2) ? parseHunkHeader(line) : null
      if (cur) cur.lines = []
    } else if (cur) {
      let kind, content
      if (line.startsWith('+')) { kind = 'add'; content = line.slice(1) }
      else if (line.startsWith('-')) { kind = 'del'; content = line.slice(1) }
      else if (line.startsWith(' ')) { kind = 'ctx'; content = line.slice(1) }
      else continue
      if (kind === 'add') added++
      else if (kind === 'del') deleted++
      let words = null
      const idx = wordRows.findIndex(([k, t]) => k === kind && t === content)
      if (idx >= 0) words = wordRows.splice(idx, 1)[0][2]
      cur.lines.push({ kind, text: content, words })
    }
  }
  if (cur) hunks.push(cur)
  return { hunks, added, deleted }
}

function gitDiff(file, from, to) {
  const args = from ? `git diff --no-color -U3 ${from} ${to} --` : `git diff --no-color -U3 HEAD --`
  const u = sh(`${args} '${file}'`)
  const w = sh(`git diff --word-diff=porcelain --no-color -U3 ${from ? `${from} ${to}` : 'HEAD'} -- '${file}'`)
  return parseUnifiedDiff(u, parseWordGroups(w))
}

// ---------- 输出 TS ----------
const lines = []
lines.push('// ===== 自动生成：M14 真实 git diff 演示数据（tests/scratch/gen-mock-git.js） =====')
lines.push('// 生成时间 ' + new Date().toISOString())

const toTs = (s) => '`' + s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${') + '`'
const toLines = (s) => toTs(s.replace(/\n$/, ''))

lines.push('')
lines.push('// ---------- 版本内容 ----------')
lines.push(`const README_V1 = ${toTs(README_V1)}`)
lines.push(`const README_V2 = ${toTs(README_V2)}`)
lines.push(`const README_WORKTREE = ${toTs(README_WORKTREE)}`)
lines.push(`const MEETING_V1 = ${toTs(MEETING_V1)}`)
lines.push(`const MEETING_V2 = ${toTs(MEETING_V2)}`)
lines.push(`const MEETING_WORKTREE = ${toTs(MEETING_WORKTREE)}`)
lines.push(`const TABLE_V1 = ${toTs(TABLE_V1)}`)
lines.push(`const TABLE_V2 = ${toTs(TABLE_V2)}`)
lines.push(`const TABLE_WORKTREE = ${toTs(TABLE_WORKTREE)}`)
lines.push(`const FEATURE_README = ${toTs(FEATURE_README)}`)

// hunks：工作区 vs HEAD
const wHunks = gitDiff('README.md')
lines.push('')
lines.push('// ---------- 工作区 vs HEAD hunks ----------')
lines.push(`const README_HUNKS: GitDiffResult['hunks'] = ${JSON.stringify(wHunks.hunks, null, 2).replace(/"(\w+)":/g, '$1:')}`)
lines.push(`// README 工作区 vs HEAD: +${wHunks.added} -${wHunks.deleted}`)
const mHunks = gitDiff('笔记/会议纪要.md')
lines.push(`const MEETING_HUNKS: GitDiffResult['hunks'] = ${JSON.stringify(mHunks.hunks, null, 2).replace(/"(\w+)":/g, '$1:')}`)
lines.push(`// 会议纪要: +${mHunks.added} -${mHunks.deleted}`)
const tHunks = gitDiff('数据/需求表.md')
lines.push(`const TABLE_HUNKS: GitDiffResult['hunks'] = ${JSON.stringify(tHunks.hunks, null, 2).replace(/"(\w+)":/g, '$1:')}`)
lines.push(`// 需求表: +${tHunks.added} -${tHunks.deleted}`)

// commit diff（提交2 vs 提交1）——README
const cHunks = gitDiff('README.md', hashes[1], hashes[0])
lines.push('')
lines.push('// ---------- commit diff（提交2 vs 提交1）README ----------')
lines.push(`const README_COMMIT_HUNKS: GitDiffResult['hunks'] = ${JSON.stringify(cHunks.hunks, null, 2).replace(/"(\w+)":/g, '$1:')}`)
lines.push(`// README commit: +${cHunks.added} -${cHunks.deleted}`)

// status / log / showCommit / branches
lines.push('')
lines.push('// ---------- 仓库元信息 ----------')
lines.push(`const STATUS: GitFileStatus[] = [`)
for (const s of status) {
  const n = numstat.find((x) => x.endsWith('\t' + s.path))
  const [add, del] = n ? n.split('\t') : [-1, -1]
  lines.push(`  { path: '${s.path.replace(/'/g, "\\'")}', status: '${s.code}', added: ${add}, deleted: ${del} },`)
}
lines.push(`]`)
lines.push(`const LOG: GitCommit[] = [`)
for (const l of logLines) {
  const [hash, author, date, msg] = l.split('\x1f')
  lines.push(`  { hash: '${hash}', author: '${author}', date: ${date}, message: '${msg.replace(/'/g, "\\'")}' },`)
}
lines.push(`]`)
lines.push(`const BRANCHES: GitBranch[] = [`)
for (const b of branchList) {
  const [name, head, remote] = b.split('\x1f')
  lines.push(`  { name: '${name}', isCurrent: ${head === '*'}, remote: ${remote ? `'${remote}'` : 'null'}, aheadBehind: null },`)
}
lines.push(`]`)

console.log(lines.join('\n'))
console.log('// ===== 数据结束 ====')
