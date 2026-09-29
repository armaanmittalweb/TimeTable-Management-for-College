// PBKDF2-SHA256 via WebCrypto. The Express server used bcrypt (cost 10), which
// is ~100 ms of CPU in pure JS and would blow the Workers free-plan budget
// (~10 ms CPU per request). deriveBits runs natively; 20k iterations is ~4 ms.
// The iteration count is stored in each hash, so it can be raised later.
// Format: pbkdf2_sha256$<iterations>$<salt b64>$<hash b64>

export const PBKDF2_ITERATIONS = 20_000;
const MAX_ITERATIONS = 100_000; // Workers rejects more than this

const encoder = new TextEncoder();
const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2_sha256$${iterations}$${toB64(salt)}$${toB64(await derive(password, salt, iterations))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split('$');
  const iterations = Number(iter);
  if (scheme !== 'pbkdf2_sha256' || !salt || !hash) return false;
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) return false;
  let actual: Uint8Array, expected: Uint8Array;
  try {
    expected = fromB64(hash);
    actual = await derive(password, fromB64(salt), iterations);
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}
