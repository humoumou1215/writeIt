// 点击光斑反馈（共享工具）——图片与 Mermaid 图表通用。
// 在点击处显示一个一次性淡黄色光斑（fixed 定位、约 420ms 放大+淡出后自动移除）。
// 独立成模块以免 mermaid / 图片预览弹层耦合到编辑器主插件（editor-menu 是 Milkdown 插件）。

let spotCounter = 0
export function showClickSpot(x: number, y: number): void {
  const spot = document.createElement('div')
  spot.id = `writeit-click-spot-${++spotCounter}`
  Object.assign(spot.style, {
    position: 'fixed',
    left: `${x}px`,
    top: `${y}px`,
    width: '52px',
    height: '52px',
    borderRadius: '50%',
    transform: 'translate(-50%,-50%)',
    pointerEvents: 'none',
    zIndex: '2147483647',
    background:
      'radial-gradient(circle, rgba(255,213,79,.95) 0%, rgba(255,213,79,.55) 52%, rgba(255,213,79,0) 100%)',
  })
  document.body.appendChild(spot)
  try {
    spot.animate(
      [
        { transform: 'translate(-50%,-50%) scale(.4)', opacity: 1 },
        { transform: 'translate(-50%,-50%) scale(3.4)', opacity: 0 },
      ],
      { duration: 540, easing: 'ease-out' }
    ).onfinish = () => spot.remove()
  } catch {
    /* 不支持 WAAPI 的极端环境：直接移除 */
  }
  // 安全兜底：动画禁用 / 提前中断时也移除
  setTimeout(() => spot.remove(), 640)
}
