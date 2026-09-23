'use strict';

// What the Key Management panel tells the user about itself.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUi } = require('./helpers/ui');

test('the table carries its own caption', () => {
  const ui = loadUi();
  const caption = [...ui.document.querySelectorAll('#panel-keys div')]
    .find((el) => el.children.length === 0 && /The table follows your Figma selection/.test(el.textContent));

  assert.ok(caption, 'the caption should exist');
  assert.equal(caption.textContent.trim(), 'The table follows your Figma selection.');
  assert.ok(
    caption.nextElementSibling && caption.nextElementSibling.classList.contains('table-container'),
    'it belongs directly above the table it describes',
  );
});

test('every action below the table explains itself', async (t) => {
  const cases = [
    ['applyKeys', /nothing is sent to locize/i],
    ['clearKeys', /restores the original layer name/i],
    ['uploadKeys', /only new or changed/i],
  ];

  for (const [id, expected] of cases) {
    await t.test(id, () => {
      const ui = loadUi();
      const button = ui.$(id);
      const wrapper = button.closest('.hint');

      // The description has to sit on the wrapper: these buttons start out disabled,
      // and a disabled control receives no mouse events in Chromium, so a title on the
      // button itself would never be shown -- exactly when it is most wanted.
      assert.ok(button.disabled, 'the button starts disabled');
      assert.ok(wrapper, 'the button should be wrapped');
      assert.match(wrapper.getAttribute('title') || '', expected);
      assert.equal(button.hasAttribute('title'), false, 'no competing title on the button');
    });
  }
});

test('autotranslate explains itself and why it is unavailable', () => {
  const ui = loadUi();
  ui.useSettings();
  const checkbox = ui.$('autotranslate');
  assert.match(checkbox.closest('label').getAttribute('title') || '', /machine-translate/i);

  const languages = ui.$('languageSelect');
  languages.innerHTML = '<option value="en">en</option><option value="de">de</option>';

  languages.value = 'en';
  ui.eval('updateAutotranslateAvailability()');
  // title="" would suppress the label's tooltip rather than fall through to it.
  assert.equal(checkbox.hasAttribute('title'), false, 'no title when the option is usable');

  languages.value = 'de';
  ui.eval('updateAutotranslateAvailability()');
  assert.match(checkbox.getAttribute('title') || '', /Unavailable.*de.*base language \(en\)/);
});
