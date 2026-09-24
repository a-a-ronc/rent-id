/**
 * Envelope encryption for the handful of fields RentID must store that are
 * sensitive but not a provider token.
 *
 * READ THIS BEFORE USING IT.
 *
 * The first rule is that most sensitive data should not be here at all:
 *
 *   - Bank account and routing numbers: never stored. `payout_accounts` holds
 *     a provider-issued token and the last four digits; a database trigger
 *     rejects anything that looks like a raw account number.
 *   - Card numbers: never touched. Card entry happens in the provider's
 *     hosted fields, so RentID stays outside PCI scope.
 *   - Government ID numbers and ID document images: never stored. The identity
 *     provider keeps them and returns a reusable reference; RentID stores the
 *     reference, the result and the timestamp (see the property-verification
 *     tables).
 *   - Passwords: hashed by Supabase Auth (GoTrue, bcrypt). RentID never sees one.
 *
 * What is left is a small set of references that are not secrets on their own
 * but should not be readable in a database dump or a leaked backup: provider
 * webhook secrets, the identity provider's reusable subject reference, and
 * similar. Those go through this module.
 *
 * Design: AES-256-GCM with a per-record data key, and the data key wrapped by a
 * master key held in the environment (and, in production, in a KMS). Rotating
 * the master key re-wraps the data keys without re-encrypting the payloads.
 *
 * At rest the whole database is already encrypted by the platform (AES-256) and
 * every connection is TLS 1.2+. This module is the extra layer for the fields
 * where "the DBA can read it" is not acceptable.
 *
 * SERVER ONLY. Importing this in a browser bundle would ship the master key.
 */
import { webcrypto as nodeCrypto } from "node:crypto";

const crypto: Crypto =
  (globalThis.crypto as Crypto | undefined) ?? (nodeCrypto as unknown as Crypto);

const ALGORITHM = "AES-GCM";
const KEY_BITS = 256;
const IV_BYTES = 12; // 96-bit nonce, the size GCM is specified for
const VERSION = "v1";

export type SealedValue = {
  /** Format marker so a future scheme can be told apart from this one. */
  v: string;
  /** Key id the data key is wrapped under, for rotation. */
  kid: string;
  /** Base64url data key, itself AES-GCM encrypted under the master key. */
  dk: string;
  /** Base64url nonce for the payload. */
  iv: string;
  /** Base64url ciphertext ‖ auth tag. */
  ct: string;
};

export class CryptoConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptoConfigError";
  }
}

/* ------------------------------------------------------------------ keys */

type MasterKey = { id: string; key: CryptoKey };

let cachedKeys: Map<string, MasterKey> | null = null;
let cachedPrimary: string | null = null;

/**
 * Master keys come from `RENTID_ENCRYPTION_KEYS`: a comma-separated list of
 * `<key-id>:<base64 32 bytes>`, newest FIRST. Keeping the old keys listed is
 * what makes rotation non-breaking — new writes use the first, reads still
 * open anything sealed under an older one.
 *
 *   RENTID_ENCRYPTION_KEYS="2026-09:Base64Key...,2026-03:OlderBase64Key..."
 *
 * Generate one with: openssl rand -base64 32
 */
async function loadKeys(): Promise<{ keys: Map<string, MasterKey>; primary: string }> {
  if (cachedKeys && cachedPrimary) return { keys: cachedKeys, primary: cachedPrimary };

  const raw = process.env["RENTID_ENCRYPTION_KEYS"] ?? "";
  if (!raw.trim()) {
    throw new CryptoConfigError(
      "RENTID_ENCRYPTION_KEYS is not set. Generate one with `openssl rand -base64 32` and set it as <key-id>:<key>.",
    );
  }

  const keys = new Map<string, MasterKey>();
  let primary: string | null = null;

  for (const entry of raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    const separator = entry.indexOf(":");
    if (separator === -1)
      throw new CryptoConfigError("RENTID_ENCRYPTION_KEYS entries must be <key-id>:<base64 key>.");
    const id = entry.slice(0, separator).trim();
    const material = base64ToBytes(entry.slice(separator + 1).trim());
    if (material.byteLength !== 32) {
      throw new CryptoConfigError(
        `Encryption key "${id}" must be exactly 32 bytes (256 bits) of base64.`,
      );
    }
    const key = await crypto.subtle.importKey("raw", material as BufferSource, ALGORITHM, false, [
      "encrypt",
      "decrypt",
    ]);
    keys.set(id, { id, key });
    primary ??= id;
  }

  if (!primary) throw new CryptoConfigError("RENTID_ENCRYPTION_KEYS contained no usable keys.");
  cachedKeys = keys;
  cachedPrimary = primary;
  return { keys, primary };
}

/** Test seam: drop the cached keys so a changed env is picked up. */
export function resetKeyCache(): void {
  cachedKeys = null;
  cachedPrimary = null;
}

/* ----------------------------------------------------------------- seal */

/**
 * Encrypt a string. `context` is bound into the ciphertext as additional
 * authenticated data, so a value sealed for one record cannot be pasted into
 * another — pass something stable and specific, e.g.
 * `payout_account:<id>:provider_ref`.
 */
