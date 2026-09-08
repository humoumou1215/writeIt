import type { OutlineHeading } from './types'

export type { OutlineHeading } from './types'

/** Parse ATX headings into a source-backed hierarchy. */
export function parseOutline(source: string): readonly OutlineHeading[] {
  if (typeof source !== 'string') throw new TypeError('Outline source must be a string')
  const roots: OutlineHeading[] = []
  const stack: OutlineHeading[] = []
  const matcher = /^( {0,3})(#{1,6})[ \t]+(.+?)[ \t]*#?[ \t]*$/gmu
  let match: RegExpExecArray | null
  while ((match = matcher.exec(source)) !== null) {
    const from = match.index + match[1].length
    const newline = source.indexOf('\n', match.index)
    const lineEnd = newline < 0 ? source.length : newline
    const text = match[3].replace(/[ \t]+#?[ \t]*$/u, '').trim()
    const heading: OutlineHeading = { id: `heading-${from}`, text, level: match[2].length, from, to: lineEnd, line: source.slice(0, from).split('\n').length, children: [] }
    while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) stack.pop()
    if (stack.length === 0) roots.push(heading)
    else (stack[stack.length - 1].children as OutlineHeading[]).push(heading)
    stack.push(heading)
  }
  const freeze = (heading: OutlineHeading): OutlineHeading => Object.freeze({ ...heading, children: Object.freeze(heading.children.map(freeze)) })
  return Object.freeze(roots.map(freeze))
}

export function flattenOutline(outline: readonly OutlineHeading[]): readonly OutlineHeading[] {
  const result: OutlineHeading[] = []
  const visit = (items: readonly OutlineHeading[]) => { for (const item of items) { result.push(item); visit(item.children) } }
  visit(outline)
  return Object.freeze(result)
}
