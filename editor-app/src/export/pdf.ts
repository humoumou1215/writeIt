// mdast 中间结构 → PDF（pdfmake + 内置思源黑体子集，离线可用）
// 字体：Noto Sans CJK SC（GB2312 常用字子集，Regular + Bold 双字重，约 3MB × 2）
// 以 ?url 静态资源打包，运行时 fetch → base64 注册进 pdfmake 的 vfs（只做一次）。
import type { ExportBlock, ExportImage, ExportTable, InlineNode } from './mdast'
import regularFontUrl from './assets/NotoSansCJKsc-Regular.sub.otf?url'
import boldFontUrl from './assets/NotoSansCJKsc-Bold.sub.otf?url'

const REGULAR_FONT = 'NotoSansCJKsc-Regular.otf'
const BOLD_FONT = 'NotoSansCJKsc-Bold.otf'
const FONT_FAMILY = 'NotoSans'

// ---------- pdfmake 懒初始化（字体 vfs + 字体表，幂等） ----------

type PdfMakeInstance = {
  virtualfs?: { existsSync?: (f: string) => boolean }
  addFontContainer(c: unknown): void
  createPdf(doc: unknown): { getBlob(): Promise<Blob> }
}

type PdfMakeModule = PdfMakeInstance

let pdfMakePromise: Promise<PdfMakeModule> | null = null

function ensurePdfMake(): Promise<PdfMakeModule> {
  if (pdfMakePromise) return pdfMakePromise
  pdfMakePromise = (async () => {
    const mod0 = (await import('pdfmake/build/pdfmake')) as unknown as {
      default?: PdfMakeInstance
    }
    // Vite 下 CJS/UMD 模块是 { default } 命名空间；node require 直接是实例
    const mod = mod0.default ?? (mod0 as unknown as PdfMakeInstance)
    // 幂等：vfs 已注册（字体名存在）则跳过
    const existing = (mod as unknown as { virtualfs?: { existsSync?: (f: string) => boolean } }).virtualfs
    if (!existing || !existing.existsSync?.(REGULAR_FONT)) {
      const toBase64 = async (url: string) => {
        const res = await fetch(url)
        const buf = await res.arrayBuffer()
        const bytes = new Uint8Array(buf)
        let bin = ''
        const chunk = 0x8000
        for (let i = 0; i < bytes.length; i += chunk) {
          bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
        }
        return btoa(bin)
      }
      const [reg, bold] = await Promise.all([toBase64(regularFontUrl), toBase64(boldFontUrl)])
      // pdfmake 浏览器版通过 addFontContainer 把 vfs 写入内部虚拟文件系统
      ;(mod as unknown as { addFontContainer: (c: unknown) => void }).addFontContainer({
        vfs: {
          [REGULAR_FONT]: reg,
          [BOLD_FONT]: bold,
        },
        fonts: {
          [FONT_FAMILY]: {
            normal: REGULAR_FONT,
            bold: BOLD_FONT,
            italics: REGULAR_FONT,
            bolditalics: BOLD_FONT,
          },
        },
      })
    }
    return mod
  })()
  pdfMakePromise.catch(() => {
    pdfMakePromise = null
  })
  return pdfMakePromise
}

// ---------- 中间结构 → pdfmake document ----------

interface PdfTextSegment {
  text: string
  bold?: boolean
  italics?: boolean
  decoration?: 'lineThrough' | 'underline'
  background?: string
  link?: string
  color?: string
  fontSize?: number
  font?: string
}

function inlineToSegments(nodes: InlineNode[], baseSize: number): PdfTextSegment[] {
  const segs: PdfTextSegment[] = []
  for (const n of nodes) {
    if (n.kind === 'link') {
      segs.push({
        text: flattenInline(n.text),
        link: n.href || undefined,
        color: '1a73e8',
        fontSize: baseSize,
      })
    } else if (n.kind === 'text') {
      segs.push({
        text: n.value,
        bold: n.bold,
        italics: n.italic,
        decoration: n.strike ? 'lineThrough' : undefined,
        background: n.highlight ? '#fff59d' : n.code ? '#f2f2f2' : undefined,
        fontSize: baseSize,
      })
    }
  }
  return segs
}

