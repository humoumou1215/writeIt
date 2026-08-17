// dev-repo.ts —— Vite 开发服务器插件：真实文件系统 + 真实 git 桥（M15）
// 背景：浏览器沙箱无法读本地文件、无法执行 git CLI；Vite dev server 跑在本机 Node，
//   由它代劳：`/__repo/fs/*` 走 node:fs/promises，`/__repo/git/*` 走 child_process git CLI。
//   前端约定：URL 带 ?repo=1（或 localStorage writeit.repo=1）+ vite dev → 前端切到 dev 后端。
//   语义对齐 tauri 版（src-tauri/src/lib.rs），命令参数 / 解析规则照抄。
// ROOT：环境变量 WRITEIT_DEV_REPO 覆盖，默认「消金业务合作平台」内容库（独立 git 仓库）。
import type { Connect, Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { execFile as execFileCb } from 'node:child_process'
import { spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { promises as fs, statSync } from 'node:fs'
import path from 'node:path'

const execFile = promisify(execFileCb)

/** 内容库根目录（独立 git 仓库）。可用 WRITEIT_DEV_REPO 覆盖切换任意仓库 */
export const REPO_ROOT = process.env.WRITEIT_DEV_REPO || '/Users/huyongsheng/project/消金业务合作平台'

// ---------- 通用 ----------

interface FsEntry {
  name: string
  path: string
  kind: 'file' | 'dir'
  children?: FsEntry[]
}

type DiffKind = 'add' | 'del' | 'ctx'

interface DiffWord { kind: DiffKind; text: string }
interface DiffLine { kind: DiffKind; text: string; words?: DiffWord[] | null }
interface DiffHunk {
  oldStart: number; oldLines: number; newStart: number; newLines: number
  lines: DiffLine[]
}
interface DiffResult { hunks: DiffHunk[]; added: number; deleted: number }

/** 防越界：相对路径 → 绝对路径（以 ROOT 为根）；失败抛错 */
function resolveRel(rel: string): string {
  const root = path.resolve(REPO_ROOT)
  const p = path.resolve(root, rel.replace(/^\/+/, ''))
  if (p !== root && !p.startsWith(root + path.sep)) throw new Error('路径越界')
  return p
}

function send(res: ServerResponse, obj: unknown) {
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(obj))
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const s = Buffer.concat(chunks).toString('utf8')
  if (!s) return {}
  try { return JSON.parse(s) as Record<string, unknown> } catch { return {} }
}

// ---------- FS（对齐 read_tree / read_file / write_file / create / rename / remove） ----------

async function walk(dir: string, showAll: boolean): Promise<FsEntry[]> {
  const entries: FsEntry[] = []
  let rd: import('node:fs').Dirent[]
  try { rd = await fs.readdir(dir, { withFileTypes: true }) } catch { return entries }
  for (const e of rd) {
    const name = e.name
    if (!showAll && name.startsWith('.')) continue // 隐藏文件默认跳过；showAll=true 保留（.template 模板目录）
    if (name === '.git') continue // git 内部目录不展示（真实仓库模式）
    const rel = path.relative(REPO_ROOT, path.join(dir, name)).split(path.sep).join('/')
    if (e.isDirectory()) {
      entries.push({ name, path: rel, kind: 'dir', children: await walk(path.join(dir, name), showAll) })
    } else {
      entries.push({ name, path: rel, kind: 'file' })
    }
  }
  entries.sort((a, b) =>
    a.kind === b.kind ? a.name.toLowerCase().localeCompare(b.name.toLowerCase()) : a.kind === 'dir' ? -1 : 1
  )
  return entries
}

// ---------- Git CLI（对齐 lib.rs git_* 全部命令） ----------

async function git(args: string[]): Promise<Buffer> {
  try {
    // 前置 -c core.quotepath=false：中文路径不做 octal 转义（对 -z 输出无碍；保护非 -z 命令）
    const r = await execFile('git', ['-c', 'core.quotepath=false', ...args], {
      cwd: REPO_ROOT, encoding: 'buffer', maxBuffer: 256 << 20,
    })
    return r.stdout as Buffer
  } catch (e) {
    const err = e as { stderr?: Buffer; message?: string }
    throw new Error((err.stderr?.toString('utf8') || err.message || 'git 执行失败').trim())
  }
}

function isGitRepo(): boolean {
  try { return statSync(path.join(REPO_ROOT, '.git')).isDirectory() } catch { return false }
}

/** git status --porcelain=v1 -z → [{status, path}]；R/C 双记录 → 显示 "old → new"（对齐 parse_porcelain） */
function parsePorcelain(bytes: Buffer): { status: string; path: string }[] {
  const files: { status: string; path: string }[] = []
  let i = 0
  while (i < bytes.length) {
    let end = bytes.indexOf(0, i)
    if (end === -1) end = bytes.length
    const rec = bytes.subarray(i, end).toString('utf8')
    i = end + 1
    if (rec.length < 3) continue
    const xy = rec.slice(0, 2)
    const p = rec.slice(3)
    const st = xy.trim()
    if (st === 'R' || st === 'C') {
      let end2 = bytes.indexOf(0, i)
      if (end2 === -1) end2 = bytes.length
      const newPath = bytes.subarray(i, end2).toString('utf8')
      i = end2 + 1
      files.push({ status: st, path: `${p} → ${newPath}` })
      continue
    }
    let status: string
    if (st.includes('?')) status = '?'
    else if (st.includes('U')) status = 'U'
    else {
      const last = st[st.length - 1]
      status = last === 'M' ? 'M' : last === 'A' ? 'A' : last === 'D' ? 'D' : 'M'
    }
    files.push({ status, path: p })
  }
  return files
}

/** git status：porcelain 状态 + numstat 行数（untracked 读文件行数铺底） */
async function gitStatus() {
  const out = await git(['status', '--porcelain=v1', '-z'])
  const files = parsePorcelain(out).map((f) => ({ ...f, added: -1, deleted: -1 }))
  // 行数统计：工作区 vs HEAD（untracked 不在内）
  try {
    const nums = (await git(['diff', '--numstat', 'HEAD'])).toString('utf8')
    for (const line of nums.split('\n')) {
      const parts = line.split('\t')
      if (parts.length < 3) continue
      const add = parseInt(parts[0], 10)
      const del = parseInt(parts[1], 10)
      const f = files.find((x) => x.path === parts[2])
      if (f) { f.added = Number.isNaN(add) ? -1 : add; f.deleted = Number.isNaN(del) ? -1 : del }
    }
  } catch { /* HEAD 无提交时忽略 */ }
  // untracked：读行数
  for (const f of files) {
    if (f.status === '?' && f.added < 0) {
      try {
        const s = await fs.readFile(resolveRel(f.path), 'utf8')
        f.added = s.split('\n').length
        f.deleted = 0
      } catch { /* 二进制/不存在忽略 */ }
    }
  }
  return files
}

function parseHunkHeader(line: string): DiffHunk | null {
  const rest = line.replace(/^@@\s*/, '').replace(/\s*@@$/, '').trim()
  const parts = rest.split(/\s+/)
  const old = parts[0]?.replace(/^-/, '').split(',') ?? []
  const neu = parts[1]?.replace(/^\+/, '').split(',') ?? []
  const oldStart = parseInt(old[0], 10)
  const newStart = parseInt(neu[0], 10)
  if (Number.isNaN(oldStart) || Number.isNaN(newStart)) return null
  return {
    oldStart,
    oldLines: old[1] ? parseInt(old[1], 10) : 1,
    newStart,
    newLines: neu[1] ? parseInt(neu[1], 10) : 1,
    lines: [],
  }
}

/** git diff --word-diff=porcelain → 每行组 token（对齐 parse_word_groups） */
function parseWordGroups(text: string): DiffWord[][] {
  const groups: DiffWord[][] = []
  let cur: DiffWord[] = []
  for (const line of text.split('\n')) {
    if (line === '~') { groups.push(cur); cur = []; continue }
    if (
      line === '' || line.startsWith('diff --git') || line.startsWith('index ')
      || line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('@@')
    ) continue
    const kind: DiffKind = line[0] === '+' ? 'add' : line[0] === '-' ? 'del' : 'ctx'
    cur.push({ kind, text: line.slice(1) })
  }
  if (cur.length) groups.push(cur)
  return groups
}

/** 词 token 行组 → diff 行序列（del+add 同组 → 2 行）（对齐 groups_to_rows） */
function groupsToRows(groups: DiffWord[][]): { kind: DiffKind; tokens: DiffWord[] }[] {
  const rows: { kind: DiffKind; tokens: DiffWord[] }[] = []
  for (const g of groups) {
    const hasDel = g.some((w) => w.kind === 'del')
    const hasAdd = g.some((w) => w.kind === 'add')
    const common = (k: DiffKind) => g.filter((w) => w.kind === 'ctx' || w.kind === k)
    if (hasDel && hasAdd) {
      rows.push({ kind: 'del', tokens: common('del') })
      rows.push({ kind: 'add', tokens: common('add') })
    } else if (hasDel) rows.push({ kind: 'del', tokens: common('del') })
    else if (hasAdd) rows.push({ kind: 'add', tokens: common('add') })
    else if (g.length) rows.push({ kind: 'ctx', tokens: g })
  }
  return rows
}

/** 解析 unified diff（可选词级组按 (kind, text) 贪心匹配合并到行）→ hunks + 统计 */
function parseUnifiedDiff(text: string, wordGroups?: DiffWord[][]): DiffResult {
  const wordRows: { kind: DiffKind; joined: string; tokens: DiffWord[] }[] = []
  if (wordGroups) {
    for (const { kind, tokens } of groupsToRows(wordGroups)) {
      wordRows.push({ kind, joined: tokens.map((w) => w.text).join(''), tokens })
    }
  }
  const hunks: DiffHunk[] = []
  let added = 0
  let deleted = 0
  let cur: DiffHunk | null = null
  for (const line of text.split('\n')) {
    if (line.startsWith('@@')) {
      if (cur) hunks.push(cur)
      cur = parseHunkHeader(line)
    } else if (cur) {
      const kind: DiffKind | null = line[0] === '+' ? 'add' : line[0] === '-' ? 'del' : line[0] === ' ' ? 'ctx' : null
      if (!kind) continue // "\\ No newline at end of file" 等元行
      const content = line.slice(1)
      if (kind === 'add') added++
      else if (kind === 'del') deleted++
      // 词级：队列首个 (kind, joined) 匹配项（贪心；重复行按序）
      let words: DiffWord[] | null = null
      const pos = wordRows.findIndex((r) => r.kind === kind && r.joined === content)
      if (pos !== -1) { words = wordRows.splice(pos, 1)[0].tokens }
      cur.lines.push({ kind, text: content, words })
    }
  }
  if (cur) hunks.push(cur)
  return { hunks, added, deleted }
}

/** 从 unified diff 提取第 idx 个 hunk（含 diff 头部）→ 可独立应用的补丁（对齐 extract_hunk_patch） */
function extractHunkPatch(diffText: string, idx: number): string | null {
  const lines = diffText.split('\n')
  let found = 0
  let start: number | null = null
  let headerEnd = 0
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('@@')) {
      if (headerEnd === 0) headerEnd = i
      if (found === idx) { start = i; break }
      found++
    }
  }
  if (start === null) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith('@@')) { end = i; break }
  }
  const out: string[] = []
  for (let i = 0; i < headerEnd; i++) out.push(lines[i])
  for (let i = start; i < end; i++) out.push(lines[i])
  return out.join('\n') + '\n'
}

