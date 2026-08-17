<script setup lang="ts">
// 统一图标组件：三套风格（细线 / 圆润双色 / 多彩渐变）×
//   菜单栏 5 功能（files git settings shortcuts export）
//   文件树图标（folder file fileNew dirNew refresh locate pin rename chevron）
//
// 动画策略：闲置时完全静止；仅鼠标悬停时触发轻动画（尊重 prefers-reduced-motion）。
//   菜单栏：文件夹点头×2、Git 分支线流动、齿轮持续慢转、按键涟漪、导出箭头弹跳
//   工具：刷新转一圈、定位十字闪烁
//
// 渐变采用全局共享 defs（GradientDefs 组件在 App.vue 渲染一次），
// 避免每个实例重复定义、也避免 id 冲突；引用固定 id（wi-g-*）。

export type MenuIconName =
  | 'files' | 'git' | 'settings' | 'shortcuts' | 'export' | 'search'
  | 'folder' | 'file' | 'fileNew' | 'dirNew'
  | 'refresh' | 'locate' | 'pin' | 'rename' | 'chevron'
export type MenuIconSet = 'line' | 'soft' | 'gradient'

withDefaults(
  defineProps<{ name: MenuIconName; set?: MenuIconSet; size?: number }>(),
  { set: 'line', size: 16 }
)

// 齿轮（8 齿 + 中心孔），evenodd 一次绘制
const GEAR =
  'M12.00,2.20L15.14,4.42L18.93,5.07L19.58,8.86L21.80,12.00L19.58,15.14L18.93,18.93L15.14,19.58L12.00,21.80L8.86,19.58L5.07,18.93L4.42,15.14L2.20,12.00L4.42,8.86L5.07,5.07L8.86,4.42Z M12,8.5a3.5,3.5 0 1 0 0.001,0Z'

const FOLDER =
  'M3.2 7.2a2 2 0 0 1 2-2h3.9l1.9 2.3h7.8a2 2 0 0 1 2 2v7.6a2 2 0 0 1-2 2H5.2a2 2 0 0 1-2-2Z'
const FILE =
  'M6.5 3.5a2.5 2.5 0 0 0-2.5 2.5v12a2.5 2.5 0 0 0 2.5 2.5h9.2a2.5 2.5 0 0 0 2.5-2.5V9.2L14.4 3.5Z'
const FILE_FOLD = 'M14.4 3.5v4.6h4.6'
const PLUS_BOX = 'M14.4 14.6h4.2M16.5 12.5v4.2'
</script>