function flattenInline(nodes: InlineNode[]): string {
  return nodes.map((n) => (n.kind === 'text' ? n.value : flattenInline(n.text))).join('')
}

function headingText(segments: PdfTextSegment[], level: number) {
  const size = [22, 18, 16, 14, 13, 12][Math.min(5, Math.max(0, level - 1))]
  return {
    text: segments,
    fontSize: size,
    bold: true,
    margin: [0, level === 1 ? 6 : 10, 0, 6] as [number, number, number, number],
  }
}

function tableToPdf(t: ExportTable) {
  const cell = (nodes: InlineNode[], header: boolean) => ({
    text: inlineToSegments(nodes, 10),
    bold: header,
    margin: [4, 3, 4, 3] as [number, number, number, number],
  })
  const body: unknown[][] = []
  if (t.header.length) {
    body.push(t.header.map((c) => cell(c, true)))
  }
  for (const r of t.rows) {
    body.push(r.map((c) => cell(c, false)))
  }
  return {
    table: {
      headerRows: t.header.length ? 1 : 0,
      widths: Array(t.header.length || 1).fill('*'),
      body,
    },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => '#999999',
      vLineColor: () => '#999999',
      fillColor: (_i: number, node: { table?: { headerRows?: number } }) =>
        node?.table?.headerRows ? '#f0f0f0' : null,
    } as never,
    margin: [0, 4, 0, 8] as [number, number, number, number],
  }
}

function blockToPdf(block: ExportBlock): unknown {
  switch (block.kind) {
    case 'heading':
      return headingText(inlineToSegments(block.text, 14), block.level)
    case 'paragraph':
      return { text: inlineToSegments(block.text, 11), margin: [0, 2, 0, 4] }
    case 'list': {
      const items = block.items.map((item) => ({
        text: [
          { text: block.ordered ? '' : '•  ', bold: true } as PdfTextSegment,
          ...inlineToSegments(item.text, 11),
        ],
        margin: [0, 1, 0, 1] as [number, number, number, number],
      }))
      return {
        ul: block.ordered ? undefined : items,
        ol: block.ordered ? items : undefined,
        margin: [8, 2, 0, 6],
      }
    }
    case 'task':
      return {
        text: [
          { text: block.checked ? '☑ ' : '☐ ', fontSize: 11 } as PdfTextSegment,
          ...inlineToSegments(block.text, 11),
        ],
        margin: [8, 1, 0, 2],
      }
    case 'image': {
      const img = block as ExportImage
      return {
        image: img.dataUri,
        width: img.width,
        height: img.height,
        margin: [0, 4, 0, 8] as [number, number, number, number],
      }
    }
    case 'table':
      return tableToPdf(block)
    case 'code':
      return {
        text: block.content,
        fontSize: 9,
        font: FONT_FAMILY, // 中文注释仍需中文字体；无等宽中文，接受
        background: '#f5f5f5',
        margin: [0, 3, 0, 8],
      }
    case 'quote':
      return {
        stack: block.blocks.map((b) => blockToPdf(b)),
        margin: [12, 2, 0, 6],
        background: '#f7f7f7',
        color: '#444444',
      }
    case 'hr':
      return { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.6, lineColor: '#cccccc' }], margin: [0, 8, 0, 8] }
    default:
      return null
  }
}

/** md → PDF Blob */
export async function mdBlocksToPdf(blocks: ExportBlock[], title: string): Promise<Blob> {
  const pdfMake = await ensurePdfMake()
  const content: unknown[] = [
    { text: title, fontSize: 20, bold: true, alignment: 'center', margin: [0, 0, 0, 14] },
  ]
  for (const b of blocks) {
    const item = blockToPdf(b)
    if (item !== null) content.push(item)
  }
  const doc = {
    defaultStyle: { font: FONT_FAMILY, fontSize: 11, lineHeight: 1.5 },
    content,
    pageMargins: [48, 48, 48, 56] as [number, number, number, number],
  }
  const pdf = pdfMake.createPdf(doc)
  return await pdf.getBlob()
}