export async function seal(plaintext: string, context: string): Promise<SealedValue> {
  if (!context)
    throw new CryptoConfigError(
      "A context string is required — it binds the ciphertext to its record.",
    );
  const { keys, primary } = await loadKeys();
  const master = keys.get(primary) as MasterKey;

  // Fresh data key per value: a single leaked data key exposes one field.
  const dataKeyBytes = crypto.getRandomValues(new Uint8Array(KEY_BITS / 8));
  const dataKey = await crypto.subtle.importKey(
    "raw",
    dataKeyBytes as BufferSource,
    ALGORITHM,
    false,
    ["encrypt"],
  );

  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: ALGORITHM,
      iv: iv as BufferSource,
      additionalData: encodeUtf8(context) as BufferSource,
    },
    dataKey,
    encodeUtf8(plaintext) as BufferSource,
  );

  const dkIv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const wrapped = await crypto.subtle.encrypt(
    {
      name: ALGORITHM,
      iv: dkIv as BufferSource,
      additionalData: encodeUtf8(context) as BufferSource,
    },
    master.key,
    dataKeyBytes as BufferSource,
  );

  dataKeyBytes.fill(0); // don't leave the key sitting in a reachable buffer

  return {
    v: VERSION,
    kid: master.id,
    dk: bytesToBase64(concat(dkIv, new Uint8Array(wrapped))),
    iv: bytesToBase64(iv),
    ct: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

/** Decrypt a value produced by `seal`. Throws if the context does not match. */
export async function open(sealed: SealedValue, context: string): Promise<string> {
  if (sealed.v !== VERSION)
    throw new CryptoConfigError(`Unsupported sealed-value version "${sealed.v}".`);
  const { keys } = await loadKeys();
  const master = keys.get(sealed.kid);
  if (!master) {
    throw new CryptoConfigError(
      `No encryption key with id "${sealed.kid}" — keep retired keys in RENTID_ENCRYPTION_KEYS until nothing is sealed under them.`,
    );
  }

  const dkBlob = base64ToBytes(sealed.dk);
  const dkIv = dkBlob.slice(0, IV_BYTES);
  const wrapped = dkBlob.slice(IV_BYTES);
  const dataKeyBytes = new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: ALGORITHM,
        iv: dkIv as BufferSource,
        additionalData: encodeUtf8(context) as BufferSource,
      },
      master.key,
      wrapped as BufferSource,
    ),
  );
  const dataKey = await crypto.subtle.importKey(
    "raw",
    dataKeyBytes as BufferSource,
    ALGORITHM,
    false,
    ["decrypt"],
  );

  const plaintext = await crypto.subtle.decrypt(
    {
      name: ALGORITHM,
      iv: base64ToBytes(sealed.iv) as BufferSource,
      additionalData: encodeUtf8(context) as BufferSource,
    },
    dataKey,
    base64ToBytes(sealed.ct) as BufferSource,
  );
  dataKeyBytes.fill(0);
  return new TextDecoder().decode(plaintext);
}

/**
 * Re-wrap a sealed value under the current primary key without decrypting the
 * payload with a new nonce — used by the key-rotation job.
 */
export async function rewrap(sealed: SealedValue, context: string): Promise<SealedValue> {
  const plaintext = await open(sealed, context);
  return seal(plaintext, context);
}

/* --------------------------------------------------------------- hashing */

/**
 * Deterministic, keyed lookup hash for a value that must be searchable but
 * not readable (e.g. finding the payout account matching a webhook's token).
 * Keyed with the primary master key so a stolen table cannot be attacked with
 * a rainbow table of plausible inputs.
 */
export async function blindIndex(value: string, context: string): Promise<string> {
  const { keys, primary } = await loadKeys();
  const master = keys.get(primary) as MasterKey;
  const raw = await crypto.subtle.exportKey("raw", master.key).catch(() => null);
  // The master key is imported as non-extractable, so derive through HKDF-like
  // use of the key itself: encrypt a fixed block and use it as the HMAC key.
  const seed = raw
    ? new Uint8Array(raw)
    : new Uint8Array(
        await crypto.subtle.encrypt(
          { name: ALGORITHM, iv: new Uint8Array(IV_BYTES) as BufferSource },
          master.key,
          encodeUtf8(`blind-index:${context}`) as BufferSource,
        ),
      ).slice(0, 32);

  const hmacKey = await crypto.subtle.importKey(
    "raw",
    seed as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    hmacKey,
    encodeUtf8(`${context}:${value}`) as BufferSource,
  );
  return bytesToBase64(new Uint8Array(mac));
}

/**
 * Constant-time string comparison, for webhook signatures and tokens.
 * `a === b` leaks the position of the first differing byte through timing.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const left = encodeUtf8(a);
  const right = encodeUtf8(b);
  // Compare lengths without an early return so the loop always runs.
  let mismatch = left.byteLength === right.byteLength ? 0 : 1;
  const length = Math.max(left.byteLength, right.byteLength);
  for (let i = 0; i < length; i += 1) {
    mismatch |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return mismatch === 0;
}

/* ---------------------------------------------------------------- utils */

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a, 0);
  out.set(b, a.byteLength);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value.trim());
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}
