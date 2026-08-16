// mdast 中间结构 → DOCX（docx 库）
// 中文无需嵌入字体：docx 只引用字体名（eastAsia），打开方机器渲染。
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  LevelFormat,
  ExternalHyperlink,
  ShadingType,
  BorderStyle,
  ImageRun,
  type TableBorders,
} from 'docx'
import type { ExportBlock, ExportImage, ExportTable, InlineNode } from './mdast'
import { languageLabel } from './mdast'

// 字体名（引用式，打开方提供）：正文宋体、标题黑体、代码 Consolas
const BODY_FONT = '宋体'
const HEADING_FONT = '黑体'
const CODE_FONT = 'Consolas'

function headingLevel(level: number): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  switch (level) {
    case 1: return HeadingLevel.HEADING_1
    case 2: return HeadingLevel.HEADING_2
    case 3: return HeadingLevel.HEADING_3
    case 4: return HeadingLevel.HEADING_4
    case 5: return HeadingLevel.HEADING_5
    default: return HeadingLevel.HEADING_6
  }
}

function headingSize(level: number): number {
  return [22, 18, 16, 14, 13, 12][Math.min(5, Math.max(0, level - 1))]
}

// ---------- 行内 ----------

function inlineRun(n: InlineNode, baseSize = 21): TextRun | ImageRun {
  if (n.kind === 'link') {
    const text = flattenText(n.text)
    return new TextRun({
      text,
      style: 'Hyperlink',
      size: baseSize,
      bold: n.text.some((x) => x.kind === 'text' && x.bold),
      italics: n.text.some((x) => x.kind === 'text' && x.italic),
    })
  }
  if (n.kind === 'image') {
    const b64 = n.dataUri.split(',')[1] ?? ''
    const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    return new ImageRun({ type: 'png', data, transformation: { width: n.width, height: n.height } })
  }
  return new TextRun({
    text: n.value,
    bold: n.bold,
    italics: n.italic,
    strike: n.strike,
    highlight: n.highlight ? 'yellow' : undefined,
    font: n.code ? { ascii: CODE_FONT, eastAsia: BODY_FONT } : { ascii: 'Calibri', eastAsia: BODY_FONT },
    size: baseSize,
  })
}

function flattenText(nodes: InlineNode[]): string {
  return nodes
    .map((n) => (n.kind === 'text' ? n.value : n.kind === 'link' ? flattenText(n.text) : ''))
    .join('')
}

function inlineParagraph(nodes: InlineNode[], opts: { size?: number; font?: string; bold?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}): Paragraph {
  const runs: Array<TextRun | ImageRun> = []
  // 链接：整体作为一个 ExternalHyperlink
  let i = 0
  while (i < nodes.length) {
    const n = nodes[i]
    if (n.kind === 'link' && n.href) {
      runs.push(
        new ExternalHyperlink({
          link: n.href,
          children: [new TextRun({ text: flattenText(n.text), style: 'Hyperlink', size: opts.size ?? 21, bold: opts.bold })],
        }) as unknown as TextRun
      )
    } else if (n.kind === 'text' || n.kind === 'image') {
      runs.push(inlineRun(n, opts.size))
    }
    i++
  }
  return new Paragraph({ alignment: opts.align, children: runs })
}

/** 引用块段落：灰色斜体 + 左缩进 */
function quotedParagraph(nodes: InlineNode[]): Paragraph {
  const runs: TextRun[] = nodes.map((n) => {
    if (n.kind === 'link' && n.href) {
      return new ExternalHyperlink({
        link: n.href,
        children: [new TextRun({ text: flattenText(n.text), style: 'Hyperlink', size: 20, color: '666666', italics: true })],
      }) as unknown as TextRun
    }
    return new TextRun({
      text: n.value,
      bold: n.bold,
      italics: true,
      strike: n.strike,
      highlight: n.highlight ? 'yellow' : undefined,
      color: '666666',
      font: n.code ? { ascii: CODE_FONT, eastAsia: BODY_FONT } : { ascii: 'Calibri', eastAsia: BODY_FONT },
      size: 20,
    })
  })
  return new Paragraph({ indent: { left: 400 }, children: runs })
}

// ---------- 块 ----------

const tableBorders: TableBorders = {
  top: { style: BorderStyle.SINGLE, size: 4, color: '999999' },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: '999999' },
  left: { style: BorderStyle.SINGLE, size: 4, color: '999999' },
  right: { style: BorderStyle.SINGLE, size: 4, color: '999999' },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: '999999' },
  insideVertical: { style: BorderStyle.SINGLE, size: 4, color: '999999' },
}

function tableToDocx(t: ExportTable): Table {
  const aligns = t.align ?? []
  const cellAlign = (i: number): (typeof AlignmentType)[keyof typeof AlignmentType] =>
    aligns[i] === 'center' ? AlignmentType.CENTER : aligns[i] === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT
  const cell = (nodes: InlineNode[], header: boolean, i: number): TableCell =>
    new TableCell({
      shading: header ? { type: ShadingType.CLEAR, fill: 'EEEEEE' } : undefined,
      margins: { top: 80, bottom: 80, left: 100, right: 100 },
      children: [inlineParagraph(nodes, { size: 20, bold: header, align: cellAlign(i) })],
    })
  const rows: TableRow[] = []
  if (t.header.length) {
    rows.push(new TableRow({ tableHeader: true, children: t.header.map((c, i) => cell(c, true, i)) }))
  }
  for (const r of t.rows) {
    rows.push(new TableRow({ children: r.map((c, i) => cell(c, false, i)) }))
  }
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: tableBorders,
    rows,
  })
}

