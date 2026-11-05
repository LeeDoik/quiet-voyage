// Where the game is running and what that allows. The studio preview (no meta tags) keeps every
// developer tool and the Genex multiplayer path; the standalone web build (meta tags written by
// tools/build-standalone.mjs) hides developer tools from players and talks to our own server.
//
//   <meta name="sea-platform" content="web">
//   <meta name="sea-server" content="">            empty = same origin /ws, or a full wss:// URL
//   <meta name="sea-dev-hash" content="<sha256>">  sha-256 of the owner's ?dev=<key>

const meta = name => (typeof document === 'object' ? document.querySelector(`meta[name="${name}"]`)?.content?.trim() : undefined);
const kind = meta('sea-platform') === 'web' ? 'web' : 'studio';

function readStore(key) { try { return localStorage.getItem(key); } catch { return null; } }
function writeStore(key, value) { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* storage is a convenience */ } }

function serverUrl() {
  if (kind !== 'web') return null;
  const configured = meta('sea-server');
  if (configured === 'off') return null;
  if (configured) return configured;
  if (typeof location !== 'object') return null;
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
}

const local = typeof location === 'object' && /^(localhost|127\.|\[::1\])/.test(location.hostname);
let dev = kind === 'studio' || (local && readStore('sea.dev') !== 'off');

// ?dev=<key> unlocks developer tools for the owner on the public site and is remembered on this
// browser; ?dev=off forgets it. Only the key's hash ships in the page.
async function checkDevKey() {
  if (kind !== 'web' || typeof location !== 'object') return;
  const key = new URLSearchParams(location.search).get('dev');
  if (key === 'off') { writeStore('sea.dev', 'off'); dev = false; return; }
  if (readStore('sea.dev') === 'on' && !key) { dev = true; return; }
  const expected = meta('sea-dev-hash');
  if (!key || !expected || !crypto?.subtle) return;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  if (hex === expected) { dev = true; writeStore('sea.dev', 'on'); }
}
void checkDevKey();

// A per-browser random source for things outside the simulation (spawn point, boat id/name).
function entropy() {
  if (typeof crypto === 'object' && crypto.getRandomValues) return crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
  return 0.5;
}

export const platform = {
  kind,
  get web() { return kind === 'web'; },
  get dev() { return dev; },
  server: serverUrl(),
  touch: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
  persist: kind === 'web',
  read: readStore,
  write: writeStore,
  entropy,
};
