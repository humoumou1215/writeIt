---
title: Component System
type: concept
tags: [milkdown, component, ui, code-block, image, table, link]
source: [[Milkdown Docs Corpus]]
updated: 2026-08-10
---

# Component System

`@milkdown/components/*` are **rich UI blocks** that sit on top of the schema from the [[Preset CommonMark GFM|presets]]. Each is a plugin you `.use()`, configured by updating a `*Config` ctx slice. They ship **no styling** — you bring your own CSS.

## The six components

| Component | Module | Features |
| --- | --- | --- |
| **Code Block** | `@milkdown/components/code-block` | CodeMirror 6 editor: language picker, syntax highlighting, line numbers, autocomplete/folding, search & replace, copy, async preview. Config: `codeBlockConfig` (`extensions`, `languages`, `renderLanguage`, `renderPreview`, `onCopy`, …) |
| **Image Block** | `@milkdown/components/image-block` | Renders an image as a *block* (Markdown images are normally inline). Resize handle, caption, link input, placeholder, upload. Config: `imageBlockConfig` (`onUpload`, `proxyDomURL`, `onImageLoadError`, `maxWidth`, `maxHeight`, …) |
| **Image Inline** | `@milkdown/components/image-inline` | Placeholder + uploader for inline images. Config: `inlineImageConfig` (`onUpload`, `proxyDomURL`, …) |
| **Link Tooltip** | `@milkdown/components/link-tooltip` | Hover tooltip to edit/preview/copy links, plus a programmatic API (`insertLink`, `editLink`, `removeLink`). Config: `linkTooltipConfig` (`linkIcon`, `onCopyLink`, `inputPlaceholder`, …) |
| **List Item Block** | `@milkdown/components/list-item-block` | Custom renderer for ordered/bullet/todo list items. Config: `listItemBlockConfig` (`renderLabel`) |
| **Table Block** | `@milkdown/components/table-block` | Table UX: row/col drag-and-drop, insert/delete, column alignment. Config: `tableBlockConfig` (`renderButton`) |

## Upload pattern (shared)

`image-block` and `image-inline` both rely on an `onUpload: (file) => Promise<string>` callback that returns the hosted URL; `plugin-upload` (see [[Plugin System]]) is the lower-level drag/paste uploader that Crepe wires in automatically.

## Related

- [[Preset CommonMark GFM]] · [[Plugin System]] · [[Crepe Editor]] · [[Milkdown Architecture]]
- Entities: [[CodeMirror]] (code block) · [[Milkdown]]
