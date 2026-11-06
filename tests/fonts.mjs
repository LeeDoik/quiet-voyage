import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { glyphSets } from '../tools/glyphs.mjs';
// Every character a game string can put on screen is in the cut font that draws it.
const dir = new URL('../public/assets/fonts/', import.meta.url);
const fonts = JSON.parse(readFileSync(new URL('glyphs.json', dir), 'utf8'));
const g = glyphSets();
const check = (face, need, files) => {
  const held = new Set(files.flatMap(file => { assert(statSync(new URL(file, dir)).size > 0, `${file} is missing`); return [...fonts[file].chars]; }));
  const missing = [...need].filter(c => !held.has(c)).map(c => `${c} U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
  assert.deepEqual(missing, [], `${face} (${files.join(' + ')}) lacks ${missing.join(', ')}; run node tools/fonts.mjs`);
};
check('Korean serif', g.ko.serif, ['qv-serif-ko.woff2']);
check('Korean hand', g.ko.hand, ['qv-hand-ko.woff2']);
check('English serif', g.en.serif, ['qv-serif.woff2', 'qv-symbols.woff2']);
check('English hand', g.en.hand, ['qv-hand.woff2']);
console.log(`fonts: ${[...g.ko.serif].length} Korean and ${[...g.en.serif].length} English characters, all in their subsets`);
