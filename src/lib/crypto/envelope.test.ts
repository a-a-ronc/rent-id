import { beforeEach, describe, expect, it } from "vitest";

import {
  blindIndex,
  CryptoConfigError,
  open,
  resetKeyCache,
  rewrap,
  seal,
  timingSafeEqual,
} from "./envelope";

const KEY_A = Buffer.from(new Uint8Array(32).fill(7)).toString("base64");
const KEY_B = Buffer.from(new Uint8Array(32).fill(11)).toString("base64");
const CONTEXT = "payout_account:11111111-1111-4111-8111-111111111111:provider_ref";

function setKeys(value: string) {
  process.env["RENTID_ENCRYPTION_KEYS"] = value;
  resetKeyCache();
}

describe("envelope encryption", () => {
  beforeEach(() => setKeys(`2026-09:${KEY_A}`));

  it("round-trips a value", async () => {
    const sealed = await seal("acct_tok_live_abc123", CONTEXT);
    await expect(open(sealed, CONTEXT)).resolves.toBe("acct_tok_live_abc123");
  });

  it("never stores the plaintext in the envelope", async () => {
    const sealed = await seal("acct_tok_live_abc123", CONTEXT);
    const serialized = JSON.stringify(sealed);
    expect(serialized).not.toContain("acct_tok_live_abc123");
    expect(serialized).not.toContain("abc123");
  });

  it("uses a fresh nonce and data key for every value", async () => {
    const a = await seal("same plaintext", CONTEXT);
    const b = await seal("same plaintext", CONTEXT);
    // Identical input must not produce identical ciphertext, or a database dump
    // reveals which rows share a value.
    expect(a.ct).not.toBe(b.ct);
    expect(a.iv).not.toBe(b.iv);
    expect(a.dk).not.toBe(b.dk);
  });

  it("refuses to open a value under a different context", async () => {
    const sealed = await seal("acct_tok_live_abc123", CONTEXT);
    // Moving a ciphertext from one record to another must fail, not silently
    // decrypt — that is what the AAD binding is for.
    await expect(
      open(sealed, "payout_account:22222222-2222-4222-8222-222222222222:provider_ref"),
    ).rejects.toThrow();
  });

  it("detects tampering with the ciphertext", async () => {
    const sealed = await seal("acct_tok_live_abc123", CONTEXT);
    const flipped = { ...sealed, ct: flipLastByte(sealed.ct) };
    await expect(open(flipped, CONTEXT)).rejects.toThrow();
  });

  it("detects tampering with the wrapped data key", async () => {
    const sealed = await seal("acct_tok_live_abc123", CONTEXT);
    const flipped = { ...sealed, dk: flipLastByte(sealed.dk) };
    await expect(open(flipped, CONTEXT)).rejects.toThrow();
  });

  it("requires a context", async () => {
    await expect(seal("x", "")).rejects.toBeInstanceOf(CryptoConfigError);
  });

  it("round-trips unicode and empty strings", async () => {
    for (const value of ["", "🔐 clé", "a".repeat(5000)]) {
      const sealed = await seal(value, CONTEXT);
      await expect(open(sealed, CONTEXT)).resolves.toBe(value);
    }
  });

  describe("key rotation", () => {
    it("reads a value sealed under a retired key while writing under the new one", async () => {
      setKeys(`2026-03:${KEY_B}`);
      const old = await seal("acct_tok_live_abc123", CONTEXT);
      expect(old.kid).toBe("2026-03");

      // Rotate: new key first, old key kept so existing rows still open.
      setKeys(`2026-09:${KEY_A},2026-03:${KEY_B}`);
      await expect(open(old, CONTEXT)).resolves.toBe("acct_tok_live_abc123");

      const fresh = await seal("acct_tok_live_abc123", CONTEXT);
      expect(fresh.kid).toBe("2026-09");
    });

    it("rewraps an old value under the current primary key", async () => {
      setKeys(`2026-03:${KEY_B}`);
      const old = await seal("acct_tok_live_abc123", CONTEXT);
      setKeys(`2026-09:${KEY_A},2026-03:${KEY_B}`);

      const rotated = await rewrap(old, CONTEXT);
      expect(rotated.kid).toBe("2026-09");
      await expect(open(rotated, CONTEXT)).resolves.toBe("acct_tok_live_abc123");
    });

    it("explains itself when the sealing key has been dropped from the env", async () => {
      setKeys(`2026-03:${KEY_B}`);
      const old = await seal("acct_tok_live_abc123", CONTEXT);
      setKeys(`2026-09:${KEY_A}`);
      await expect(open(old, CONTEXT)).rejects.toThrow(/2026-03/);
    });
  });

  describe("configuration errors", () => {
    it("fails loudly when no key is configured", async () => {
      setKeys("");
      await expect(seal("x", CONTEXT)).rejects.toBeInstanceOf(CryptoConfigError);
    });

    it("rejects a key that is not 32 bytes", async () => {
      setKeys(`short:${Buffer.from("too short").toString("base64")}`);
      await expect(seal("x", CONTEXT)).rejects.toThrow(/32 bytes/);
    });

    it("rejects a malformed entry", async () => {
      setKeys("no-colon-here");
      await expect(seal("x", CONTEXT)).rejects.toThrow(/<key-id>:<base64 key>/);
    });
  });

  describe("blindIndex", () => {
    it("is deterministic for the same value and context", async () => {
      const a = await blindIndex("acct_tok_live_abc123", "payout_ref");
      const b = await blindIndex("acct_tok_live_abc123", "payout_ref");
      expect(a).toBe(b);
    });

    it("separates contexts, so one index cannot be used to probe another", async () => {
      const a = await blindIndex("acct_tok_live_abc123", "payout_ref");
      const b = await blindIndex("acct_tok_live_abc123", "identity_ref");
      expect(a).not.toBe(b);
    });

    it("does not leak the input", async () => {
      const hash = await blindIndex("acct_tok_live_abc123", "payout_ref");
      expect(hash).not.toContain("abc123");
    });
  });

  describe("timingSafeEqual", () => {
    it.each([
      ["identical", "abc", "abc", true],
      ["last byte differs", "abc", "abd", false],
      ["first byte differs", "abc", "zbc", false],
      ["prefix", "abc", "abcd", false],
      ["suffix", "abcd", "abc", false],
      ["both empty", "", "", true],
      ["one empty", "", "a", false],
      ["unicode equal", "clé🔐", "clé🔐", true],
      ["unicode differing", "clé🔐", "cle🔐", false],
    ])("%s", (_label, a, b, expected) => {
      expect(timingSafeEqual(a, b)).toBe(expected);
    });
  });
});

function flipLastByte(base64: string): string {
  const bytes = Buffer.from(base64, "base64");
  const last = bytes.length - 1;
  bytes[last] = (bytes[last] ?? 0) ^ 0xff;
  return bytes.toString("base64");
}