function imageToDocx(img: ExportImage): Paragraph {
  const b64 = img.dataUri.split(',')[1] ?? ''
  const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      new ImageRun({
        type: 'png',
        data,
        transformation: { width: img.width, height: img.height },
      }),
    ],
  })
}
function blockToDocx(block: ExportBlock, numberingRef: string, quote = false): Array<Paragraph | Table> {
  switch (block.kind) {
    case 'heading': {
      const size = headingSize(block.level)
      return [
        new Paragraph({
          heading: headingLevel(block.level),
          spacing: { before: 160, after: 80 },
          children: block.text.map((n) =>
            n.kind === 'link'
              ? (new ExternalHyperlink({
                  link: n.href,
                  children: [new TextRun({ text: flattenText(n.text), style: 'Hyperlink', size })],
                }) as unknown as TextRun)
              : n.kind === 'image'
                ? inlineRun(n, size)
                : new TextRun({
                    text: n.value,
                    bold: true,
                    font: { ascii: 'Calibri', eastAsia: HEADING_FONT },
                    size,
                  })
          ),
        }),
      ]
    }
    case 'paragraph':
      return [quote ? quotedParagraph(block.text) : inlineParagraph(block.text)]
    case 'list': {
      return block.items.flatMap((item, idx) => {
        const paras: Paragraph[] = []
        paras.push(
          new Paragraph({
            numbering: { reference: numberingRef, level: 0 },
            indent: quote ? { left: 400 } : undefined,
            children: item.text.map((n) => (quote ? quotedRun(n) : inlineRun(n))),
          })
        )
        // 子块（嵌套列表等）
        for (const sub of item.children) {
          if (sub.kind === 'list') {
            for (const s of sub.items) {
              paras.push(
                new Paragraph({
                  numbering: { reference: numberingRef, level: 1 },
                  indent: quote ? { left: 400 } : undefined,
                  children: s.text.map((n) => (quote ? quotedRun(n) : inlineRun(n))),
                })
              )
            }
          }
        }
        return paras
      })
    }
    case 'task': {
      return [
        new Paragraph({
          indent: quote ? { left: 400 } : undefined,
          children: [
            new TextRun({ text: block.checked ? '☑ ' : '☐ ', size: 21, color: quote ? '666666' : undefined, italics: quote, font: { ascii: 'Calibri', eastAsia: BODY_FONT } }),
            ...block.text.map((n) => (quote ? quotedRun(n) : inlineRun(n))),
          ],
        }),
      ]
    }
    case 'table':
      return [tableToDocx(block)]
    case 'image':
      return [imageToDocx(block)]
    case 'code': {
      const lines = block.content.split('\n')
      const paras: Paragraph[] = []
      if (block.language) {
        paras.push(
          new Paragraph({
            spacing: { before: 80, after: 0 },
            children: [new TextRun({ text: languageLabel(block.language), size: 16, color: '999999', font: { ascii: CODE_FONT, eastAsia: BODY_FONT } })],
          })
        )
      }
      // 多行代码：每行一个 TextRun，后续行用 break:1（docx 的 text 内 \n 不换行）
      const runs = lines.map((line, i) =>
        new TextRun({
          text: line,
          break: i > 0 ? 1 : undefined,
          font: { ascii: CODE_FONT, eastAsia: BODY_FONT },
          size: 18,
        })
      )
      paras.push(
        new Paragraph({
          shading: { type: ShadingType.CLEAR, fill: 'F5F5F5' },
          spacing: { before: 40, after: 80 },
          children: runs,
        })
      )
      return paras
    }
    case 'quote':
      return block.blocks.flatMap((b) => blockToDocx(b, numberingRef, true))
    case 'hr':
      return [
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' } },
          spacing: { before: 120, after: 120 },
        }),
      ]
    default:
      return []
  }
}

/** 引用块内的行内 run（灰色斜体） */
function quotedRun(n: InlineNode): TextRun | ImageRun {
  if (n.kind === 'image') {
    const b64 = n.dataUri.split(',')[1] ?? ''
    const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    return new ImageRun({ type: 'png', data, transformation: { width: n.width, height: n.height } })
  }
  if (n.kind === 'link' && n.href) {
    return new ExternalHyperlink({
      link: n.href,
      children: [new TextRun({ text: flattenText(n.text), style: 'Hyperlink', size: 20, color: '666666', italics: true })],
    }) as unknown as TextRun
  }
  return new TextRun({
    text: n.value,
    bold: n.bold,
    italics: true,
    strike: n.strike,
    highlight: n.highlight ? 'yellow' : undefined,
    color: '666666',
    font: n.code ? { ascii: CODE_FONT, eastAsia: BODY_FONT } : { ascii: 'Calibri', eastAsia: BODY_FONT },
    size: 20,
  })
}

/** md → DOCX Blob（导出模块内部使用） */
export async function mdBlocksToDocx(blocks: ExportBlock[], title: string): Promise<Blob> {
  const numberingRef = 'export-list'
  const children: Array<Paragraph | Table> = []
  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [new TextRun({ text: title, bold: true, font: { ascii: 'Calibri', eastAsia: HEADING_FONT }, size: 32 })],
    })
  )
  for (const b of blocks) {
    children.push(...blockToDocx(b, numberingRef))
  }
  const doc = new Document({
    numbering: {
      config: [
        {
          reference: numberingRef,
          levels: [
            { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START },
            { level: 1, format: LevelFormat.LOWER_LETTER, text: '%2)', alignment: AlignmentType.START },
          ],
        },
      ],
    },
    sections: [{ properties: {}, children }],
  })
  return await Packer.toBlob(doc)
}
