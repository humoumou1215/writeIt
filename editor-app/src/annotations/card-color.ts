// 批注级别颜色（抽屉/连线共用）
import type { Annotation } from './service'

export const LEVEL_COLOR: Record<Annotation['level'], string> = {
  info: '#8a8a8a',
  warning: '#e6a23c',
  error: '#d9534f',
  comment: '#b58900',
}
