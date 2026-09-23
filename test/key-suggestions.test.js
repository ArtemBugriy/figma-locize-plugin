'use strict';

// Editing a row's Key field offers existing locize keys: ranked by the node's text
// while nothing is typed, filtered by the query once something is.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUi, sleep } = require('./helpers/ui');

const POOL = [
  ['Common', 'submit_button', 'Submit'],
  ['Auth', 'submit_form', 'Submit form'],
  ['Common', 'send', 'Send'],
  ['Auth', 'login_title', 'Log in to your account'],
  ['Billing', 'invoice_paid', 'Invoice paid'],
];

function ranked(ui, item, query) {
  // Array.from re-creates the value in this realm: an array built inside jsdom has a
  // different Array.prototype, which deepStrictEqual treats as a mismatch.
  return Array.from(ui.eval(`suggestForItem(${JSON.stringify(item)}, ${JSON.stringify(query)})`))
    .map((s) => `${s.namespace}.${s.key}`);
}

test('ranking', async (t) => {
  const ui = loadUi();
  ui.useSettings();
  ui.usePool(POOL);
  const row = { text: 'Submit', localKey: 'submit' };

  await t.test('an untouched field ranks by the node text', () => {
    assert.deepEqual(ranked(ui, row, ''), ['Common.submit_button', 'Auth.submit_form']);
  });

  await t.test('typing filters by key instead', () => {
    // The fuzzy scorer divides by candidate length, so "login" scores 0.25 against
    // "auth login title" and would fall below the threshold: a typed query has to be
    // matched by containment or typing finds nothing at all.
    assert.deepEqual(ranked(ui, row, 'login'), ['Auth.login_title']);
    assert.deepEqual(ranked(ui, row, 'login_title'), ['Auth.login_title']);
  });

  await t.test('a prefix outranks a later match', () => {
    assert.deepEqual(ranked(ui, row, 'sub'), ['Common.submit_button', 'Auth.submit_form']);
  });

  await t.test('a word from the translation also matches', () => {
    assert.deepEqual(ranked(ui, row, 'paid'), ['Billing.invoice_paid']);
  });

  await t.test('no match and nothing to match on both yield nothing', () => {
    assert.deepEqual(ranked(ui, row, 'zzz'), []);
    assert.deepEqual(ranked(ui, { text: '', localKey: '' }, ''), []);
  });
});

test('the Key field dropdown', async (t) => {
  const ui = loadUi();
  ui.useSettings();
  ui.usePool(POOL);
  ui.$('suggestNamespaces').value = 'Common, Auth';
  ui.scan([{ text: 'Submit', namespace: 'UnknownFeatureNs', localKey: 'Submit' }]);
  await sleep(20);

  await t.test('the table is down to its six columns', () => {
    assert.equal(ui.rows().length, 1);
    // select, namespace, key, text, remote text, status -- Suggestions and Orig Node
    // Name were both dropped to buy horizontal room.
    assert.equal(ui.cell(0, 0).parentElement.querySelectorAll('td').length, 6);
    const headers = [...ui.document.querySelectorAll('#keysTable thead th')].map((th) => th.textContent.trim());
    assert.equal(headers.length, 6, headers.join(' | '));
  });

  await t.test('opens on focus, labelled like the layer name', async () => {
    ui.keyInput(0).focus();
    await sleep(40);
    assert.ok(ui.dropdownOpen());
    assert.deepEqual(ui.dropdownLabels(), ['submit_button (Common)', 'submit_form (Auth)']);
    assert.deepEqual(ui.dropdownHints(), ['Submit', 'Submit form']);
  });

  await t.test('arrow keys and Enter fill in both the key and its namespace', async () => {
    const key = ui.keyInput(0);
    const press = (k) => key.dispatchEvent(new ui.window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    press('ArrowDown');
    press('Enter');
    await sleep(20);
    assert.equal(key.value, 'submit_form');
    assert.equal(ui.namespaceInput(0).value, 'Auth');
    assert.equal(ui.dropdownOpen(), false, 'picking closes the list');
  });

  await t.test('typing re-queries the list', async () => {
    const key = ui.keyInput(0);
    key.focus();
    key.value = 'login';
    key.dispatchEvent(new ui.window.Event('input'));
    await sleep(200);
    assert.deepEqual(ui.dropdownLabels(), ['login_title (Auth)']);
  });
});
