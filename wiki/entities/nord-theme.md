---
title: Nord Theme
type: entity
tags: [milkdown, theme, nord, css]
source: [[Milkdown Docs Corpus]]
updated: 2026-08-10
---

# Nord Theme

`@milkdown/theme-nord` is a lightweight Milkdown theme built on the [Nord](https://www.nordtheme.com/) palette and [Tailwind CSS](https://tailwindcss.com/). Originally designed for Milkdown's docs site; usable in your own project by importing the package's CSS.

- **Export:** `nord` (the theme registration).
- **Relation to Crepe:** Crepe ships its own `nord.css` / `nord-dark.css` themes (see [[Crepe Editor]] / [[Nord Theme]]); `@milkdown/theme-nord` is the lower-level theme package.
- **Mechanism:** themes expose CSS custom properties on `.milkdown`; override them without touching source.

## Related

- [[Crepe Editor]] · [[Nord Theme]]
- Parent framework: [[Milkdown]]
