'use strict';

// The API base URL decides which locize CDN a project talks to. The two hostnames are
// easy to get subtly wrong by hand, so the field offers them -- while staying free
// text, since a project could sit behind some other locize host.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadUi, sleep } = require('./helpers/ui');

function withProject(ui, overrides = {}) {
  ui.send({
    type: 'settings-loaded',
    projects: [{
      id: 'p1', name: 'Proj', projectId: 'abc', apiKey: 'k',
      version: 'latest', baseLanguage: 'en', apiBaseUrl: 'https://api.locize.app',
      ...overrides,
    }],
    activeProjectId: 'p1',
  });
}
const baseUrlField = (ui) =>
  [...ui.document.querySelectorAll('#projectsList input')]
    .find((input) => input.placeholder === 'https://api.locize.app');

test('the API base URL field suggests the known CDN hosts', async (t) => {
  const ui = loadUi();
  withProject(ui);
  await sleep(20);
  const field = baseUrlField(ui);
  assert.ok(field, 'the field should be rendered');

  await t.test('focus lists both, not just the one already typed', async () => {
    field.focus();
    field.dispatchEvent(new ui.window.FocusEvent('focus'));
    await sleep(20);
    assert.deepEqual(ui.dropdownLabels(), ['https://api.locize.app', 'https://api.lite.locize.app']);
    assert.ok(ui.dropdownHints().some((h) => /Pro CDN/.test(h)));
    assert.ok(ui.dropdownHints().some((h) => /Standard CDN/.test(h)));
  });

  await t.test('typing narrows it', async () => {
    field.value = 'lite';
    field.dispatchEvent(new ui.window.Event('input'));
    await sleep(20);
    assert.deepEqual(ui.dropdownLabels(), ['https://api.lite.locize.app']);
  });

  await t.test('Enter fills the field and the project', async () => {
    field.dispatchEvent(new ui.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await sleep(20);
    assert.equal(field.value, 'https://api.lite.locize.app');
    assert.equal(ui.eval('projects[0].apiBaseUrl'), 'https://api.lite.locize.app');
    assert.equal(ui.dropdownOpen(), false);
    assert.match(ui.$('activeProjectInfo').textContent, /api\.lite\.locize\.app/);
  });
});

test('the field stays free text', async () => {
  const ui = loadUi();
  withProject(ui);
  await sleep(20);
  const field = baseUrlField(ui);

  field.value = 'https://self.hosted.example';
  field.dispatchEvent(new ui.window.Event('input'));
  await sleep(20);
  assert.equal(field.value, 'https://self.hosted.example', 'a typed host must not be overwritten');
});

test('a base URL is vetted against what the manifest allows', () => {
  const ui = loadUi();
  const problem = (url) => ui.eval(`apiBaseProblem(${JSON.stringify(url)})`);

  assert.equal(problem('https://api.locize.app'), '');
  assert.equal(problem('https://api.lite.locize.app'), '');
  assert.match(problem('http://api.locize.app'), /https/);
  assert.match(problem('not a url'), /Invalid/);
  // manifest.json allows https://*.locize.app, which needs a subdomain.
  assert.match(problem('https://locize.app'), /not allowed/);
  assert.match(problem('https://evil.com'), /not allowed/);
});

test('a base URL is normalised before use', () => {
  const ui = loadUi();
  const normalise = (url) => ui.eval(`normalizeApiBase(${JSON.stringify(url)})`);

  assert.equal(normalise(''), 'https://api.locize.app', 'empty falls back to the default');
  assert.equal(normalise('   '), 'https://api.locize.app');
  assert.equal(normalise('https://api.lite.locize.app///'), 'https://api.lite.locize.app', 'trailing slashes are stripped');
});