/** 用 stdin 管道喂补丁给 git apply（execFile 的 input 会挂起，改用 spawn） */
function applyPatch(patch: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['apply', '--reverse', '--unidiff-zero', '-'], { cwd: REPO_ROOT })
    let errBuf = Buffer.alloc(0)
    child.stderr.on('data', (d: Buffer) => { errBuf = Buffer.concat([errBuf, d]) })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(errBuf.toString('utf8').trim() || `git apply 退出码 ${code}`))
    })
    child.stdin.on('error', () => {}) // 防 EPIPE
    child.stdin.write(patch)
    child.stdin.end()
  })
}

// ---------- 中间件 ----------

async function handleFs(req: IncomingMessage, res: ServerResponse, action: string) {
  const body = await readBody(req)
  try {
    switch (action) {
      case 'tree': {
        const showAll = body.showAll === true || body.showAll === 'true'
        send(res, { ok: true, data: await walk(REPO_ROOT, showAll) })
        return
      }
      case 'read':
        send(res, { ok: true, data: await fs.readFile(resolveRel(String(body.path)), 'utf8') })
        return
      case 'write': {
        const full = resolveRel(String(body.path))
        await fs.mkdir(path.dirname(full), { recursive: true })
        await fs.writeFile(full, String(body.content ?? ''), 'utf8')
        send(res, { ok: true })
        return
      }
      case 'create': {
        const full = resolveRel(String(body.path))
        try { await fs.access(full); throw new Error('文件已存在') } catch (e) {
          if ((e as Error).message === '文件已存在') throw e
        }
        await fs.mkdir(path.dirname(full), { recursive: true })
        await fs.writeFile(full, '', 'utf8')
        send(res, { ok: true })
        return
      }
      case 'create-dir': {
        await fs.mkdir(resolveRel(String(body.path)), { recursive: true })
        send(res, { ok: true })
        return
      }
      case 'rename': {
        const from = resolveRel(String(body.oldPath))
        const to = resolveRel(String(body.newPath))
        await fs.rename(from, to)
        send(res, { ok: true })
        return
      }
      case 'remove': {
        const full = resolveRel(String(body.path))
        const st = await fs.stat(full)
        if (st.isDirectory()) await fs.rm(full, { recursive: true })
        else await fs.unlink(full)
        send(res, { ok: true })
        return
      }
      default:
        send(res, { ok: false, error: `未知 fs 操作: ${action}` })
    }
  } catch (e) {
    send(res, { ok: false, error: (e as Error).message })
  }
}

