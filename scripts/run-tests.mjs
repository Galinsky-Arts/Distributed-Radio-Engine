// Runs the radio suite against an actual Distributed Audio Engine build so the
// DAE-backed commerce and ciphertext suites never skip silently.
//
// Resolution order for AUDIO_ENGINE_MODULE:
//   1. the AUDIO_ENGINE_MODULE environment variable (must exist);
//   2. .deps/audio-core/dist/src/index.js (the CI checkout location);
//   3. a sibling ../distributed-audio-engine or ../Distributed-Audio-Engine build;
//   4. with DRE_BUILD_AUDIO_ENGINE=1, clone the revision pinned in
//      .github/workflows/radio.yml into .deps/audio-core and build it.
// Without an engine, DRE_REQUIRE_AUDIO_ENGINE=1 fails; otherwise the run
// continues and prints exactly which suites were skipped and why.
import {spawnSync} from 'node:child_process';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const engineEntry = dir => join(dir, 'dist', 'src', 'index.js');

export function pinnedEngineRevision(workflowText) {
  const match = /repository:\s*Galinsky-Arts\/Distributed-Audio-Engine\s*\n\s*ref:\s*([0-9a-f]{40})\b/.exec(workflowText);
  return match ? match[1] : null;
}

export function locateEngine(env = process.env, base = root, exists = existsSync) {
  if (env.AUDIO_ENGINE_MODULE) {
    if (!exists(env.AUDIO_ENGINE_MODULE)) throw new Error(`AUDIO_ENGINE_MODULE does not exist: ${env.AUDIO_ENGINE_MODULE}`);
    return {path: resolve(env.AUDIO_ENGINE_MODULE), source: 'environment'};
  }
  const candidates = [
    [join(base, '.deps', 'audio-core'), 'pinned checkout (.deps/audio-core)'],
    [resolve(base, '..', 'distributed-audio-engine'), 'sibling checkout'],
    [resolve(base, '..', 'Distributed-Audio-Engine'), 'sibling checkout'],
  ];
  for (const [dir, source] of candidates) if (exists(engineEntry(dir))) return {path: engineEntry(dir), source, dir};
  return null;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {stdio: 'inherit', ...options});
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.status ?? result.signal})`);
}

function buildPinnedEngine() {
  const revision = pinnedEngineRevision(readFileSync(join(root, '.github', 'workflows', 'radio.yml'), 'utf8'));
  if (!revision) throw new Error('No pinned Distributed-Audio-Engine revision in .github/workflows/radio.yml');
  const dir = join(root, '.deps', 'audio-core');
  if (!existsSync(join(dir, '.git'))) run('git', ['clone', '--filter=blob:none', '--no-checkout',
    'https://github.com/Galinsky-Arts/Distributed-Audio-Engine.git', dir]);
  run('git', ['-C', dir, 'fetch', '--depth=1', 'origin', revision]);
  run('git', ['-C', dir, 'checkout', '--detach', revision]);
  run('npm', ['ci', '--ignore-scripts'], {cwd: dir});
  run('npm', ['run', 'build'], {cwd: dir});
  return {path: engineEntry(dir), source: `built pinned revision ${revision}`, dir};
}

function headOf(dir) {
  if (!dir) return null;
  const result = spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD'], {encoding: 'utf8'});
  return result.status === 0 ? result.stdout.trim() : null;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let engine = locateEngine();
  if (!engine && process.env.DRE_BUILD_AUDIO_ENGINE === '1') engine = buildPinnedEngine();
  const env = {...process.env};
  if (engine) {
    env.AUDIO_ENGINE_MODULE = engine.path;
    const pinned = pinnedEngineRevision(readFileSync(join(root, '.github', 'workflows', 'radio.yml'), 'utf8'));
    const head = headOf(engine.dir);
    console.log(`Audio Engine: ${engine.path} (${engine.source}${head ? `, HEAD ${head}` : ''})`);
    if (head && pinned && head !== pinned) console.log(`Note: engine HEAD differs from pinned CI revision ${pinned}; hosted CI tests the pin.`);
  } else if (process.env.DRE_REQUIRE_AUDIO_ENGINE === '1') {
    console.error('DRE_REQUIRE_AUDIO_ENGINE=1 but no Audio Engine build was found. Set AUDIO_ENGINE_MODULE, build ../distributed-audio-engine, or set DRE_BUILD_AUDIO_ENGINE=1.');
    process.exit(1);
  } else {
    console.warn('WARNING: no Audio Engine build found. DAE-backed suites (mixed-content pilot, Stripe/DAE checkout, whole-work commerce) WILL BE SKIPPED.\n' +
      'Set AUDIO_ENGINE_MODULE, build ../distributed-audio-engine, set DRE_BUILD_AUDIO_ENGINE=1, or DRE_REQUIRE_AUDIO_ENGINE=1 to fail instead.');
  }
  const tests = readdirSync(join(root, 'tests')).filter(name => name.endsWith('.test.mjs')).sort().map(name => join('tests', name));
  const result = spawnSync(process.execPath, ['--test', ...tests], {cwd: root, env, stdio: 'inherit'});
  if (!engine) console.warn('WARNING: DAE-backed suites were skipped (no Audio Engine build).');
  process.exit(result.status ?? 1);
}
