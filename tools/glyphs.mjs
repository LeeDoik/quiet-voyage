// The closed set of characters the HUD can draw: every string literal in the game's source
// (comments and regexes skipped) plus printable ASCII. tools/fonts.mjs cuts the fonts to these
// sets and tests/fonts.mjs checks the cut fonts still hold them. Text from other players (boat
// names) is outside the set on purpose: the font stacks fall back to system fonts for it.
import { readFileSync, readdirSync } from 'node:fs';
import { basename } from 'node:path';

const SRC = new URL('../public/src/', import.meta.url);
const CONTRACT = new Set(['studio.js', 'hud.js']); // studio contract files: console messages only


const KEYWORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
const ESCAPES = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' };

function escapeAt(code, i) {
  const c = code[i];
  if (c === 'u' && code[i + 1] === '{') { const end = code.indexOf('}', i); return [String.fromCodePoint(parseInt(code.slice(i + 2, end), 16)), end + 1]; }
  if (c === 'u') return [String.fromCharCode(parseInt(code.slice(i + 1, i + 5), 16)), i + 5];
  if (c === 'x') return [String.fromCharCode(parseInt(code.slice(i + 1, i + 3), 16)), i + 3];
  if (c === '\n') return ['', i + 1];
  return [ESCAPES[c] ?? c, i + 1];
}

/** The text of a quoted string or template part starting at `i`: [text, next index, stopped at `${`]. */
function readText(code, i, quote) {
  let s = '';
  while (i < code.length) {
    const c = code[i];
    if (c === '\\') { const [e, j] = escapeAt(code, i + 1); s += e; i = j; continue; }
    if (c === quote) return [s, i + 1, false];
    if (quote === '`' && c === '$' && code[i + 1] === '{') return [s, i + 2, true];
    s += c; i++;
  }
  return [s, i, false];
}

function skipRegex(code, i) {
  let inClass = false;
  for (; i < code.length; i++) {
    const c = code[i];
    if (c === '\\') { i++; continue; }
    if (c === '\n') return i;
    if (inClass) { if (c === ']') inClass = false; }
    else if (c === '[') inClass = true;
    else if (c === '/') { i++; while (/[a-z]/i.test(code[i] ?? '')) i++; return i; }
  }
  return i;
}

/** Every string literal in `code` (template literals give their text parts), in source order. */
export function literals(code) {
  const out = [], holes = []; // holes: the brace depth at each open `${`
  let i = 0, depth = 0, prev = '', word = '';
  while (i < code.length) {
    const c = code[i];
    if (c === '/' && code[i + 1] === '/') { const j = code.indexOf('\n', i); i = j < 0 ? code.length : j; continue; }
    if (c === '/' && code[i + 1] === '*') { const j = code.indexOf('*/', i + 2); i = j < 0 ? code.length : j + 2; continue; }
    let quote = c === "'" || c === '"' || c === '`' ? c : null;
    if (c === '}' && holes.length && holes[holes.length - 1] === depth) { holes.pop(); quote = '`'; }
    if (quote) {
      const [s, j, hole] = readText(code, i + 1, quote);
      out.push(s); i = j; prev = 'a'; word = '';
      if (hole) holes.push(depth);
      continue;
    }
    if (c === '/' && (!prev || '(,=:[!&|?{};+-*%<>~^'.includes(prev) || KEYWORDS.has(word))) { i = skipRegex(code, i + 1); prev = 'a'; word = ''; continue; }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    if (!/\s/.test(c)) { word = /[\w$]/.test(c) ? (/[\w$]/.test(prev) ? word + c : c) : ''; prev = c; }
    i++;
  }
  return out;
}

const source = file => readFileSync(new URL(file, SRC), 'utf8');
/** Every string literal of the game's source files. */
export function gameStrings() {
  return readdirSync(SRC, { recursive: true })
    .filter(file => file.endsWith('.js') && !CONTRACT.has(basename(file)))
    .flatMap(file => literals(source(file)));
}

export const ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');
const KOREAN = /[ᄀ-ᇿ㄰-㆏가-힯]/u;
// Invisible format characters (e.g. U+2063, bottles.js WRITTEN) are never drawn, so no font needs them.
const set = (...texts) => [...new Set(texts.join(''))].filter(c => c >= ' ' && c !== '\u007f' && !/\p{Cf}/u.test(c)).sort().join('');

// English text comes from i18n.js itself, read with the browser language forced to English.
Object.defineProperty(globalThis, 'navigator', { value: { language: 'en' }, configurable: true });
const { t } = await import('../public/src/i18n.js');

/**
 * The characters each face must hold, per language: { ko: { serif, hand }, en: { serif, hand } }.
 * The handwriting face holds every game string too, not a list of handwritten titles: any two-line
 * notice (an island's concept and its reply, a moment, a bottle) is drawn in handwriting, and a
 * character missing from the pen face fell back to the serif mid-word. Symbols a pen face lacks
 * still come from the serif behind it in the font stack (interface.js HAND).
 */
export function glyphSets() {
  const all = set(ASCII, ...gameStrings());
  const latin = text => [...text].filter(c => !KOREAN.test(c)).join('');
  return {
    ko: { serif: all, hand: all },
    en: { serif: latin(all), hand: latin(all) },
  };
}

/** Hangul in a set: what the Korean pen face itself must draw (never borrowed from the serif). */
export const hangul = text => [...text].filter(c => KOREAN.test(c)).join('');
