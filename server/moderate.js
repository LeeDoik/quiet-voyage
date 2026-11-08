// Letters people write themselves are checked before they float: TypeSafe AI's Jev answers three
// yes/no questions about the text (profanity, attacks, contact details) and any "yes" above the
// threshold stops the letter. The key stays on the server (env.TYPESAFE_API_KEY); without it, or when
// the check cannot be made, nothing free-written is floated (fail closed).

export const LETTER_MAX = 60;            // characters (code points), a few short lines on the letter
export const BLOCK_AT = .5;
const ENDPOINT = 'https://api.typesafe.ai/v1/systemone', TIMEOUT_MS = 4000;

export const QUESTIONS = {
  profanity: { type: 'noul', instructions: '편지에 욕설이나 비속어가 있는가? 초성 줄임말(ㅅㅂ, ㅄ, ㄱㅅㄲ 등)과 숫자·기호를 섞거나 띄어 쓴 변형도 욕설로 본다. 다만 "개크다", "미친듯이 예쁜", "죽을 만큼 행복한"처럼 감탄이나 강조로 쓴 말은 욕설이 아니다.' },
  attack: { type: 'noul', instructions: '편지가 사람이나 집단을 모욕, 비방, 조롱, 위협하거나 혐오(장애, 성별, 지역, 인종 등)를 드러내거나, 성적인 내용을 담는가?' },
  contact: { type: 'noul', instructions: '편지가 전화번호, 카카오톡·인스타그램 등 메신저나 SNS 아이디, 이메일, 집 주소, 실명 같은 연락처나 개인정보를 남기거나 연락을 유도하는가? 게임 속 섬이나 시간 약속은 개인정보가 아니다.' },
};

/** The letter as it will be stored and shown: control characters out, spaces collapsed, trimmed. */
export function cleanLetter(text) {
  if (typeof text !== 'string') return '';
  const flat = text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(flat).slice(0, LETTER_MAX).join('');
}

/** Digits and symbols squeezed between Hangul ("병1신", "씨-발") dropped, for a second reading. */
export const squeeze = s => s.replace(/(?<=[ㄱ-ㆎ가-힣])[\p{P}\p{S}\p{N}_]+(?=[ㄱ-ㆎ가-힣])/gu, '');

/**
 * Check one letter. Resolves {ok: true} or {ok: false, reason: 'blocked' | 'unavailable', scores?}.
 * `fetcher` is injectable for tests.
 */
export async function moderateLetter(text, key, fetcher = fetch) {
  if (!key) return { ok: false, reason: 'unavailable' };
  const flat = squeeze(text), state = flat === text ? text : { letter: text, without_symbols: flat };
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const response = await fetcher(ENDPOINT, {
      method: 'POST', signal: abort.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'jev-latest', state, questions: QUESTIONS }),
    });
    if (!response.ok) return { ok: false, reason: 'unavailable' };
    const answers = (await response.json())?.answers ?? {};
    const scores = {};
    for (const name of Object.keys(QUESTIONS)) {
      const p = Number(answers[name]?.noul);
      if (!Number.isFinite(p)) return { ok: false, reason: 'unavailable' };
      scores[name] = p;
    }
    return Object.values(scores).some(p => p >= BLOCK_AT) ? { ok: false, reason: 'blocked', scores } : { ok: true, scores };
  } catch {
    return { ok: false, reason: 'unavailable' };
  } finally {
    clearTimeout(timer);
  }
}
