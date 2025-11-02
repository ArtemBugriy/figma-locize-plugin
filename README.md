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

Fuzzy suggestions for keys

- Where: UI table, column "Suggestions".
- How it works: The plugin fetches translations from Locize for the namespaces you list in the input "Suggest from namespaces". It builds a fuzzy index from both values and full keys (ns.key).
- Matching: Suggestions are ranked by a combined score of similarity to node text and the edited key. Minor typos/case/diacritics are tolerated.
- Live updates: As you type in the Key field, suggestions refresh automatically (debounced).
- Usage:
  1) Fill Settings and save; select a Language.
  2) In "Key management", set "Suggest from namespaces" (comma-separated), e.g. `Common, Auth`.
  3) Click "Suggest keys" or just edit the Key — suggestions will appear per row.
  4) Pick a suggestion and press "Apply" to set namespace.key for that row.

Notes

- Network access must allow https://api.locize.app (already configured in manifest.json).
- Only items with text will receive suggestions; empty text yields no suggestions.
- If no namespaces are provided, suggestions are disabled.
