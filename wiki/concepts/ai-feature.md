---
title: AI Feature
type: concept
tags: [milkdown, crepe, ai, streaming, diff, openai, anthropic, provider]
source: [[Milkdown Docs Corpus]]
updated: 2026-08-10
---

# AI Feature

`Crepe.Feature.AI` (off by default) turns Crepe into an **AI writing surface**. It combines **streaming input** and **diff review** into one workflow: you give an instruction, the model streams Markdown tokens into the document (via [[Plugin System|plugin-streaming]]), and you accept/reject the result (via [[Plugin System|plugin-diff]]).

## How it works

- You supply a `provider`: `async function* (context, signal)` yielding Markdown tokens.
- With a selection, `runAICmd` replaces the selected text; the provider receives it in `AIPromptContext.selection`. With no selection, content is inserted at the cursor.
- Four UI surfaces appear when enabled + a provider is configured: (1) toolbar AI button, (2) instruction palette with built-in + custom suggestions, (3) inline streaming indicator, (4) floating diff actions panel (Retry / Reject all / Accept all, the last bound to `Mod+Enter`).

## Built-in providers (no SDK dependency, just `fetch`)

- `createOpenAIProvider({ apiKey, model, baseURL?, headers?, body?, buildMessages?, systemPrompt? })` → e.g. `gpt-4o-mini`
- `createAnthropicProvider({ apiKey, model, baseURL?, headers?, maxTokens?, body? })` → e.g. `claude-sonnet-4-5`

Both send a default system prompt requesting **raw Markdown** and assemble the user message from `<document>` + `<selection>` + `<instruction>`.

## Deployment / API-key safety (important)

There is **no safe way to embed an API key in a browser bundle** — `import.meta.env.VITE_*` ends up as plain text. Two safe modes:

1. **BYOK** — each user supplies their own key; set `dangerouslyAllowBrowser: true`.
2. **Backend proxy** (recommended for multi-user web apps) — omit `apiKey`, point `baseURL` at your server which holds the real key; browser sends a session token.

Direct browser→provider calls work in desktop apps (no CORS) but generally fail from web pages; the proxy mode sidesteps CORS and is the recommended pattern.

## Customizing

- `buildAISuggestions` — add/remove palette suggestions and submenus (Improve writing, Fix grammar, Make shorter/longer, Change tone…, Translate…).
- `AIFeatureConfig` — localize every label/icon (`instructionPlaceholder`, `diffActions`, `streamingIndicator`, …).
- Programmatic control: `runAICmd` / `abortAICmd` via `callCommand`; helpers `useAIProviderConfig`, `useAIInstructionTooltipAPI`.

## Related

- [[Crepe Editor]] · [[Plugin System]] (streaming + diff) · [[Milkdown Architecture]]
- Entities: [[Crepe]] · [[Milkdown]]
