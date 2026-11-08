import assert from 'node:assert/strict';
import { cleanLetter, squeeze, moderateLetter, LETTER_MAX, QUESTIONS } from '../server/moderate.js';
// Cleaning: control characters out, spaces collapsed, cut by code point (emoji count once).
assert.equal(cleanLetter('  좋은\n\n바람 \u0000이\t함께하길 '), '좋은 바람 이 함께하길');
assert.equal(Array.from(cleanLetter('🌊'.repeat(80))).length, LETTER_MAX);
assert.equal(cleanLetter(42), '');
// Symbols squeezed between Hangul for the second reading; plain text untouched.
assert.equal(squeeze('병1신'), '병신'); assert.equal(squeeze('씨-발'), '씨발'); assert.equal(squeeze('좋은 바람'), '좋은 바람');
// A fake Jev: scores by question name.
const jev = scores => async (url, init) => {
  const body = JSON.parse(init.body);
  assert.equal(body.model, 'jev-latest'); assert.deepEqual(Object.keys(body.questions), Object.keys(QUESTIONS));
  assert.equal(init.headers.Authorization, 'Bearer k');
  return { ok: true, json: async () => ({ answers: Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, { type: 'noul', noul: v }])) }) };
};
assert.deepEqual((await moderateLetter('고래를 봤어요', 'k', jev({ profanity: .02, attack: .02, contact: .03 }))).ok, true);
assert.equal((await moderateLetter('...', 'k', jev({ profanity: .02, attack: .9, contact: .03 }))).reason, 'blocked');
assert.equal((await moderateLetter('...', 'k', jev({ profanity: .02, attack: .02, contact: .5 }))).reason, 'blocked', 'the threshold blocks');
// Fail closed: no key, an HTTP error, a missing answer, a network failure.
assert.equal((await moderateLetter('hi', '', jev({}))).reason, 'unavailable');
assert.equal((await moderateLetter('hi', 'k', async () => ({ ok: false }))).reason, 'unavailable');
assert.equal((await moderateLetter('hi', 'k', jev({ profanity: .01 }))).reason, 'unavailable');
assert.equal((await moderateLetter('hi', 'k', async () => { throw new Error('down'); })).reason, 'unavailable');
// The squeezed reading is sent alongside the letter when it differs.
let state = null;
await moderateLetter('병1신', 'k', async (u, init) => { state = JSON.parse(init.body).state; return { ok: false }; });
assert.deepEqual(state, { letter: '병1신', without_symbols: '병신' });
console.log('moderate: cleaning, squeezing, threshold and fail-closed checks passed');
