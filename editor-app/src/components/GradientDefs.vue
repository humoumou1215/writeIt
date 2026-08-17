<script setup lang="ts">
// 多彩渐变套的全局共享 defs（App 渲染一次即可）。
// 所有 MenuIcon(gradient) 引用固定 id（wi-g-*），避免每实例重复定义与 id 冲突。
// 停靠色可用 CSS 变量覆盖（--wi-g-*），默认值贴合应用 Logo 的暖橙品牌色。
const GRADIENTS = [
  { id: 'wi-g-files', a: '#38bdf8', b: '#6366f1' },
  { id: 'wi-g-file', a: '#7dd3fc', b: '#60a5fa' },
  { id: 'wi-g-git', a: '#a78bfa', b: '#ec4899' },
  { id: 'wi-g-settings', a: '#fbbf24', b: '#f97316' },
  { id: 'wi-g-shortcuts', a: '#2dd4bf', b: '#22c55e' },
  { id: 'wi-g-export', a: '#818cf8', b: '#a855f7' },
  { id: 'wi-g-search', a: '#22d3ee', b: '#3b82f6' },
  { id: 'wi-g-accent', a: '#94a3b8', b: '#64748b' },
] as const
</script>

<template>
  <svg data-grad-defs width="0" height="0" style="position: absolute" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient v-for="g in GRADIENTS" :key="g.id" :id="g.id" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" :stop-color="`var(--${g.id}-a, ${g.a})`" />
        <stop offset="1" :stop-color="`var(--${g.id}-b, ${g.b})`" />
      </linearGradient>
    </defs>
  </svg>
</template>