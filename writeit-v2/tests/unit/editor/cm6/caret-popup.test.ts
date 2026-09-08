// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import {
  computeCaretPopupPlacement,
  intersectPopupRectangles,
  scrollPopupOptionIntoView,
} from '../../../../src/editor/cm6/caret-popup'

const boundary = { left: 0, right: 800, top: 0, bottom: 600 }

function caret(left: number, top: number) {
  return { left, right: left + 1, top, bottom: top + 20 }
}

describe('caret popup geometry', () => {
  it('prefers below the caret when the popup fits', () => {
    expect(
      computeCaretPopupPlacement({
        caret: caret(120, 100),
        boundary,
        popupWidth: 240,
        popupHeight: 180,
      }),
    ).toEqual({
      left: 120,
      top: 124,
      maxWidth: 784,
      maxHeight: 180,
      side: 'below',
    })
  })

  it('flips above and constrains height near the lower boundary', () => {
    expect(
      computeCaretPopupPlacement({
        caret: caret(120, 550),
        boundary,
        popupWidth: 240,
        popupHeight: 540,
      }),
    ).toEqual({
      left: 120,
      top: 8,
      maxWidth: 784,
      maxHeight: 538,
      side: 'above',
    })
  })

  it('prefers a constrained above placement whenever full height does not fit below', () => {
    expect(
      computeCaretPopupPlacement({
        caret: caret(120, 250),
        boundary,
        popupWidth: 240,
        popupHeight: 500,
      }),
    ).toEqual({
      left: 120,
      top: 8,
      maxWidth: 784,
      maxHeight: 238,
      side: 'above',
    })
  })

  it('clamps the popup at both horizontal edges', () => {
    expect(
      computeCaretPopupPlacement({
        caret: caret(2, 100),
        boundary,
        popupWidth: 240,
        popupHeight: 100,
      })?.left,
    ).toBe(8)
    expect(
      computeCaretPopupPlacement({
        caret: caret(790, 100),
        boundary,
        popupWidth: 240,
        popupHeight: 100,
      })?.left,
    ).toBe(552)
  })

  it('returns unavailable instead of a document-top fallback', () => {
    expect(
      computeCaretPopupPlacement({
        caret: null,
        boundary,
        popupWidth: 240,
        popupHeight: 100,
      }),
    ).toBeUndefined()
    expect(
      computeCaretPopupPlacement({
        caret: caret(100, 700),
        boundary,
        popupWidth: 240,
        popupHeight: 100,
      }),
    ).toBeUndefined()
  })

  it('intersects the editor and viewport boundaries', () => {
    expect(
      intersectPopupRectangles(
        { left: -20, right: 500, top: 100, bottom: 900 },
        boundary,
      ),
    ).toEqual({ left: 0, right: 500, top: 100, bottom: 600 })
  })
})

describe('active popup option visibility', () => {
  it('scrolls by the nearest edge without scrolling another ancestor', () => {
    const menu = document.createElement('div')
    const option = document.createElement('button')
    menu.append(option)
    Object.defineProperties(menu, {
      clientHeight: { configurable: true, value: 80 },
      clientTop: { configurable: true, value: 1 },
    })
    menu.getBoundingClientRect = () =>
      ({ top: 100, bottom: 182 } as DOMRect)
    option.getBoundingClientRect = () =>
      ({ top: 190, bottom: 220 } as DOMRect)

    scrollPopupOptionIntoView(menu, option)
    expect(menu.scrollTop).toBe(39)

    option.getBoundingClientRect = () =>
      ({ top: 80, bottom: 110 } as DOMRect)
    scrollPopupOptionIntoView(menu, option)
    expect(menu.scrollTop).toBe(18)
  })
})
