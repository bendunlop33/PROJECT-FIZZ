/**
 * ID-token RS256 signature check against OpenAI's JWKS (ADR 0012 open item,
 * ADR 0019 C0, review S5). Pure TypeScript: `BigInt` modular exponentiation
 * and the PKCS#1 v1.5 (RFC 8017 §8.2.2, EMSA-PKCS1-v1_5) encoding check, with
 * SHA-256 from the injected `CryptoPort` (expo-crypto on the phone). No new
 * dependency. The JWKS URI is read from the discovery document; there is no
 * guessed fallback, so a missing or unreadable JWKS fails the check honestly.
 *
 * Needs a real-device run before it is called working: Hermes has `BigInt`,
 * but the check has only run in Node tests so far.
 */

import { base64UrlDecode, err, ok, parseJsonObject, readTextSafely, stringField, utf8Decode, utf8Encode, type CryptoPort, type Result } from '../http';
import { OPENAI_DISCOVERY_URL } from './constants';
import { failure, type ProviderFailure } from './errors';
import { timedFetch, type TokenCallOptions } from './tokens';

export interface RsaPublicKey {
  kid: string | null;
  n: bigint;
  e: bigint;
  /** Modulus length in bytes. */
  k: number;
}

/** DER prefix of DigestInfo for SHA-256 (RFC 8017 §9.2 note 1). */
const SHA256_DIGEST_INFO = [0x30, 0x31, 0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00, 0x04, 0x20];
/** Below this an RSA key is too weak to trust. */
const MIN_MODULUS_BYTES = 256;

function bytesToBigInt(bytes: Uint8Array): bigint {
  let x = 0n;
  for (const b of bytes) x = (x << 8n) | BigInt(b);
  return x;
}

function bigIntToBytes(x: bigint, length: number): Uint8Array | null {
  const out = new Uint8Array(length);
  let v = x;
  for (let i = length - 1; i >= 0; i -= 1) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return v === 0n ? out : null;
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let b = base % modulus;
  let e = exponent;
  while (e > 0n) {
    if ((e & 1n) === 1n) result = (result * b) % modulus;
    e >>= 1n;
    b = (b * b) % modulus;
  }
  return result;
}

function stripLeadingZeros(bytes: Uint8Array): Uint8Array {
  let i = 0;
  while (i < bytes.length - 1 && bytes[i] === 0) i += 1;
  return bytes.subarray(i);
}

/** RSA signature keys from a JWKS document. Keys for other algorithms or uses are skipped. */
export function parseJwks(text: string): RsaPublicKey[] {
  const j = parseJsonObject(text);
  const keys = Array.isArray(j?.keys) ? (j.keys as unknown[]) : [];
  const out: RsaPublicKey[] = [];
  for (const raw of keys) {
    if (typeof raw !== 'object' || raw === null) continue;
    const key = raw as Record<string, unknown>;
    if (key.kty !== 'RSA') continue;
    if (key.use !== undefined && key.use !== 'sig') continue;
    if (key.alg !== undefined && key.alg !== 'RS256') continue;
    const nBytes = typeof key.n === 'string' ? base64UrlDecode(key.n) : null;
    const eBytes = typeof key.e === 'string' ? base64UrlDecode(key.e) : null;
    if (nBytes === null || eBytes === null) continue;
    const n = stripLeadingZeros(nBytes);
    if (n.length < MIN_MODULUS_BYTES) continue;
    out.push({ kid: typeof key.kid === 'string' ? key.kid : null, n: bytesToBigInt(n), e: bytesToBigInt(eBytes), k: n.length });
  }
  return out;
}

export interface JwtHeader {
  alg: string | null;
  kid: string | null;
}

export function decodeJwtHeader(jwt: string): JwtHeader | null {
  const head = jwt.split('.')[0];
  if (head === undefined) return null;
  const bytes = base64UrlDecode(head);
  if (bytes === null) return null;
  const j = parseJsonObject(utf8Decode(bytes));
  if (j === null) return null;
  return { alg: stringField(j, 'alg') ?? null, kid: stringField(j, 'kid') ?? null };
}

