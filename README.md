# Figma Locize Plugin

Effortlessly bridge your Figma designs with your locize translation project. Scan text layers, assign stable i18n keys, upload source content, fetch translations, and preview localized UI directly in the canvas.

## Features
- Namespace management: create new namespaces and auto-detect existing ones from assigned keys
- Bulk scan of current selection (or entire page when nothing selected) for TEXT nodes
- Inline editing of layer text with live sync back to the Figma node (fonts auto-loaded)
- Persistent per-node selection state (unchecked items remembered across sessions) + “Hide unchecked” filter
- Fuzzy key suggestion engine: suggests existing keys from chosen namespaces (configurable list) using normalized text similarity
- One-click “Apply all top suggestions” to rapidly re-use existing keys
- Sync status coloring (synced / unsynced / missing) comparing local text vs remote translations per language
- Remote translation application: switch language and apply translations to all keyed nodes
- Upload selected base language strings to locize with progress indicator (batched, cached)
- Optional autotranslate toggle for the base language workflow (only enabled when viewing base language)
- Layer names carry the key and namespace (`localKey (namespace)`) so the file is readable without the plugin — see [Layer naming](#layer-naming)
- Original node name preservation: the pre-plugin layer name is stored on the node and restored when the key is cleared
- Select-all / bulk selection management with table row cap (100) and overflow indicator
- Per-project API base URL: point a project at the lite tier (`https://api.lite.locize.app`) or any other locize host — see [API base URL](#api-base-url)
- Safe network scope (only calls locize hosts)
- Local clientStorage persistence for credentials, base language, version, and selection states
- Font preloading before mutating characters prevents missing font errors
- Simple flat-map handling of nested JSON translation structures
- Caching of fetched namespaces per language to minimize API calls

---

## API base URL

Each project in **Settings** has its own **API base URL**. Leave it empty for the default
`https://api.locize.app`; projects on the lite tier use `https://api.lite.locize.app`.

Every request — languages, translations, uploads, sync status — is built from this value,
and it is part of the namespace cache key, so two projects on different hosts never share
cached data. Trailing slashes are stripped for you.

**Constraint:** Figma only lets the plugin reach hosts whitelisted in `manifest.json`
(`networkAccess.allowedDomains`), currently `https://*.locize.app`. A base URL on any other
domain is blocked by Figma with no useful error, so the plugin warns when you save such a
project and refuses to upload with it. To use a host outside `*.locize.app`, add it to
`manifest.json` and reload the plugin.

---

## Layer naming

When you press **Apply keys to nodes**, every keyed TEXT layer is renamed to:

```
<localKey> (<namespace>)
```

for example the key `Common.submit_button` produces the layer name `submit_button (Common)`.

The point is that the full key lives **on the canvas**, not only in the plugin's private
data: anyone reading the Figma file — a developer, a REST API consumer, another plugin —
can reconstruct `namespace.localKey` from the layer name alone.

**How to parse a layer name back into a key**

- Take the **last** parenthesised group as the namespace, and everything before it
  (trimmed) as the local key. The local key may itself contain parentheses:
  `Submit (draft) (Common)` → namespace `Common`, local key `Submit (draft)`.
- Dots inside the local key are preserved: the key is split on its **first** dot only, so
  `Common.forms.submit` becomes `forms.submit (Common)` and joins back the same way.
- A key with no namespace (possible if the namespace field is cleared in the table) gets
  no suffix — the layer name is just the key.

**Invariant:** a layer bound to a locize key always carries its namespace in the name.
There is deliberately no "restore original names" action for bound layers; **Clear keys**
unbinds a node *and* puts its original name back, in one step.

**Legacy layers.** Older versions of the plugin renamed layers to the dotted
`namespace.localKey` string (or left the name untouched). Those layers keep their old name
until keys are applied to them again — to migrate a file, press **Get assigned**, select
all, then **Apply keys to nodes**.

Layer names inside component instances are read-only in Figma, so the rename is skipped
there; the plugin reports how many layers it could not rename instead of claiming success.
The key itself is still written — only the name can't follow.

---


Below are the steps to get your plugin running. You can also find instructions at:

  https://www.figma.com/plugin-docs/plugin-quickstart-guide/

This plugin template uses Typescript and NPM, two standard tools in creating JavaScript applications.

First, download Node.js which comes with NPM. This will allow you to install TypeScript and other
libraries. You can find the download link here:

  https://nodejs.org/en/download/

Next, install TypeScript using the command:

  npm install -g typescript

Finally, in the directory of your plugin, get the latest type definitions for the plugin API by running:

  npm install --save-dev @figma/plugin-typings

If you are familiar with JavaScript, TypeScript will look very familiar. In fact, valid JavaScript code
is already valid Typescript code.

TypeScript adds type annotations to variables. This allows code editors such as Visual Studio Code
to provide information about the Figma API while you are writing code, as well as help catch bugs
you previously didn't notice.

For more information, visit https://www.typescriptlang.org/

Using TypeScript requires a compiler to convert TypeScript (code.ts) into JavaScript (code.js)
for the browser to run.

We recommend writing TypeScript code using Visual Studio code:

1. Download Visual Studio Code if you haven't already: https://code.visualstudio.com/.
2. Open this directory in Visual Studio Code.
3. Compile TypeScript to JavaScript: Run the "Terminal > Run Build Task..." menu item,
    then select "npm: watch". You will have to do this again every time
    you reopen Visual Studio Code.

That's it! Visual Studio Code will regenerate the JavaScript file every time you save.

---

Vibecoded with a help of an ai-assistant
