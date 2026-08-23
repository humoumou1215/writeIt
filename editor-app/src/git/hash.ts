// 内容指纹（M18 §4.6 新鲜度契约 / §4.7 批量端点 hash）
// FNV-1a 32 位——足够检测磁盘内容变化，跨后端（mock/dev/tauri/前端）实现一致。
// 前端与后端都用同一实现，避免「同一内容两处 hash 不同」的漂移。
export function contentHash(content: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < content.length; i++) {
    h ^= content.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** 空内容（新文件/缺失）的统一 hash */
export const EMPTY_HASH = contentHash('')

export interface HashPair {
  old: string
  next: string
}

export function hashPair(oldMd: string | null, newMd: string | null): HashPair | null {
  if (oldMd == null && newMd == null) return null
  return { old: contentHash(oldMd ?? ''), next: contentHash(newMd ?? '') }
}