# AGENTS.md — Figma Locize Plugin

## Project Overview
Figma plugin that bridges Figma designs with [locize](https://locize.com/) (i18n SaaS). Scans TEXT nodes, assigns stable i18n keys, uploads source strings, fetches translations, and previews localized UI on-canvas.

## Architecture: Two-Process Model
Figma plugins run in two isolated JS contexts that can only communicate via `postMessage`:

| File | Context | Has access to |
|------|---------|--------------|
| `code.ts` → `code.js` | Figma plugin sandbox | `figma` global (document, nodes, clientStorage) — **no DOM, no fetch** |
| `ui.html` (`<script>`) | Browser iframe | DOM, `fetch`, `parent.postMessage` — **no figma global** |

**All network calls (locize API) happen in `ui.html`.** `code.ts` only calls `https://api.locize.app` indirectly by receiving data from the UI and applying it to nodes.

## Message Protocol
`code.ts` sends/receives via `figma.ui.postMessage` / `figma.ui.onmessage`.  
`ui.html` sends via `pm({ type, ...payload })` → `parent.postMessage({ pluginMessage: ... }, '*')` and receives via `window.onmessage`.

Key message types (defined in `code.ts` switch and `ui.html` handler):
- `load-settings` / `settings-loaded` — load credentials from clientStorage
- `scan-selection` → `scan-result` — collect TEXT nodes and generate keys
- `apply-keys` — write `locize:key` plugin data to nodes, rename layers
- `get-assigned` → `assigned-result` — fetch already-keyed nodes
- `apply-language` — apply a `TranslationMap` to nodes' `.characters`
- `update-text` — live-edit a single node's text from the table
- `set-selected` / `set-selected-bulk` — persist checkbox state

## Key Data Structures (code.ts)
```ts
interface Settings { projectId, apiKey, version, baseLanguage }
interface ScanItem  { nodeId, name, originalName, text, key, namespace, localKey, existing, selected? }
type TranslationMap = { [fullKey: string]: string }
```

**Key format:** `namespace.localKey` (e.g. `Common.submit_button`). Always stored as a single string in plugin data under `locize:key`.

## Plugin Data Stored on Nodes
- `locize:key` — full i18n key (`namespace.localKey`)
- `locize:origName` — original Figma layer name (before it gets renamed to the key)

## clientStorage Keys (code.ts)
`locize.projectId`, `locize.apiKey`, `locize.version`, `locize.baseLanguage`, `locize:selected`

Selection state stores **only unchecked** node IDs (`false`); all others are implicitly checked (compact storage).

## Build & Dev Workflow
```bash
npm install          # install devDependencies (TypeScript, typings, eslint)
npm run build        # tsc → compiles code.ts → code.js (the file Figma loads)
npm run watch        # tsc --watch (recommended during development)
npm run lint         # eslint over .ts files
npm run lint:fix     # auto-fix lint errors
```

**After any edit to `code.ts` you must recompile** — Figma loads `code.js`, not `code.ts`.  
`ui.html` is loaded directly; no build step needed for UI changes.

## Loading the Plugin in Figma
Figma → Plugins → Development → Import plugin from manifest → select `manifest.json`.  
Reload plugin after each `code.js` rebuild (Cmd+Option+P or right-click → Run).

## Conventions & Patterns
- **Default namespace fallback:** `DEFAULT_NS = 'UnknownFeatureNs'` — used when no namespace is provided.
- **`slugify()`** normalizes layer names → dot-separated lowercase keys (spaces → `.`, strips non-alphanumeric).
- **Key uniqueness:** `generateKeys()` uses a `Set<string>` per scan run; appends `_2`, `_3` on collision.
- **Font preloading:** always call `ensureFonts(nodes)` before mutating `.characters` to avoid runtime errors.
- **Scope:** when `figma.currentPage.selection.length === 0`, operations fall back to `figma.currentPage.children` (entire page).
- **Table row cap:** UI renders max `MAX_TABLE_ROWS = 100` rows; overflow shown as `+N items`.
- **Network scope:** `manifest.json` restricts `networkAccess.allowedDomains` to `["https://api.locize.app"]`.

## External API
All calls go to `https://api.locize.app`. Relevant endpoints (called from `ui.html`):
- `GET  /languages/{projectId}` — list available languages
- `GET  /{projectId}/{version}/{language}/{namespace}` — fetch translation flat-map
- `POST /update/{projectId}/{version}/{language}/{namespace}` — upload source strings

## Key Files
| File | Purpose |
|------|---------|
| `code.ts` | Plugin backend — node traversal, key generation, clientStorage, message handler |
| `ui.html` | Plugin frontend — all UI, fetch calls, table rendering, suggestion engine |
| `manifest.json` | Plugin metadata, network whitelist, editor types |
| `tsconfig.json` | Targets ES6; typeRoots includes `@figma/plugin-typings` |
