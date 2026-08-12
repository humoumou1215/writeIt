// 校验 decorations（设计文档 §5.2 通道①：文档内标注）
// 在违规位置叠加 ⚠ 徽标（widget decoration）——不改动文档本身，保存即消失（未写入 doc）。
// 从 ValidateService 缓存读取结果（decorations 随每次 view.update 重算；
// service 校验完成后 dispatch 空事务 setMeta('validateRefresh') 触发重绘）。
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import type { ValidationResult } from './service'

export const validatePluginKey = new PluginKey<DecorationSet>('validate-decorations')

export function validateDecorationsPlugin(
  getResult: () => ValidationResult | null
): Plugin {
  return new Plugin({
    key: validatePluginKey,
    state: {
      init: () => DecorationSet.empty,
      apply: (tr, set) => {
        if (tr.getMeta('validateRefresh')) {
          // 校验结果更新 → 依据新 doc 重建 decorations
          const result = getResult()
          const decorations: Decoration[] = []
          if (result && !result.failed) {
            for (const v of result.violations) {
              if (v.pos == null) continue
              if (v.pos < 0 || v.pos > tr.doc.content.size) continue
              const dom = document.createElement('span')
              dom.className = 'validate-mark'
              dom.dataset.level = v.level
              dom.title = v.message
              dom.textContent = '⚠'
              decorations.push(
                Decoration.widget(v.pos, dom, {
                  side: -1,
                  stopEvent: () => true,
                })
              )
            }
          }
          return DecorationSet.create(tr.doc, decorations)
        }
        return set.map(tr.mapping, tr.doc)
      },
    },
    props: {
      decorations: (state) => {
        const pluginState = validatePluginKey.getState(state)
        return pluginState ?? DecorationSet.empty
      },
    },
  })
}
