import type { ObjectDirective } from 'vue'

const cleanups = new WeakMap<HTMLElement, () => void>()
const focusable = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex="0"]'

/** Native disclosure with mixed form controls: Tab stays native, Escape restores its trigger. */
export const vDisclosure: ObjectDirective<HTMLDetailsElement> = {
  mounted(root, binding) {
    const summary = root.querySelector('summary')!
    const close = (restore = false) => {
      if (!root.open) return
      root.open = false
      if (restore) summary.focus()
    }
    const pointer = (event: PointerEvent) => {
      if (!binding.modifiers.persistent && !root.contains(event.target as Node)) close()
    }
    const focus = (event: FocusEvent) => {
      if (!binding.modifiers.persistent && !root.contains(event.target as Node)) close()
    }
    const key = (event: KeyboardEvent) => {
      if (event.isComposing || event.defaultPrevented) return
      if (event.key === 'Escape' && root.open) {
        event.preventDefault()
        event.stopPropagation()
        close(true)
      } else if (event.target === summary && event.key === 'ArrowDown') {
        event.preventDefault()
        root.open = true
        ;[...root.querySelectorAll<HTMLElement>(focusable)].find(el => el !== summary && el.getClientRects().length > 0)?.focus()
      }
    }
    const action = (event: MouseEvent) => {
      if (binding.modifiers.actions && (event.target as Element).closest('button')) close(true)
    }
    root.addEventListener('click', action)
    root.addEventListener('keydown', key)
    document.addEventListener('pointerdown', pointer)
    document.addEventListener('focusin', focus)
    cleanups.set(root, () => {
      root.removeEventListener('click', action)
      root.removeEventListener('keydown', key)
      document.removeEventListener('pointerdown', pointer)
      document.removeEventListener('focusin', focus)
    })
  },
  unmounted(root) { cleanups.get(root)?.(); cleanups.delete(root) },
}

/** Modal focus boundary; background becomes inert without changing editor lifecycle. */
export const vModalFocus: ObjectDirective<HTMLElement, () => void> = {
  mounted(root, binding) {
    const previous = document.activeElement as HTMLElement | null
    const siblings: Array<{ element: HTMLElement; inert: boolean }> = []
    let child: HTMLElement = root
    while (child.parentElement && child.parentElement !== document.body) {
      for (const sibling of child.parentElement.children) {
        if (sibling !== child && sibling instanceof HTMLElement) {
          siblings.push({ element: sibling, inert: sibling.inert })
          sibling.inert = true
        }
      }
      child = child.parentElement
    }
    const controls = () => [...root.querySelectorAll<HTMLElement>(focusable)].filter(el => el.getClientRects().length > 0)
    const key = (event: KeyboardEvent) => {
      if (event.isComposing || event.defaultPrevented) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        binding.value()
      }
      if (event.key === 'Tab') {
        const items = controls()
        const first = items[0], last = items.at(-1)
        if (!first) { event.preventDefault(); root.focus(); return }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) {
          event.preventDefault(); last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus()
        }
      }
    }
    root.tabIndex = -1
    root.addEventListener('keydown', key)
    ;(controls()[0] ?? root).focus()
    cleanups.set(root, () => {
      root.removeEventListener('keydown', key)
      for (const { element, inert } of siblings) element.inert = inert
      if (previous?.isConnected) previous.focus()
    })
  },
  unmounted(root) { cleanups.get(root)?.(); cleanups.delete(root) },
}

/** Context actions are transient, and never make the workspace modal. */
export const vContextFocus: ObjectDirective<HTMLElement, () => void> = {
  mounted(root, binding) {
    const previous = document.activeElement as HTMLElement | null
    const key = (event: KeyboardEvent) => {
      if (event.isComposing || event.defaultPrevented) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        binding.value()
        return
      }
      if (event.key === 'Tab') {
        const items = [...root.querySelectorAll<HTMLElement>(focusable)].filter(
          (element) => element.getClientRects().length > 0,
        )
        if (items.length === 0) return
        const current = items.indexOf(document.activeElement as HTMLElement)
        const next = items[(current + (event.shiftKey ? -1 : 1) + items.length) % items.length]
        event.preventDefault()
        event.stopPropagation()
        next?.focus()
      }
    }
    const outside = (event: Event) => {
      if (!root.contains(event.target as Node)) binding.value()
    }
    root.addEventListener('keydown', key)
    root.querySelector<HTMLElement>(focusable)?.focus()
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', outside)
    cleanups.set(root, () => {
      root.removeEventListener('keydown', key)
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('focusin', outside)
      if ((root.contains(document.activeElement) || document.activeElement === document.body) && previous?.isConnected) previous.focus()
    })
  },
  unmounted(root) { cleanups.get(root)?.(); cleanups.delete(root) },
}