<template>
  <svg
    class="mi"
    :class="[`mi-${name}`, `set-${set}`]"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <!-- ================= 细线 ================= -->
    <g v-if="set === 'line'" class="mi-g">
      <!-- 菜单栏 -->
      <template v-if="name === 'files'">
        <path :d="FOLDER" /><path d="M3.2 10.6h17.6" />
      </template>
      <template v-else-if="name === 'git'">
        <circle cx="6.2" cy="5.8" r="2.1" /><circle cx="6.2" cy="18.2" r="2.1" />
        <circle cx="17.8" cy="7.4" r="2.1" />
        <path class="mi-flow" d="M6.2 7.9v8.2" />
        <path class="mi-flow mi-flow-rev" d="M6.2 9.4c0 5.6 4.1 6.3 11.6 4.1" />
      </template>
      <template v-else-if="name === 'settings'">
        <path fill-rule="evenodd" :d="GEAR" />
      </template>
      <template v-else-if="name === 'shortcuts'">
        <rect x="2.6" y="6.2" width="18.8" height="11.6" rx="2.2" />
        <g class="mi-keys">
          <path d="M6.4 9.5h.01" /><path d="M10.1 9.5h.01" />
          <path d="M13.8 9.5h.01" /><path d="M17.5 9.5h.01" />
        </g>
        <g class="mi-keys" style="animation-delay: 0.4s">
          <path d="M6.4 13h.01" /><path d="M10.1 13h.01" />
          <path d="M13.8 13h.01" /><path d="M17.5 13h.01" />
        </g>
        <path d="M8.2 16.3h7.6" />
      </template>
      <template v-else-if="name === 'export'">
        <g class="mi-arrow">
          <path d="M12 3.8v7.4" /><path d="M8.4 7.4 12 3.8l3.6 3.6" />
        </g>
        <path d="M4.6 14v3.2a2.2 2.2 0 0 0 2.2 2.2h10.4a2.2 2.2 0 0 0 2.2-2.2V14" />
      </template>
      <template v-else-if="name === 'search'">
        <g class="mi-scan">
          <circle cx="10.2" cy="10.2" r="6.1" />
          <path d="M14.7 14.7 20 20" />
        </g>
      </template>
      <!-- 文件树 -->
      <template v-else-if="name === 'folder'">
        <path :d="FOLDER" />
      </template>
      <template v-else-if="name === 'file'">
        <path :d="FILE" /><path :d="FILE_FOLD" />
        <path d="M8 12.4h6.4M8 15.4h3.6" />
      </template>
      <template v-else-if="name === 'fileNew'">
        <path :d="FILE" /><path :d="FILE_FOLD" />
        <path :d="PLUS_BOX" />
      </template>
      <template v-else-if="name === 'dirNew'">
        <path :d="FOLDER" /><path :d="PLUS_BOX" />
      </template>
      <template v-else-if="name === 'refresh'">
        <path d="M20 12a8 8 0 1 1-2.34-5.66" />
        <path d="M20 4v4h-4" />
      </template>
      <template v-else-if="name === 'locate'">
        <circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.5" />
        <path d="M12 2.6v2.3M12 19.1v2.3M2.6 12h2.3M19.1 12h2.3" />
      </template>
      <template v-else-if="name === 'pin'">
        <path d="M9.2 3.6h5.6l-1 5 2.6 2.6v2.3H7.6v-2.3l2.6-2.6Z" />
        <path d="M12 13.5v6.9" />
      </template>
      <template v-else-if="name === 'rename'">
        <path d="M4.2 19.8l.9-3.6L16.4 4.9a2.1 2.1 0 0 1 3 3L8.1 19.2l-3.9.6Z" />
        <path d="M14.6 6.7l2.9 2.9" />
      </template>
      <template v-else-if="name === 'chevron'">
        <path d="M9.2 5.4l6.6 6.6-6.6 6.6" />
      </template>
    </g>

    <!-- ================= 圆润双色 ================= -->
    <g v-else-if="set === 'soft'" class="mi-g">
      <template v-if="name === 'files'">
        <path class="mi-soft" :d="FOLDER" />
        <path class="mi-pri" d="M8.3 11.9a1 1 0 0 1 1-1h5.4a1 1 0 0 1 1 1v4.3H8.3Z" />
      </template>
      <template v-else-if="name === 'git'">
        <path class="mi-soft-stroke mi-flow" d="M6.2 7.9v8.2" />
        <path class="mi-soft-stroke mi-flow mi-flow-rev" d="M6.4 9.5c0 5.4 3.9 6.1 11.3 4" />
        <circle class="mi-pri" cx="6.2" cy="5.8" r="2.3" />
        <circle class="mi-pri" cx="6.2" cy="18.2" r="2.3" />
        <circle class="mi-pri" cx="17.8" cy="7.4" r="2.3" />
      </template>
      <template v-else-if="name === 'settings'">
        <path class="mi-pri" fill-rule="evenodd" :d="GEAR" />
      </template>
      <template v-else-if="name === 'shortcuts'">
        <rect class="mi-soft" x="2.6" y="6.2" width="18.8" height="11.6" rx="2.4" />
        <g class="mi-keys">
          <rect class="mi-pri" x="6.4" y="8.9" width="2" height="2" rx="0.6" />
          <rect class="mi-soft-dark" x="10.1" y="8.9" width="2" height="2" rx="0.6" />
          <rect class="mi-pri" x="13.8" y="8.9" width="2" height="2" rx="0.6" />
          <rect class="mi-soft-dark" x="17.5" y="8.9" width="2" height="2" rx="0.6" />
        </g>
        <g class="mi-keys" style="animation-delay: 0.4s">
          <rect class="mi-soft-dark" x="6.4" y="12.4" width="2" height="2" rx="0.6" />
          <rect class="mi-pri" x="10.1" y="12.4" width="2" height="2" rx="0.6" />
          <rect class="mi-soft-dark" x="13.8" y="12.4" width="2" height="2" rx="0.6" />
          <rect class="mi-pri" x="17.5" y="12.4" width="2" height="2" rx="0.6" />
        </g>
        <rect class="mi-pri" x="8.2" y="15.9" width="7.6" height="1.7" rx="0.85" />
      </template>
      <template v-else-if="name === 'export'">
        <path
          class="mi-soft"
          d="M4.6 13.8a2.2 2.2 0 0 1 2.2-2.2h10.4a2.2 2.2 0 0 1 2.2 2.2v2.8a2.2 2.2 0 0 1-2.2 2.2H6.8a2.2 2.2 0 0 1-2.2-2.2Z"
        />
        <g class="mi-arrow">
          <path class="mi-pri-stroke" d="M12 4v7.2" />
          <path class="mi-pri-stroke" d="M8.4 7.6 12 4l3.6 3.6" />
        </g>
      </template>
      <template v-else-if="name === 'search'">
        <g class="mi-scan">
          <circle class="mi-pri" cx="10.2" cy="10.2" r="6.1" />
          <circle cx="10.2" cy="10.2" r="2.5" fill="color-mix(in srgb, var(--chrome-background) 70%, transparent)" />
          <path class="mi-pri-stroke" d="M14.7 14.7 20 20" />
        </g>
      </template>
      <!-- 文件树 -->
      <template v-else-if="name === 'folder'">
        <path class="mi-soft" :d="FOLDER" />
        <path class="mi-pri" d="M3.2 9.9h17.6" opacity="0.9" />
      </template>
      <template v-else-if="name === 'file'">
        <path class="mi-soft" :d="FILE" />
        <path class="mi-pri" d="M8 12.2h6.8M8 15.2h3.2" />
      </template>
      <template v-else-if="name === 'fileNew' || name === 'dirNew'">
        <template v-if="name === 'fileNew'">
          <path class="mi-soft" :d="FILE" />
        </template>
        <template v-else>
          <path class="mi-soft" :d="FOLDER" />
        </template>
        <g class="mi-pri">
          <path d="M14.4 14.6h4.2M16.5 12.5v4.2" stroke-width="1.9" stroke-linecap="round" />
          <path d="M14.4 12.8a2.4 2.4 0 0 1 2.4-2.4h.1a2.4 2.4 0 0 1 2.4 2.4v2.1a2.4 2.4 0 0 1-2.4 2.4h-.1a2.4 2.4 0 0 1-2.4-2.4Z"
            fill="none" stroke-width="1.7" />
        </g>
      </template>
      <template v-else-if="name === 'refresh'">
        <path class="mi-soft-stroke" d="M20 12a8 8 0 1 1-2.34-5.66" />
        <path class="mi-soft-stroke" d="M20 4v4h-4" />
        <circle class="mi-pri" cx="12" cy="12" r="1.6" />
      </template>
      <template v-else-if="name === 'locate'">
        <circle class="mi-soft" cx="12" cy="12" r="7.4" />
        <circle class="mi-pri" cx="12" cy="12" r="2.5" />
        <g class="mi-cross">
          <path class="mi-pri-stroke" d="M12 2.8v2.2M12 19v2.2M2.8 12H5M19 12h2.2" />
        </g>
      </template>
      <template v-else-if="name === 'pin'">
        <path class="mi-pri" d="M9.2 3.6h5.6l-1 5 2.6 2.6v2.3H7.6v-2.3l2.6-2.6Z" />
        <path class="mi-soft-dark" d="M12 13.5v6.9" stroke-width="2.1" />
      </template>
      <template v-else-if="name === 'rename'">
        <path class="mi-pri" d="M4.2 19.8l.9-3.6L16.4 4.9a2.1 2.1 0 0 1 3 3L8.1 19.2l-3.9.6Z" />
        <path class="mi-soft-dark" d="M14.6 6.7l2.9 2.9" />
      </template>
      <template v-else-if="name === 'chevron'">
        <path class="mi-soft-dark" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"
          d="M9.4 5.6l6.4 6.4-6.4 6.4" />
      </template>
    </g>

    <!-- ================= 多彩渐变（几何同上，填充引用全局共享 defs） ================= -->
    <g v-else-if="set === 'gradient'" class="mi-g">
      <template v-if="name === 'files'">
        <path :fill="`url(#wi-g-files)`" :d="FOLDER" />
        <path d="M3.2 10.6h17.6" stroke="rgba(255,255,255,.5)" stroke-width="1.2" />
      </template>
      <template v-else-if="name === 'git'">
        <path class="mi-flow" :stroke="`url(#wi-g-git)`" stroke-width="2.6" stroke-linecap="round" d="M6.2 7.9v8.2" />
        <path class="mi-flow mi-flow-rev" :stroke="`url(#wi-g-git)`" stroke-width="2.6" stroke-linecap="round"
          d="M6.4 9.5c0 5.4 3.9 6.1 11.3 4" />
        <circle :fill="`url(#wi-g-git)`" cx="6.2" cy="5.8" r="2.3" />
        <circle :fill="`url(#wi-g-git)`" cx="6.2" cy="18.2" r="2.3" />
        <circle :fill="`url(#wi-g-git)`" cx="17.8" cy="7.4" r="2.3" />
      </template>
      <template v-else-if="name === 'settings'">
        <path fill-rule="evenodd" :fill="`url(#wi-g-settings)`" :d="GEAR" />
      </template>
      <template v-else-if="name === 'shortcuts'">
        <rect :fill="`url(#wi-g-shortcuts)`" x="2.6" y="6.2" width="18.8" height="11.6" rx="2.4" />
        <g class="mi-keys" fill="rgba(255,255,255,.6)">
          <rect x="6.4" y="8.9" width="2" height="2" rx="0.6" />
          <rect x="10.1" y="8.9" width="2" height="2" rx="0.6" />
          <rect x="13.8" y="8.9" width="2" height="2" rx="0.6" />
          <rect x="17.5" y="8.9" width="2" height="2" rx="0.6" />
          <rect x="6.4" y="12.4" width="2" height="2" rx="0.6" />
          <rect x="10.1" y="12.4" width="2" height="2" rx="0.6" />
          <rect x="13.8" y="12.4" width="2" height="2" rx="0.6" />
          <rect x="17.5" y="12.4" width="2" height="2" rx="0.6" />
        </g>
        <rect fill="rgba(255,255,255,.75)" x="8.2" y="15.9" width="7.6" height="1.7" rx="0.85" />
      </template>
      <template v-else-if="name === 'export'">
        <path :fill="`url(#wi-g-export)`"
          d="M4.6 13.8a2.2 2.2 0 0 1 2.2-2.2h10.4a2.2 2.2 0 0 1 2.2 2.2v2.8a2.2 2.2 0 0 1-2.2 2.2H6.8a2.2 2.2 0 0 1-2.2-2.2Z" />
        <g class="mi-arrow" :stroke="`url(#wi-g-export)`" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 4v7.2" /><path d="M8.4 7.6 12 4l3.6 3.6" />
        </g>
      </template>
      <template v-else-if="name === 'search'">
        <g class="mi-scan">
          <circle :fill="`url(#wi-g-search)`" cx="10.2" cy="10.2" r="6.1" />
          <circle cx="10.2" cy="10.2" r="2.5" fill="rgba(255,255,255,.9)" />
          <path :stroke="`url(#wi-g-search)`" stroke-width="2.4" stroke-linecap="round" d="M14.7 14.7 20 20" />
        </g>
      </template>
      <!-- 文件树 -->
      <template v-else-if="name === 'folder'">
        <path :fill="`url(#wi-g-files)`" :d="FOLDER" />
        <path d="M3.2 10.6h17.6" stroke="rgba(255,255,255,.5)" stroke-width="1.2" />
      </template>
      <template v-else-if="name === 'file'">
        <path :fill="`url(#wi-g-file)`" :d="FILE" />
        <path :d="FILE_FOLD" stroke="rgba(255,255,255,.55)" stroke-width="1.2" />
        <path d="M8 12.2h5.8M8 15.2h3" stroke="rgba(255,255,255,.55)" stroke-width="1.2" />
      </template>
      <template v-else-if="name === 'fileNew' || name === 'dirNew'">
        <template v-if="name === 'fileNew'">
          <path :fill="`url(#wi-g-file)`" :d="FILE" />
        </template>
        <template v-else>
          <path :fill="`url(#wi-g-files)`" :d="FOLDER" />
        </template>
        <path :fill="`url(#wi-g-accent)`" d="M14.4 12.8a2.4 2.4 0 0 1 2.4-2.4h.1a2.4 2.4 0 0 1 2.4 2.4v2.1a2.4 2.4 0 0 1-2.4 2.4h-.1a2.4 2.4 0 0 1-2.4-2.4Z" />
        <path d="M14.4 15.9h4.2M16.5 13.8v4.2" stroke="rgba(255,255,255,.85)" stroke-width="1.5" stroke-linecap="round"
          transform="translate(0,1.1)" />
      </template>
      <template v-else-if="name === 'refresh'">
        <path :stroke="`url(#wi-g-shortcuts)`" stroke-width="2.4" stroke-linecap="round" d="M20 12a8 8 0 1 1-2.34-5.66" />
        <path :stroke="`url(#wi-g-shortcuts)`" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"
          d="M20 4v4h-4" />
        <circle :fill="`url(#wi-g-shortcuts)`" cx="12" cy="12" r="1.6" />
      </template>
      <template v-else-if="name === 'locate'">
        <circle :fill="`url(#wi-g-export)`" cx="12" cy="12" r="7.2" opacity="0.92" />
        <circle cx="12" cy="12" r="2.5" fill="rgba(255,255,255,.92)" />
        <g class="mi-cross">
          <path :stroke="`url(#wi-g-export)`" stroke-width="2" stroke-linecap="round"
            d="M12 2.8v2.2M12 19v2.2M2.8 12H5M19 12h2.2" />
        </g>
      </template>
      <template v-else-if="name === 'pin'">
        <path :fill="`url(#wi-g-settings)`" d="M9.2 3.6h5.6l-1 5 2.6 2.6v2.3H7.6v-2.3l2.6-2.6Z" />
        <path d="M12 13.5v6.9" :stroke="`url(#wi-g-settings)`" stroke-width="2.1" stroke-linecap="round" />
      </template>
      <template v-else-if="name === 'rename'">
        <path :fill="`url(#wi-g-git)`" d="M4.2 19.8l.9-3.6L16.4 4.9a2.1 2.1 0 0 1 3 3L8.1 19.2l-3.9.6Z" />
        <path d="M14.6 6.7l2.9 2.9" stroke="rgba(255,255,255,.6)" stroke-width="1.4" stroke-linecap="round" />
      </template>
      <template v-else-if="name === 'chevron'">
        <path :stroke="`url(#wi-g-accent)`" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"
          d="M9.4 5.6l6.4 6.4-6.4 6.4" />
      </template>
    </g>
  </svg>
