'use strict';

// A version's content changes under a fixed URL, so a cached read misreports sync
// status -- most visibly right after an upload, when the plugin re-reads to confirm
// what it just wrote.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUi, DEFAULT_SETTINGS } = require('./helpers/ui');

test('noCacheUrl picks the right separator', () => {
  const ui = loadUi();
  assert.equal(ui.eval("noCacheUrl('https://h/a')"), 'https://h/a?cache=no');
  assert.equal(ui.eval("noCacheUrl('https://h/a?x=1')"), 'https://h/a?x=1&cache=no');
});

test('every read bypasses both caches', async (t) => {
  const reads = [
    ['fetchTranslations', (ui, s) => ui.eval(`fetchTranslations(${JSON.stringify(s)}, 'en', 'Common')`)],
    ['fetchNamespacesFromApi', (ui, s) => ui.eval(`fetchNamespacesFromApi(${JSON.stringify(s)}, 'en')`)],
    ['fetchLanguagesList', (ui) => ui.eval('fetchLanguagesList()')],
    ['verifyCredentials', (ui, s) => ui.eval(`verifyCredentials(${JSON.stringify(s)}, undefined, -1)`)],
  ];

  for (const [name, run] of reads) {
    await t.test(name, async () => {
      const ui = loadUi();
      const settings = ui.useSettings();
      await Promise.resolve(run(ui, settings)).catch(() => {});

      const call = ui.fetched[0];
      assert.ok(call, 'should have made a request');
      // ?cache=no is what locize documents for its Standard CDN, and what
      // i18next-locize-backend sends; no-store handles the iframe's own HTTP cache,
      // which would otherwise reuse a response for the now-constant URL.
      assert.match(call.url, /[?&]cache=no(&|$)/);
      assert.equal(call.options.cache, 'no-store');
    });
  }
});

test('writes are left alone', async () => {
  const ui = loadUi();
  await ui.eval(`updateTranslationsBatch(${JSON.stringify(DEFAULT_SETTINGS)}, 'en', 'Common', { k: { value: 'v' } }, true)`)
    .catch(() => {});

  const call = ui.fetched[0];
  assert.equal(call.options.method, 'POST');
  assert.doesNotMatch(call.url, /cache=no/, 'an upload is not cached and must not carry it');
});