async function handleGit(req: IncomingMessage, res: ServerResponse, action: string) {
  const body = await readBody(req)
  try {
    if (!isGitRepo()) throw new Error('当前目录不是 Git 仓库')
    switch (action) {
      case 'repo-info': {
        let branch: string | null = null
        let headHash: string | null = null
        try { branch = (await git(['branch', '--show-current'])).toString('utf8').trim() || null } catch { /* detached */ }
        try { headHash = (await git(['rev-parse', 'HEAD'])).toString('utf8').trim() || null } catch { /* 无提交 */ }
        send(res, { ok: true, data: { isRepo: true, branch, headHash } })
        return
      }
      case 'branches': {
        const out = (await git([
          'for-each-ref',
          '--format=%(refname:short)%1f%(HEAD)%1f%(upstream:short)%1f%(upstream:track)',
          'refs/heads', 'refs/remotes',
        ])).toString('utf8')
        const branches = out.split('\n').filter(Boolean).map((line) => {
          const parts = line.split('\u{1f}')
          return {
            name: parts[0],
            isCurrent: parts[1] === '*',
            remote: parts[2] ? parts[2] : null,
            aheadBehind: parts[3] ? parts[3] : null,
          }
        })
        send(res, { ok: true, data: branches })
        return
      }
      case 'status':
        send(res, { ok: true, data: await gitStatus() })
        return
      case 'log': {
        const n = Math.min(Math.max(Number(body.limit) || 50, 1), 500)
        const args = ['log', '-n', String(n), '--format=%H%x1f%P%x1f%an%x1f%at%x1f%s%x1e']
        if (body.branch) args.push(String(body.branch))
        const text = (await git(args)).toString('utf8')
        const commits = text.split('\u{1e}').map((rec) => rec.split('\u{1f}')).filter((p) => p.length >= 5 && p[0] !== '').map((p) => ({
          hash: p[0],
          parents: p[1] ? p[1].split(/\s+/) : [],
          author: p[2],
          date: parseInt(p[3], 10) || 0,
          message: p[4],
        }))
        send(res, { ok: true, data: commits })
        return
      }
      case 'show-commit': {
        const hash = String(body.hash)
        const header = (await git(['log', '-1', '--format=%H%x1f%P%x1f%an%x1f%at%x1f%s%x1e', hash])).toString('utf8')
        const rec = header.split('\u{1e}')[0]?.split('\u{1f}') ?? []
        if (rec.length < 5 || !rec[0]) throw new Error(`提交不存在：${hash}`)
        // 文件状态：diff-tree --name-status -z --no-commit-id（NUL 交替 token；--root 支持初始提交）
        const nout = (await git(['diff-tree', '--name-status', '-z', '--no-commit-id', '-r', '--root', '-M', hash])).toString('utf8')
        const statusMap = new Map<string, string>()
        const toks = nout.split('\0')
        for (let i = 0; i < toks.length; ) {
          const st = toks[i++]
          if (!st) continue
          const p = toks[i++]
          if (p === undefined) break
          const code = st[0]
          if (code === 'R' || code === 'C') {
            // rename/copy：紧随的两条 path 记录 = old, new（取 new）
            const newPath = toks[i++]
            if (newPath === undefined) break
            statusMap.set(newPath, code === 'R' ? 'R' : 'M')
          } else {
            statusMap.set(p, code === 'A' ? 'A' : code === 'D' ? 'D' : 'M')
          }
        }
        // 行数：diff-tree --numstat -z --no-commit-id（rename 路径 `old => new`，取 new）
        const mout = (await git(['diff-tree', '--numstat', '-z', '--no-commit-id', '-r', '--root', '-M', hash])).toString('utf8')
        const numMap = new Map<string, [number, number]>()
        for (const rec of mout.split('\0')) {
          if (!rec) continue
          const parts = rec.split('\t')
          if (parts.length < 3) continue
          const add = parseInt(parts[0], 10)
          const del = parseInt(parts[1], 10)
          const p = parts.slice(2).join('\t')
          const key = p.includes(' => ') ? p.split(' => ')[1] : p
          numMap.set(key, [add, del])
        }
        const keys = [...statusMap.keys()].sort()
        const files = keys.map((k) => {
          const [add, del] = numMap.get(k) ?? [-1, -1]
          return { path: k, status: statusMap.get(k) ?? 'M', added: add, deleted: del }
        })
        send(res, { ok: true, data: {
          hash: rec[0], author: rec[2], date: parseInt(rec[3], 10) || 0, message: rec[4], files,
        } })
        return
      }
      case 'diff-file': {
        const path_ = String(body.path)
        const from = body.from ? String(body.from) : null
        const to = String(body.to ?? 'HEAD')
        const args = ['diff', '--no-color', '-U3']
        if (from) { args.push(from, to) } else { args.push('HEAD') }
        args.push('--', path_)
        const text = (await git(args)).toString('utf8')
        let exists = false
        try { exists = statSync(resolveRel(path_)).isFile() } catch { exists = false }
        if (!text) { send(res, { ok: true, data: { hunks: [], added: 0, deleted: 0, exists } }); return }
        const base = parseUnifiedDiff(text)
        // 词级高亮：--word-diff=porcelain 解析，行组与 unified 行序合并（对齐 lib.rs，补齐 -- path）
        let result = base
        if (base.hunks.length) {
          const wargs = ['diff', '--word-diff=porcelain', '--no-color', '-U3']
          if (from) { wargs.push(from, to) } else { wargs.push('HEAD') }
          wargs.push('--', path_)
          try {
            const wtext = (await git(wargs)).toString('utf8')
            const groups = parseWordGroups(wtext)
            if (groups.length) result = parseUnifiedDiff(text, groups)
          } catch { /* 词级失败降级行级 */ }
        }
        send(res, { ok: true, data: { hunks: result.hunks, added: result.added, deleted: result.deleted, exists } })
        return
      }
      case 'show-file': {
        const out = await git(['show', `${String(body.rev)}:${String(body.path)}`])
        send(res, { ok: true, data: out.toString('utf8') })
        return
      }
      case 'discard-file': {
        await git(['checkout', '--', String(body.path)])
        send(res, { ok: true })
        return
      }
      case 'discard-hunk': {
        const path_ = String(body.path)
        const idx = Number(body.hunkIndex)
        const text = (await git(['diff', '--no-color', '-U0', 'HEAD', '--', path_])).toString('utf8')
        const patch = extractHunkPatch(text, idx)
        if (!patch) throw new Error('hunk 不存在或文件无改动')
        // 与 Rust 侧一致：spawn + stdin 管道写补丁（execFile 的 input 在部分 Node 版本会挂起）
        await applyPatch(patch)
        send(res, { ok: true })
        return
      }
      case 'checkout-branch': {
        await git(['checkout', String(body.name)])
        send(res, { ok: true })
        return
      }
      default:
        send(res, { ok: false, error: `未知 git 操作: ${action}` })
    }
  } catch (e) {
    send(res, { ok: false, error: (e as Error).message })
  }
}

/** Vite 插件：/__repo/fs/*、/__repo/git/* 中间件（仅 dev server 注册） */
export default function devRepo(): Plugin {
  return {
    name: 'writeit:dev-repo',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const u = new URL(req.url ?? '/', 'http://localhost')
        const p = u.pathname
        if (!p.startsWith('/__repo/')) {
          // connect 的 use(path, fn) 会剥掉前缀再传 handler，这里自判前缀
          next()
          return
        }
        try {
          const seg = p.split('/').filter(Boolean) // ['__repo', 'fs'|'git', action]
          if (seg.length < 3) { send(res, { ok: false, error: 'bad path' }); return }
          const [, service, action] = seg
          if (service === 'fs') await handleFs(req, res, action)
          else if (service === 'git') await handleGit(req, res, action)
          else send(res, { ok: false, error: `unknown service: ${service}` })
        } catch (e) {
          send(res, { ok: false, error: (e as Error).message })
        }
      })
    },
  }
}

/** 供脚本探活 / 测试使用 */
export const _internal = { REPO_ROOT, parsePorcelain, parseUnifiedDiff, parseWordGroups, extractHunkPatch }