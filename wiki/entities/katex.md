---
title: KaTeX
type: entity
tags: [dependency, katex, latex, math]
source: [[Milkdown Docs Corpus]]
updated: 2026-08-10
---

# KaTeX

[KaTeX](https://katex.org/) is the math renderer behind Milkdown's **Latex** feature (Crepe `Latex` feature, on by default).

- **Config:** `LatexFeatureConfig` → `katexOptions` (KaTeX options, e.g. `throwOnError: false`, `displayMode: true`) and `inlineEditConfirm` icon.
- **Used for:** inline and block math rendering in the editor.

## Why it matters

For math-heavy docs, set `katexOptions` to control rendering behavior; pair with the `Latex` feature flag in [[Crepe Editor]].

## Related

- [[Crepe Editor]] · [[AI Feature]]
- Parent framework: [[Milkdown]]
