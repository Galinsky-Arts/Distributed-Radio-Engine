// Lists the exported names of every package entry point. Used by the release
// contract test and to regenerate docs/public-api.json deliberately:
//   AUDIO_ENGINE_MODULE=... node scripts/public-api.mjs --write
import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {dirname, resolve} from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function publicApi() {
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const surface = {};
  for (const [subpath, target] of Object.entries(pkg.exports).sort(([a], [b]) => a.localeCompare(b))) {
    const module = await import(pathToFileURL(resolve(root, target)).href);
    surface[subpath] = Object.keys(module).sort();
  }
  return surface;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const surface = await publicApi();
  const text = `${JSON.stringify(surface, null, 2)}\n`;
  if (process.argv.includes('--write')) await writeFile(resolve(root, 'docs/public-api.json'), text);
  else process.stdout.write(text);
}
