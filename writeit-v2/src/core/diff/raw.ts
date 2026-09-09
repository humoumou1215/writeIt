import type { RawDiffHunk, RawDiffLine, RawDiffResult } from './types'

type Operation =
  | { readonly kind: 'context'; readonly oldIndex: number; readonly newIndex: number; readonly text: string }
  | { readonly kind: 'removed'; readonly oldIndex: number; readonly text: string }
  | { readonly kind: 'added'; readonly newIndex: number; readonly text: string }

function lines(source: string): string[] {
  const normalized = source.replace(/\r\n?/gu, '\n')
  return normalized.length === 0 ? [] : normalized.split('\n')
}

function operations(before: string, after: string): readonly Operation[] {
  const oldLines = lines(before)
  const newLines = lines(after)
  const lcs: number[][] = Array.from({ length: oldLines.length + 1 }, () =>
    Array<number>(newLines.length + 1).fill(0),
  )
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      lcs[oldIndex][newIndex] = oldLines[oldIndex] === newLines[newIndex]
        ? lcs[oldIndex + 1][newIndex + 1] + 1
        : Math.max(lcs[oldIndex + 1][newIndex], lcs[oldIndex][newIndex + 1])
    }
  }
  const output: Operation[] = []
  let oldIndex = 0
  let newIndex = 0
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (oldIndex < oldLines.length && newIndex < newLines.length && oldLines[oldIndex] === newLines[newIndex]) {
      output.push({ kind: 'context', oldIndex, newIndex, text: oldLines[oldIndex] })
      oldIndex += 1
      newIndex += 1
    } else if (newIndex < newLines.length && (oldIndex >= oldLines.length || lcs[oldIndex][newIndex + 1] >= lcs[oldIndex + 1][newIndex])) {
      output.push({ kind: 'added', newIndex, text: newLines[newIndex] })
      newIndex += 1
    } else {
      output.push({ kind: 'removed', oldIndex, text: oldLines[oldIndex] })
      oldIndex += 1
    }
  }
  return output
}

function toRawLine(operation: Operation): RawDiffLine {
  if (operation.kind === 'context') return { kind: 'context', text: operation.text, oldLine: operation.oldIndex + 1, newLine: operation.newIndex + 1 }
  if (operation.kind === 'added') return { kind: 'added', text: operation.text, newLine: operation.newIndex + 1 }
  return { kind: 'removed', text: operation.text, oldLine: operation.oldIndex + 1 }
}

export function diffMarkdownSource(before: string, after: string, contextLines = 3): RawDiffResult {
  if (typeof before !== 'string' || typeof after !== 'string') throw new TypeError('Diff sources must be strings')
  if (!Number.isSafeInteger(contextLines) || contextLines < 0) throw new RangeError('Diff context must be a non-negative integer')
  const ops = operations(before, after)
  const changed = ops.map((item, index) => item.kind === 'context' ? -1 : index).filter((index) => index >= 0)
  if (changed.length === 0) return Object.freeze({ before, after, hunks: Object.freeze([]), rawChangeCount: 0, representedChangeCount: 0 })
  const hunkRanges: Array<[number, number]> = []
  let start = Math.max(0, changed[0] - contextLines)
  let end = Math.min(ops.length - 1, changed[0] + contextLines)
  for (let index = 1; index < changed.length; index += 1) {
    const nextStart = Math.max(0, changed[index] - contextLines)
    const nextEnd = Math.min(ops.length - 1, changed[index] + contextLines)
    if (nextStart <= end + 1) end = nextEnd
    else {
      hunkRanges.push([start, end])
      start = nextStart
      end = nextEnd
    }
  }
  hunkRanges.push([start, end])
  const hunks: RawDiffHunk[] = []
  let rawChangeCount = 0
  hunkRanges.forEach(([from, to], hunkIndex) => {
    const hunkOps = ops.slice(from, to + 1)
    const rawLines = hunkOps.map(toRawLine)
    const oldChanged = rawLines.filter((line) => line.kind !== 'added')
    const newChanged = rawLines.filter((line) => line.kind !== 'removed')
    rawChangeCount += rawLines.filter((line) => line.kind !== 'context').length
    hunks.push(Object.freeze({
      id: `hunk-${hunkIndex + 1}`,
      oldStart: oldChanged[0]?.oldLine ?? 1,
      oldCount: oldChanged.length,
      newStart: newChanged[0]?.newLine ?? 1,
      newCount: newChanged.length,
      lines: Object.freeze(rawLines),
    }))
  })
  return Object.freeze({ before, after, hunks: Object.freeze(hunks), rawChangeCount, representedChangeCount: rawChangeCount })
}

export function rawChangesAreFullyRepresented(result: RawDiffResult): boolean {
  return result.rawChangeCount === result.representedChangeCount &&
    result.hunks.every((hunk) => hunk.lines.some((line) => line.kind !== 'context'))
}
