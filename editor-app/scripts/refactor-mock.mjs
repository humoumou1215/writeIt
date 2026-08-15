// refactor-mock.mjs —— 把 mock.ts 的 SAMPLE 手工区重构为：
//   MOCK_EXTRA（mock 专有演示文件）+ SAMPLE = {...DEMO_FILES, ...MOCK_EXTRA}
//   并在 load() 加入基于内容 hash 的自动同步（demo 为唯一源）
import { readFileSync, writeFileSync } from 'node:fs'
let mock = readFileSync('src/fs/mock.ts', 'utf8')
const gen = readFileSync('src/fs/mock-samples.generated.ts', 'utf8')
const demoKeys = new Set([...gen.matchAll(/^  '([^']+)': `/gm)].map((m) => m[1]))

// ---- 1. 顶部加 import ----
if (!mock.includes("from './mock-samples.generated'")) {
  mock = mock.replace(
    "import mermaidMd from '../editor/mermaid.md?raw'",
    "import mermaidMd from '../editor/mermaid.md?raw'\nimport { DEMO_FILES, DEMO_DIRS } from './mock-samples.generated'"
  )
}

// ---- 2. 解析现有 SAMPLE 条目，拆分 MOCK_EXTRA ----
const SAMPLE_START = 'const SAMPLE: Record<string, string> = {'
const startIdx = mock.indexOf(SAMPLE_START)
const dirLineStart = mock.indexOf('\nconst SAMPLE_DIRS', startIdx)
const dirLineEnd = mock.indexOf('\n', dirLineStart + 1)
if (startIdx < 0 || dirLineStart < 0) throw new Error('SAMPLE 锚点未找到')

const sampleBlock = mock.slice(startIdx, dirLineStart)
const keys = [...sampleBlock.matchAll(/^  '([^']+)': `/gm)]
const extraEntries = []
for (let i = 0; i < keys.length; i++) {
  const k = keys[i]
  const next = i + 1 < keys.length ? keys[i + 1].index : sampleBlock.lastIndexOf('\n}')
  const entryText = sampleBlock.slice(k.index, next).trimEnd()
  if (!demoKeys.has(k[1])) extraEntries.push(entryText)
}
const extraKeys = extraEntries.map((t) => t.match(/^  '([^']+)': `/)[1])
const extraDirs = [...new Set(extraKeys.map((p) => { const i = p.lastIndexOf('/'); return i > 0 ? p.slice(0, i) : null }).filter(Boolean))].sort()

const newSample =
  `const MOCK_EXTRA: Record<string, string> = {\n${extraEntries.join('\n')}\n}\n\n` +
  `/** demo 目录为唯一源（scripts/sync-demo.mjs 生成）；mock 专有演示文件在此补充 */\n` +
  `const SAMPLE: Record<string, string> = { ...DEMO_FILES, ...MOCK_EXTRA }\n\n` +
  `/** mock 专有演示目录（笔记/数据/引用演示等，不在 demo/ 内） */\n` +
  `const MOCK_EXTRA_DIRS: string[] = [\n${extraDirs.map((d) => `  '${d}',`).join('\n')}\n]\n` +
  `const SAMPLE_DIRS: string[] = [...DEMO_DIRS, ...MOCK_EXTRA_DIRS]\n`

mock = mock.slice(0, startIdx) + newSample + mock.slice(dirLineEnd + 1)

// ---- 3. MockData 加 fileHash ----
if (!mock.includes('fileHash?:')) {
  mock = mock.replace(
    '  /** 示例合并版本：新版本会把新增示例文件补进旧快照 */\n  seededVersion?: number\n}',
    '  /** 示例合并版本：新版本会把新增示例文件补进旧快照 */\n  seededVersion?: number\n  /** 同步管理文件的 content hash（demo 为源，hash 变化自动更新） */\n  fileHash?: Record<string, string>\n}'
  )
}

// ---- 4. load() 重构：hash 自动同步 + 删除同步 ----
const loadStart = mock.indexOf('function load(): MockData {')
const loadEnd = mock.indexOf('\nfunction persist', loadStart)
if (loadStart < 0 || loadEnd < 0) throw new Error('load 锚点未找到')

const newLoad = `function hash(s: string): string {
  let x = 0
  for (let i = 0; i < s.length; i++) x = (Math.imul(x, 31) + s.charCodeAt(i)) | 0
  return (x >>> 0).toString(36)
}

function load(): MockData {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const data = JSON.parse(raw) as MockData
      let changed = false
      // 版本迁移：补缺 + FORCE_UPDATE 覆盖（结构性变化时 bump SEED_VERSION）
      const needMerge =
        (data.seededVersion ?? 1) < SEED_VERSION ||
        !('template/demo/demo.md' in (data.files ?? {}))
      if (needMerge) {
        const prev = data.seededVersion ?? 1
        for (const [path, content] of Object.entries(SAMPLE)) {
          if (!(path in data.files)) data.files[path] = content
          // 演示核心文件：跨版本强制覆盖（suggest 样例等）
          else if (prev < SEED_VERSION && FORCE_UPDATE_PATHS.includes(path)) {
            data.files[path] = content
          }
        }
        data.seeded = true
        data.seededVersion = SEED_VERSION
        changed = true
      }
      // 内容同步（demo 为唯一源）：hash 变化自动更新/新增；demo 删除的文件同步移除
      data.fileHash = data.fileHash ?? {}
      for (const [path, content] of Object.entries(SAMPLE)) {
        const h = hash(content)
        if (data.files[path] === undefined || data.fileHash[path] !== h) {
          data.files[path] = content
          data.fileHash[path] = h
          changed = true
        }
      }
      for (const path of Object.keys(data.files)) {
        if (data.fileHash[path] !== undefined && !(path in SAMPLE)) {
          delete data.files[path]
          delete data.fileHash[path]
          changed = true
        }
      }
      for (const dir of SAMPLE_DIRS) {
        if (!data.dirs.includes(dir)) {
          data.dirs.push(dir)
          changed = true
        }
      }
      if (changed) persist(data)
      return data
    }
  } catch {
    /* ignore */
  }
  const data: MockData = {
    files: { ...SAMPLE },
    dirs: [...SAMPLE_DIRS],
    fileHash: Object.fromEntries(Object.entries(SAMPLE).map(([p, c]) => [p, hash(c)])),
    seeded: true,
    seededVersion: SEED_VERSION,
  }
  persist(data)
  return data
}
`
mock = mock.slice(0, loadStart) + newLoad + mock.slice(loadEnd)

writeFileSync('src/fs/mock.ts', mock)
console.log('refactor ok: MOCK_EXTRA', extraKeys.length, '个文件, dirs', JSON.stringify(extraDirs))
