'use strict';

// Boots the real ui.html in jsdom, so tests exercise the file Figma ships rather than a
// copy of it. ui.html has no build step -- Figma loads it from disk as-is -- so driving
// it through a DOM is the only way to test the plugin's frontend.

const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const UI_PATH = path.join(__dirname, '..', '..', 'ui.html');

const DEFAULT_SETTINGS = {
  projectId: 'p1',
  apiKey: 'k',
  version: 'latest',
  baseLanguage: 'en',
  apiBaseUrl: 'https://api.locize.app',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {{viewport?: {width: number, height: number}}} [opts]
 */
function loadUi(opts = {}) {
  const html = fs.readFileSync(UI_PATH, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://localhost/',
  });
  const { window } = dom;
  const doc = window.document;

  // Stand in for the two things the UI talks to: the plugin sandbox and locize.
  const sent = [];
  const fetched = [];
  window.parent.postMessage = (message) => { sent.push(message && message.pluginMessage); };
  window.fetch = (url, options) => {
    fetched.push({ url: String(url), options: options || {} });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' });
  };

  if (opts.viewport) {
    Object.defineProperty(window, 'innerWidth', { value: opts.viewport.width, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: opts.viewport.height, configurable: true });
  }

  const ui = {
    window,
    document: doc,
    sent,
    fetched,

    /** Run code inside the page, where all of ui.html's functions are globals. */
    eval: (code) => window.eval(code),
    $: (id) => doc.getElementById(id),

    /** Deliver a message the way code.ts would. */
    send(pluginMessage) {
      window.dispatchEvent(new window.MessageEvent('message', { data: { pluginMessage } }));
    },

    // --- the shared suggestion dropdown ---
    dropdown: () => doc.querySelector('.ns-suggest-dropdown'),
    dropdownOpen() {
      const el = ui.dropdown();
      return !!el && el.style.display === 'block';
    },
    dropdownLabels() {
      const el = ui.dropdown();
      return el ? [...el.querySelectorAll('.ns-suggest-label')].map((e) => e.textContent) : [];
    },
    dropdownHints() {
      const el = ui.dropdown();
      return el ? [...el.querySelectorAll('.ns-suggest-hint')].map((e) => e.textContent) : [];
    },

    // --- fixtures, so nothing reaches the network ---
    useSettings(overrides = {}) {
      const settings = { ...DEFAULT_SETTINGS, ...overrides };
      window.eval(`collectSettings = () => (${JSON.stringify(settings)});`);
      return settings;
    },
    /** @param {Array<[string, string, string]>} entries [namespace, key, value] */
    usePool(entries) {
      window.eval(`
        suggestionLanguage = () => 'en';
        ensureSuggestionPoolReady = async () => {};
        suggestionPool['en'] = ${JSON.stringify(entries)}.map(([ns, key, value]) => {
          const norm = normalizeVal(value);
          const normKey = normalizeKey(ns + '.' + key);
          return { namespace: ns, key, value, norm, tokens: norm.split(' '),
                   fullKey: ns + '.' + key, normKey, keyTokens: normKey.split(' ') };
        });
      `);
    },
    useNamespaceList(list) {
      window.eval(`ensureNamespaceSuggestionsLoaded = async () => ${JSON.stringify(list)};`);
    },

    // --- the Key Management table ---
    scan(items) {
      ui.send({
        type: 'scan-result',
        items: items.map((item, i) => ({
          nodeId: item.nodeId || `n${i}`,
          name: item.name || item.text,
          originalName: item.originalName || item.name || item.text,
          text: item.text,
          key: item.key || `${item.namespace}.${item.localKey}`,
          namespace: item.namespace,
          localKey: item.localKey,
          existing: !!item.existing,
        })),
      });
    },
    rows: () => [...doc.querySelectorAll('#keysTable tbody tr')],
    /** Columns: 0 select, 1 namespace, 2 key, 3 text, 4 remote, 5 original name, 6 status. */
    cell: (row, column) => ui.rows()[row].querySelectorAll('td')[column],
    keyInput: (row) => ui.cell(row, 2).querySelector('input'),
    namespaceInput: (row) => ui.cell(row, 1).querySelector('input'),
  };

  return ui;
}

module.exports = { loadUi, sleep, DEFAULT_SETTINGS };
