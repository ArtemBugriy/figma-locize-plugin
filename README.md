# Figma Locize Plugin

Effortlessly bridge your Figma designs with your locize translation project. Scan text layers, assign stable i18n keys, upload source content, fetch translations, and preview localized UI directly in the canvas.

## Features
- Automatic i18n key generation based on layer hierarchy and node name (slugified, uniqueness ensured)
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
- Original node name preservation and restore function after replacing names with keys
- Select-all / bulk selection management with table row cap (100) and overflow indicator
- Safe network scope (only calls https://api.locize.app)
- Local clientStorage persistence for credentials, base language, version, and selection states
- Font preloading before mutating characters prevents missing font errors
- Simple flat-map handling of nested JSON translation structures
- Caching of fetched namespaces per language to minimize API calls

## Store Listing Snippet (Copy/Paste)
Bring localization into your design workflow:
- Generate stable i18n keys from text layers automatically
- Re-use existing translation keys with smart fuzzy suggestions
- Color-coded sync status (missing / unsynced / synced) for quick QA
- Upload and optionally autotranslate base language strings to locize
- Preview any language instantly by applying remote translations to the canvas
- Restore original layer names whenever you need

Boost collaboration between designers and localization teams—eliminate manual key spreadsheets and keep text consistent end-to-end.


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
