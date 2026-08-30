// M18 发现/预取层（§4.4.1-a / §4.7）：IO 侧——解析 newMd → 收集嵌入路径 → 批量读各层
// 嵌入源 old/new → 递归收集下一层路径（10 层界 + 祖先链环检测 + 全局源去重）→ source map。
//
// 边界：本层只「读」（showFiles / fs），model 只「算」——二者消费同一 source map；
// model.ts 内部禁止任何 readFile。递归的判定语义与折叠形态由 embed-nesting-governance.md 规定，
// 判定唯一实现在 ref/embed-chain.ts（本层是 diff 侧消费者）。
import type { DiffBase, ShowFileEntry } from '../../git/types'
import { patchMermaidFences } from '../diff-deco'
import {
  classifyEmbed,
  buildCollapseChain,
  collapseSummary,
  type CollapsedInfo,
} from '../ref/embed-chain'
import { docStore } from '../docstore/store'
import type { SourceMap, CollapsedScope, DocLocation } from './model'

/** 发现层级中的一批：同一深度收集的 writePath（宿主正文或某源文件内容） */
export interface PrefetchDeps {
  base: DiffBase
  /** 宿主文件真实路径（链根；未保存新文件为 null——自嵌环降级为仅深度折叠） */
  hostPath: string | null
  /** 批量端点（mock/dev/tauri 三侧对齐，一次往返） */
  fetchEntries: (paths: string[], base: DiffBase) => Promise<ShowFileEntry[]>
  /** 单文件读（真实仓库模式下候选探测的补充；断链返回 null） */
  readFile?: (path: string) => Promise<string | null>
  /** 资源预算（§4.4.1-d）：source map 总字节上限（超限该 scope 降级浅层说明卡） */
  maxSourceBytes?: number
}

export interface PrefetchResult {
  sourceMap: SourceMap
  /** writePath → realPath（预填充按块 path 取值；别名/扩展名归一） */
  writeToReal: Map<string, string>
  /** 环/超深折叠标记（不入 sourceMap；预填充折叠卡 + model 保证层卡） */
  collapsedScopes: CollapsedScope[]
  /** 断链（读不到源文件）；diff 视图保持空卡片提示，不报错 */
  brokenPaths: string[]
}

/** md 中 ![[path]] 嵌入行（宿主正文与各层源文件内容同一规则） */
const EMBED_LINE_RE = /^\s*!\[\[([^\]]+)\]\]\s*$/gm

function extractWritePaths(md: string): string[] {
  return [...new Set([...md.matchAll(EMBED_LINE_RE)].map((m) => (m[1] ?? '').trim()).filter(Boolean))]
}

/**
 * 预取（IO 发现）：
 *  - 第 0 层：宿主 newMd 的 ![[..]] 路径 → 批量 showFiles；
 *  - 递归：对每个可读源的新内容再提取 ![[..]] 路径（批量、按 realPath 全局去重）；
 *  - 每层按祖先链（含宿主）过 classifyEmbed：环 → 折叠（不递归）；超深 → 折叠；重复兄弟正常；
 *  - sourceMap 仅存「有内容可取」的真实源（old/new 均为 null 的断链不入图）。
 * 全部 IO 走 fetchEntries 批量端点；候选探测（.md/.markdown/.txt）由后端一次 ls-files 完成。
 */
export async function prefetchEmbedSources(deps: PrefetchDeps, newMd: string): Promise<PrefetchResult> {
  const sourceMap: SourceMap = new Map()
  const writeToReal = new Map<string, string>()
  const collapsedScopes: CollapsedScope[] = []
  const brokenPaths: string[] = []
  const maxBytes = deps.maxSourceBytes ?? 4 * 1024 * 1024

  // 祖先链（根在前）：宿主 realPath + 各级父嵌入块 realPath
  const ancestors: string[] = deps.hostPath ? [deps.hostPath] : []

  const globalSeen = new Set<string>() // 全局源去重（与环检测分离）：同一 realPath 只 diff 一次
  let totalBytes = 0

  const processLevel = async (md: string, chain: string[]): Promise<void> => {
    const writePaths = extractWritePaths(md)
    if (!writePaths.length) return
    const entries = await deps.fetchEntries(writePaths, deps.base)
    for (const e of entries) {
      const real = e.realPath
      // 断链（old/next 均不可读）→ 不递归、不预填充；空卡片提示
      if (e.next == null && e.old == null && !e.exists) {
        brokenPaths.push(real)
        continue
      }
      writeToReal.set(e.write ?? real, real)
      // 环检测 × 全局源去重（两概念，治理文档 G3）：
      //   环 = realPath 在自身祖先链中再次出现（A 嵌 B 嵌 A）→ 折叠
      //   重复兄弟嵌入 = realPath 全局重复但非祖先 → 正常渲染，仅源数据去重一次
      const verdict = classifyEmbed(chain, real)
      if (verdict.kind === 'cycle' || verdict.kind === 'too-deep') {
        collapsedScopes.push({
          realPath: real,
          writePath: e.write ?? real,
          reason: verdict.kind === 'cycle' ? 'cycle' : 'depth',
          chain: buildCollapseChain(chain, real),
          summary: collapseSummary(verdict, real),
        })
        continue
      }
      if (globalSeen.has(real)) {
        // 兄弟重复：仍需要预填充（写入 content），但不再产独立 diff 数据
        continue
      }
      globalSeen.add(real)

      const oldMd = e.old
      // M4 §6.2：new 版内容优先 DocStore 模型（含未保存编辑直接进 diff）；
      // 模型未加载/未解析 → 回退批量端点磁盘内容（行为等价）
      const modelSnap = docStore.snapshot(real)
      const newMd =
        modelSnap && modelSnap.canonical != null ? modelSnap.canonical : (e.next ?? '')
      const changed = e.changed ?? (oldMd != null ? oldMd !== newMd : newMd !== '')
      // 字节预算（§4.4.1-d）：超限 → 该 scope 降级浅层说明卡（不逐层 diff）
      const srcBytes = (oldMd?.length ?? 0) + newMd.length
      if (totalBytes + srcBytes > maxBytes) {
        collapsedScopes.push({
          realPath: real,
          writePath: e.write ?? real,
          reason: 'depth',
          chain: buildCollapseChain(chain, real),
          summary: `嵌套内容量超出预算（${maxBytes} 字节），已折叠`,
        })
        continue
      }
      totalBytes += srcBytes

      // 该源的合并 md（mermaid 删除节点加回 + classDef 声明）；无变更 = 新内容原样
      let mergedMd = newMd
      if (changed) {
        const patched = patchMermaidFences(oldMd ?? '', newMd)
        mergedMd = patched.md
      }
      sourceMap.set(real, {
        realPath: real,
        oldMd,
        newMd,
        mergedMd,
        changed,
        hash: e.hash,
      })

      // 递归下一层（链 = 当前祖先链 + 本源）
      if (newMd) {
        await processLevel(newMd, [...chain, real])
      }
    }
  }

  await processLevel(newMd, ancestors)
  return { sourceMap, writeToReal, collapsedScopes, brokenPaths }
}

/** 折叠信息的 diff 侧形态（与编辑视图 CollapsedInfo 同构；预填充 setNodeMarkup 用） */
export function collapsedInfoOf(c: CollapsedScope): CollapsedInfo {
  return { reason: c.reason, chain: c.chain }
}

export type { DocLocation }