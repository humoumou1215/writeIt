// ============================================================
// 剪贴板写入工具（共享）
//  ① Async Clipboard API（用户手势内调用会触发浏览器/WebView 的剪贴板授权询问）
//  ② 失败回退旧式 execCommand('copy')（无需授权，受限 WebView / 非安全上下文仍可用）
//  仍失败返回 false → 调用方弹出授权申请弹窗（ClipboardAuthModal）
// ============================================================

/** 尽力写入剪贴板文本；成功返回 true */
export async function writeClipboardText(text: string): Promise<boolean> {
  // ① Async Clipboard API（Firefox/Chromium 首次在用户手势内调用时会弹「是否允许写入」授权询问）
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* 未授权/窗口失焦/受限 → 落旧式兜底 */
  }

  // ② 旧式 execCommand：不要求 async clipboard 授权，WebView2/WKWebView/WebKitGTK 与
  //    非安全上下文（http 非 localhost）大多可用；用户手势内调用即生效。
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '0'
    ta.style.left = '0'
    ta.style.opacity = '0'
    ta.style.zIndex = '-1'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    ta.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    ta.remove()
    if (ok) return true
  } catch {
    /* 都失败 */
  }
  return false
}

/** 剪贴板写入权限状态（不支持该权限名时返回 null） */
export async function clipboardWritePermission(): Promise<PermissionState | null> {
  try {
    const p = await navigator.permissions.query({ name: 'clipboard-write' as PermissionName })
    return p.state
  } catch {
    return null
  }
}