</template>

<style scoped>
.mi {
  display: block;
  transition: transform 0.16s cubic-bezier(0.34, 1.56, 0.64, 1);
  will-change: transform;
}
/* 交互缩放：菜单栏与工具栏按钮 */
:global(.icon-btn:hover .mi),
:global(.icon-btn.active .mi),
:global(.mini:hover .mi) {
  transform: translateY(-1px) scale(1.08);
}
:global(.icon-btn:active .mi),
:global(.mini:active .mi) {
  transform: translateY(0) scale(0.86);
}

/* ---------- 描边/填充 工具类 ---------- */
.set-line .mi-g,
.set-line .mi-flow,
.set-line .mi-keys,
.set-line .mi-arrow,
.set-line .mi-cross {
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.set-soft .mi-soft {
  fill: color-mix(in srgb, currentColor 18%, transparent);
}
.set-soft .mi-soft-dark {
  fill: color-mix(in srgb, currentColor 34%, transparent);
}
.set-soft .mi-soft-stroke {
  stroke: color-mix(in srgb, currentColor 30%, transparent);
  stroke-width: 2.4;
  stroke-linecap: round;
}
.set-soft .mi-pri {
  fill: var(--chrome-primary);
}
.set-soft .mi-pri-stroke {
  stroke: var(--chrome-primary);
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* ---------- 微动画：仅悬停触发（闲置完全静止） ---------- */
.mi-g {
  transform-box: fill-box;
  transform-origin: center;
}
@keyframes mi-nod {
  0% { transform: rotate(0deg); }
  30% { transform: rotate(-6deg); }
  55% { transform: rotate(4deg); }
  80% { transform: rotate(-2deg); }
  100% { transform: rotate(0deg); }
}
@keyframes mi-spin { to { transform: rotate(360deg); } }
@keyframes mi-pop {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-2.6px); }
}
@keyframes mi-flow { to { stroke-dashoffset: -13; } }
@keyframes mi-flow-rev-kf { to { stroke-dashoffset: 18; } }
@keyframes mi-key {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
@keyframes mi-pan {
  0%, 100% { transform: translateX(0); }
  50% { transform: translateX(2.2px); }
}
@keyframes mi-refresh-spin { to { transform: rotate(360deg); } }
@keyframes mi-cross-blink {
  0%, 100% { opacity: 0.9; }
  50% { opacity: 0.15; }
}

/* 菜单栏五件套：悬停时动 */
:global(.icon-btn:hover .mi-files .mi-g) { animation: mi-nod 1.3s ease-in-out 2; }
:global(.icon-btn:hover .mi-settings .mi-g) { animation: mi-spin 1.8s linear infinite; }
:global(.icon-btn:hover .mi-git .mi-flow) { animation: mi-flow 1.2s linear infinite; }
:global(.icon-btn:hover .mi-git .mi-flow-rev) { animation: mi-flow-rev-kf 1.8s linear infinite; }
:global(.icon-btn:hover .mi-shortcuts .mi-keys) { animation: mi-key 1.3s ease-in-out infinite; }
:global(.icon-btn:hover .mi-export .mi-arrow) { animation: mi-pop 0.9s ease-in-out infinite; }
:global(.icon-btn:hover .mi-search .mi-scan) { animation: mi-pan 1.4s ease-in-out infinite; }

/* 工具栏：刷新转一圈 / 定位十字闪烁（仅悬停） */
:global(.mini:hover .mi-refresh .mi-g),
:global(.mini:active .mi-refresh .mi-g) { animation: mi-refresh-spin 0.7s ease-out 1; }
:global(.mini:hover .mi-locate .mi-cross) { animation: mi-cross-blink 0.9s ease-in-out infinite; }

/* 流动描边默认静止（悬停时才动） */
.mi-flow {
  stroke-dasharray: 4 9;
  animation: none;
}
.mi-flow-rev {
  stroke-dasharray: 6 12;
  animation: none;
}
.mi-keys,
.mi-arrow,
.mi-cross {
  animation: none;
}

@media (prefers-reduced-motion: reduce) {
  .mi,
  .mi-g,
  .mi-flow,
  .mi-keys,
  .mi-arrow,
  .mi-cross {
    animation: none !important;
    transition: none !important;
  }
}
</style>