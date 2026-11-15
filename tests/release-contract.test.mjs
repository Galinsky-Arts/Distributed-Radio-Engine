import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {publicApi} from '../scripts/public-api.mjs';

// DRE-28 acceptance: the reusable engine has a locked consumer surface, no
// consumer-product dependency or branding, and makes no production claim.
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('public consumer API matches the reviewed snapshot exactly', async () => {
  const expected = JSON.parse(await read('docs/public-api.json'));
  assert.deepEqual(await publicApi(), expected,
    'Exports changed: review the consumer impact, update CHANGELOG.md, then regenerate with scripts/public-api.mjs --write');
});

test('engine source carries no consumer application dependency or branding', async () => {
  const pkg = JSON.parse(await read('package.json'));
  const deps = Object.keys({...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies});
  assert.ok(deps.every(name => !/trackzero|scenesignal/i.test(name)), `consumer dependency: ${deps}`);
  const files = (await readdir(new URL('../src/', import.meta.url))).filter(name => name.endsWith('.mjs'));
  assert.ok(files.length > 20);
  for (const file of [...files.map(name => `src/${name}`), 'preview-server.mjs']) {
    const text = await read(file);
    assert.doesNotMatch(text, /track\s*zero|scene\s*signal/i, `${file} references a consumer product`);
  }
});

test('package and preview make no stable or production-ready claim before assurance gates', async () => {
  const pkg = JSON.parse(await read('package.json'));
  assert.equal(pkg.private, true);
  assert.match(pkg.version, /^0\.\d+\.\d+-(dev|rc\.\d+)$/, 'stable version requires recorded field/assurance evidence');
  const {createPreviewServer} = await import('../preview-server.mjs');
  const server = createPreviewServer().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const ready = await fetch(`${base}/readyz`);
    assert.equal(ready.status, 503);
    const status = await (await fetch(`${base}/api/status`)).json();
    assert.equal(status.productionReady, false);
    assert.equal(status.broadcasting, false);
    assert.match(status.repo, /^https:\/\/github\.com\/Galinsky-Arts\/Distributed-Radio-Engine$/);
  } finally { server.close(); }
});

test('changelog documents the release candidate and its unverified gates', async () => {
  const changelog = await read('CHANGELOG.md');
  const pkg = JSON.parse(await read('package.json'));
  assert.ok(changelog.includes(`## ${pkg.version}`), 'CHANGELOG.md must describe the current version');
  assert.match(changelog, /not production/i);
});
