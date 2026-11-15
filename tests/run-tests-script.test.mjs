import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {locateEngine, pinnedEngineRevision} from '../scripts/run-tests.mjs';

test('test runner reads the exact pinned Audio Engine revision from CI', async () => {
  const workflow = await readFile(new URL('../.github/workflows/radio.yml', import.meta.url), 'utf8');
  assert.match(pinnedEngineRevision(workflow), /^[0-9a-f]{40}$/);
  assert.equal(pinnedEngineRevision('repository: other/repo\n  ref: ' + 'a'.repeat(40)), null);
  assert.match(workflow, /DRE_REQUIRE_AUDIO_ENGINE: '1'/, 'hosted CI must fail instead of skipping DAE-backed suites');
});

test('test runner locates an engine build explicitly and never invents one', () => {
  const base = '/work/dre';
  const only = path => candidate => candidate === path;
  assert.equal(locateEngine({}, base, () => false), null);
  assert.throws(() => locateEngine({AUDIO_ENGINE_MODULE: '/missing.js'}, base, () => false), /does not exist/);
  assert.equal(locateEngine({AUDIO_ENGINE_MODULE: '/x/index.js'}, base, only('/x/index.js')).source, 'environment');
  const pinned = join(base, '.deps', 'audio-core', 'dist', 'src', 'index.js');
  assert.equal(locateEngine({}, base, only(pinned)).path, pinned);
  const sibling = join(resolve(base, '..', 'distributed-audio-engine'), 'dist', 'src', 'index.js');
  assert.equal(locateEngine({}, base, only(sibling)).source, 'sibling checkout');
});
