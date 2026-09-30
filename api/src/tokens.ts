// Random tokens and human-typeable codes. Codes use an alphabet without 0/O/1/I/L,
// so a student reading one off a notice board cannot confuse two characters.

export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** A 32-byte random token, base64url (the session cookie, feed tokens). */
export const randomToken = (bytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** `length` characters from CODE_ALPHABET, without modulo bias (bytes >= 248 are redrawn). */
export function randomCode(length: number): string {
  const limit = 256 - (256 % CODE_ALPHABET.length);
  let out = '';
  while (out.length < length) {
    for (const b of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (b < limit && out.length < length) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
    }
  }
  return out;
}

/** A batch's class code: "CSE-2A" → "CSE2A-K7QD". */
export function batchCode(batchName: string): string {
  const prefix = batchName.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'CLASS';
  return `${prefix}-${randomCode(4)}`;
}

export const inviteCode = () => `INV-${randomCode(10)}`;
export const resetCode = () => `${randomCode(4)}-${randomCode(4)}`;

/** Codes are case-insensitive and people paste them with stray spaces. */
export const normalizeCode = (code: string) => code.trim().toUpperCase();
