// M13：diff 节点插件包——组合 md 的标注渲染
//   {--删除--} / {++新增++} → 内联高亮（红底划线 / 绿底）
//   ::: diff-add / diff-del / diff-mod → 块级容器（绿底 / 红底划线 / 旧新拼接）
import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import { diffDelSchema, diffInsSchema } from './schema'
import { remarkDiffInline } from './remark-inline'
import './styles.css'

// M13：diff 节点——内联 {-- --}/{++ ++} 标注（块级用标准 fenced code 语言标注，渲染后加类）
export const diffPlugin: MilkdownPlugin[] = [
  ...remarkDiffInline,
  ...diffDelSchema,
  ...diffInsSchema,
]
