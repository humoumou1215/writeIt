---
title: Twemoji
type: entity
tags: [dependency, twemoji, emoji]
source: [[Milkdown Docs Corpus]]
updated: 2026-08-10
---

# Twemoji

[Twemoji](https://github.com/twitter/twemoji) (Twitter's emoji set) is the renderer used by `@milkdown/plugin-emoji`. The plugin turns `:shortcut:` text into emoji images via `remarkEmojiPlugin` + `remarkTwemojiPlugin`, with `emojiAttr` / `emojiSchema` and an `insertEmojiInputRule`.

## Why it matters

If you enable the emoji plugin ([[Plugin System]]), emojis render as Twemoji images rather than native glyphs — relevant for consistent cross-platform appearance.

## Related

- [[Plugin System]]
- Parent framework: [[Milkdown]]
