export interface OutlineHeading {
  readonly id: string
  readonly text: string
  readonly level: number
  readonly from: number
  readonly to: number
  readonly line: number
  readonly children: readonly OutlineHeading[]
}