/** RSASSA-PKCS1-v1_5 verification with SHA-256 against one key. */
export async function verifyRs256(signingInput: Uint8Array, signature: Uint8Array, key: RsaPublicKey, crypto: Pick<CryptoPort, 'sha256'>): Promise<boolean> {
  if (signature.length !== key.k) return false;
  const s = bytesToBigInt(signature);
  if (s >= key.n) return false;
  const em = bigIntToBytes(modPow(s, key.e, key.n), key.k);
  if (em === null) return false;
  const hash = await crypto.sha256(signingInput);
  const t = [...SHA256_DIGEST_INFO, ...hash];
  const psLength = key.k - t.length - 3;
  if (psLength < 8) return false;
  const expected = [0x00, 0x01, ...new Array<number>(psLength).fill(0xff), 0x00, ...t];
  // Compare every byte (no early exit).
  let diff = 0;
  for (let i = 0; i < key.k; i += 1) diff |= (em[i] ?? 0) ^ (expected[i] ?? 0);
  return diff === 0;
}

/** Verifies a JWT's RS256 signature against the given keys. Only `RS256` is accepted (never `none` or HMAC). */
export async function verifyJwtSignature(jwt: string, keys: readonly RsaPublicKey[], crypto: Pick<CryptoPort, 'sha256'>): Promise<Result<void, ProviderFailure>> {
  const parts = jwt.split('.');
  if (parts.length !== 3) return err(failure('id_token_invalid', 'ID token could not be read'));
  const header = decodeJwtHeader(jwt);
  if (header?.alg !== 'RS256') return err(failure('id_token_invalid', `ID token algorithm is ${header?.alg ?? 'missing'}, not RS256`));
  const signature = base64UrlDecode(parts[2] ?? '');
  if (signature === null) return err(failure('id_token_invalid', 'ID token signature could not be read'));
  const candidates = header.kid === null ? keys : keys.filter((k) => k.kid === header.kid);
  if (candidates.length === 0) return err(failure('id_token_invalid', 'No OpenAI signing key matches the ID token'));
  const input = utf8Encode(`${parts[0] ?? ''}.${parts[1] ?? ''}`);
  for (const key of candidates) {
    if (await verifyRs256(input, signature, key, crypto)) return ok(undefined);
  }
  return err(failure('id_token_invalid', 'ID token signature does not match OpenAI’s signing key'));
}

/** Reads `jwks_uri` from discovery, then the JWKS. Only https URLs on auth.openai.com are followed. */
export async function fetchOpenAiJwks(options: TokenCallOptions): Promise<Result<RsaPublicKey[], ProviderFailure>> {
  const disc = await timedFetch(OPENAI_DISCOVERY_URL, { method: 'GET', headers: { Accept: 'application/json' } }, options);
  if (!disc.ok) return disc;
  if (!disc.value.ok) return err(failure('protocol', `Discovery document returned HTTP ${String(disc.value.status)}`));
  const uri = stringField(parseJsonObject(await readTextSafely(disc.value)), 'jwks_uri');
  if (uri === undefined || !uri.startsWith('https://auth.openai.com/')) return err(failure('protocol', 'Discovery document has no usable jwks_uri'));
  const sent = await timedFetch(uri, { method: 'GET', headers: { Accept: 'application/json' } }, options);
  if (!sent.ok) return sent;
  if (!sent.value.ok) return err(failure('protocol', `JWKS returned HTTP ${String(sent.value.status)}`));
  const keys = parseJwks(await readTextSafely(sent.value));
  if (keys.length === 0) return err(failure('protocol', 'JWKS has no RSA signing keys'));
  return ok(keys);
}

/**
 * The full check used at sign-in: fetch the JWKS (fresh each sign-in; sign-in
 * is rare, so no cache to go stale) and verify the ID token's signature.
 */
export async function verifyIdTokenSignature(idToken: string, options: TokenCallOptions & { crypto: Pick<CryptoPort, 'sha256'> }): Promise<Result<void, ProviderFailure>> {
  const keys = await fetchOpenAiJwks(options);
  if (!keys.ok) return keys;
  return verifyJwtSignature(idToken, keys.value, options.crypto);
}
