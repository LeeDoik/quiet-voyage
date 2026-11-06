// Regenerate the HUD fonts: node tools/fonts.mjs
// Fetches the OFL sources from one pinned google/fonts commit (cached in node_modules/.cache),
// cuts each to the characters tools/glyphs.mjs lists, writes WOFF2 into public/assets/fonts/ with
// the licences, and glyphs.json: the characters each file holds (tests/fonts.mjs checks it).
// Needs Python fontTools and brotli (`python3 -m pip install --user fonttools brotli`) or uv.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { glyphSets } from './glyphs.mjs';

const COMMIT = 'eb20e9cf19d97cf579fa3867d729d4222d6c59e1';
const OUT = fileURLToPath(new URL('../public/assets/fonts/', import.meta.url));
const CACHE = fileURLToPath(new URL('../node_modules/.cache/qv-fonts/', import.meta.url));
const SCRIPT = fileURLToPath(new URL('subset-fonts.py', import.meta.url));
const LICENCE = { gowunbatang: 'GowunBatang', nanumpenscript: 'NanumPenScript', lora: 'Lora', caveat: 'Caveat' };

/** A file of google/fonts ofl/<dir>/, downloaded once into its own cache folder. */
async function fetchSource(dir, file) {
  const path = `${CACHE}${dir}/${file}`;
  if (existsSync(path)) return path;
  const res = await fetch(`https://raw.githubusercontent.com/google/fonts/${COMMIT}/ofl/${dir}/${encodeURIComponent(file)}`);
  if (!res.ok) throw new Error(`google/fonts ofl/${dir}/${file}: HTTP ${res.status}`);
  mkdirSync(`${CACHE}${dir}`, { recursive: true });
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  return path;
}

const python = (() => {
  try { execFileSync('python3', ['-I', '-c', 'import fontTools, brotli'], { stdio: 'ignore' }); return ['python3']; }
  catch { return ['uv', 'run', '--no-project', '--with', 'fonttools', '--with', 'brotli', 'python']; }
})();
async function cut(faces) {
  const jobs = [];
  for (const [out, family, dir, file, text, wght] of faces) jobs.push({ src: await fetchSource(dir, file), out: OUT + out, family, text, ...(wght ? { wght } : {}) });
  const list = `${CACHE}jobs.json`;
  writeFileSync(list, JSON.stringify(jobs));
  const held = JSON.parse(execFileSync(python[0], [...python.slice(1), '-I', SCRIPT, list], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));
  return Object.fromEntries(faces.map(([out, family, dir, file, , wght]) => [out, { family, source: `${file}${wght ? ` at wght ${wght}` : ''} from google/fonts@${COMMIT.slice(0, 12)} ofl/${dir}`, licence: `OFL-${LICENCE[dir]}.txt`, chars: held[OUT + out] }]));
}

const g = glyphSets();
mkdirSync(OUT, { recursive: true });
const fonts = await cut([
  ['qv-serif-ko.woff2', 'QV Serif KO', 'gowunbatang', 'GowunBatang-Regular.ttf', g.ko.serif],
  ['qv-hand-ko.woff2', 'QV Hand KO', 'nanumpenscript', 'NanumPenScript-Regular.ttf', g.ko.hand],
  ['qv-serif.woff2', 'QV Serif', 'lora', 'Lora[wght].ttf', g.en.serif, 400],
  ['qv-hand.woff2', 'QV Hand', 'caveat', 'Caveat[wght].ttf', g.en.hand, 600],
]);
// Lora has no arrows or geometric shapes (◆ ▲ ←): English takes those from Gowun Batang.
const rest = [...g.en.serif].filter(c => !fonts['qv-serif.woff2'].chars.includes(c)).join('');
Object.assign(fonts, await cut([['qv-symbols.woff2', 'QV Symbols', 'gowunbatang', 'GowunBatang-Regular.ttf', rest]]));
for (const dir of Object.keys(LICENCE)) copyFileSync(await fetchSource(dir, 'OFL.txt'), `${OUT}OFL-${LICENCE[dir]}.txt`);
writeFileSync(`${OUT}glyphs.json`, `${JSON.stringify(fonts, null, 2)}\n`);
for (const [file, { chars }] of Object.entries(fonts)) console.log(`${file}  ${(statSync(OUT + file).size / 1024).toFixed(1)} KB  ${[...chars].length} characters`);
