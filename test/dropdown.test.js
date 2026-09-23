'use strict';

// The suggestion dropdown is a single shared element reused by every field that offers
// completions. Each of these cases is a bug that shipped: the list appeared off-screen,
// hung over the window edge, outlived the field it pointed at, or was closed by another
// field's pending blur.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUi, sleep } = require('./helpers/ui');

test('positions itself on the very first open', async () => {
  const ui = loadUi();
  ui.useNamespaceList(['Common', 'Auth']);

  ui.$('scanNamespace').focus();
  await sleep(30);

  const el = ui.dropdown();
  assert.ok(ui.dropdownOpen(), 'dropdown should be visible');
  // Without left/top, position:absolute falls back to the static position at the end of
  // <body> -- off-screen, which reads as "it flashed and vanished".
  assert.ok(el.style.left, 'left must be set on the first open');
  assert.ok(el.style.top, 'top must be set on the first open');
});

test('stays inside the plugin window', async (t) => {
  const VIEWPORT = { width: 740, height: 740 };
  const SIZE = { width: 260, height: 220 };

  // jsdom has no layout, so the anchor's box and the list's size are supplied.
  const place = (ui, left, top) => {
    const anchor = ui.$('scanNamespace');
    anchor.getBoundingClientRect = () => ({
      left, top, right: left + 120, bottom: top + 20, width: 120, height: 20,
    });
    ui.eval('window.__open = openNsDropdown; window.__position = positionDropdown;');
    ui.window.__open(anchor, ['Common', 'Auth'], null);
    const el = ui.dropdown();
    Object.defineProperty(el, 'offsetWidth', { value: SIZE.width, configurable: true });
    Object.defineProperty(el, 'offsetHeight', { value: SIZE.height, configurable: true });
    ui.window.__position(anchor);
    return { left: parseInt(el.style.left, 10), top: parseInt(el.style.top, 10) };
  };

  await t.test('drops below the field when there is room', () => {
    const ui = loadUi({ viewport: VIEWPORT });
    const at = place(ui, 100, 100);
    assert.equal(at.left, 100);
    assert.equal(at.top, 122);
  });

  await t.test('clamps to the right edge', () => {
    const ui = loadUi({ viewport: VIEWPORT });
    const at = place(ui, 700, 100);
    assert.ok(at.left + SIZE.width <= VIEWPORT.width, `right edge ${at.left + SIZE.width} > ${VIEWPORT.width}`);
  });

  await t.test('flips above the field when it would not fit below', () => {
    const ui = loadUi({ viewport: VIEWPORT });
    const at = place(ui, 100, 660);
    assert.ok(at.top + SIZE.height <= VIEWPORT.height, `bottom ${at.top + SIZE.height} > ${VIEWPORT.height}`);
    assert.ok(at.top >= 0, 'must not flip off the top');
  });
});

test('closes when its anchor is removed from the DOM', async () => {
  const ui = loadUi();
  ui.useSettings();
  ui.usePool([['Common', 'submit_button', 'Submit']]);
  ui.$('suggestNamespaces').value = 'Common';
  ui.scan([{ text: 'Submit', namespace: 'Ns', localKey: 'Submit' }]);
  await sleep(20);

  ui.keyInput(0).focus();
  await sleep(40);
  assert.ok(ui.dropdownOpen(), 'dropdown should open on the row');

  // Re-rendering the table replaces every row. Chrome fires no blur when a focused
  // element is removed, so without this the list would hang on a detached anchor --
  // which measures as an all-zero rect and parks it in the document corner.
  const anchor = ui.keyInput(0);
  ui.scan([{ text: 'Submit', namespace: 'Ns', localKey: 'Submit' }]);
  await sleep(20);

  assert.equal(ui.document.contains(anchor), false, 'the anchor should be detached');
  assert.equal(ui.dropdownOpen(), false, 'the dropdown should have closed with it');
});

test('a pending blur only closes the list it owns', async (t) => {
  const openOn = async (ui, el) => { el.focus(); await sleep(30); };

  await t.test('moving to another field keeps the new list', async () => {
    const ui = loadUi();
    ui.useNamespaceList(['Common', 'Auth']);
    const first = ui.$('scanNamespace');
    const second = ui.$('suggestNamespaces');

    await openOn(ui, first);
    first.blur();
    await openOn(ui, second);
    assert.ok(ui.dropdownOpen(), 'the second field should have opened its own list');

    await sleep(150); // the first field's deferred close fires in here
    assert.ok(ui.dropdownOpen(), "the first field's timer must not close the second field's list");
  });

  await t.test('returning to the same field keeps the reopened list', async () => {
    const ui = loadUi();
    ui.useNamespaceList(['Common', 'Auth']);
    const field = ui.$('scanNamespace');

    await openOn(ui, field);
    field.blur();
    await sleep(10);
    await openOn(ui, field);

    await sleep(150);
    assert.ok(ui.dropdownOpen(), 'its own earlier timer must not close the reopened list');
  });

  await t.test('leaving for good still closes it', async () => {
    const ui = loadUi();
    ui.useNamespaceList(['Common', 'Auth']);
    const field = ui.$('scanNamespace');

    await openOn(ui, field);
    field.blur();
    await sleep(200);
    assert.equal(ui.dropdownOpen(), false);
  });
});
