import { diffLines, type Change } from 'diff'

export function markdownDiff(oldMarkdown: string, newMarkdown: string): Change[] {
  return diffLines(oldMarkdown, newMarkdown)
}

export function renderDiff(chunks: Change[]): string {
  return chunks
    .map((chunk) => {
      const className = chunk.added ? 'diff-added' : chunk.removed ? 'diff-removed' : 'diff-same'
      const prefix = chunk.added ? '+' : chunk.removed ? '-' : ' '
      return `<span class="${className}">${escapeHtml(chunk.value).replace(/\n/g, `\n${prefix}`)}</span>`
    })
    .join('')
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
