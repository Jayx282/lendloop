import { fromBase64, fromUtf8, toBase64Url, utf8 } from "./encoding";

// Application-level encryption for personal data (today: email addresses).
//
// The database, its backups and exports, and anyone browsing the Convex
// dashboard see only ciphertext. Plaintext exists only inside the functions that
// need it: sending a notification, or showing a contact to the other party of an
// approved loan.
//
//   - One 256-bit master key, LENDLOOP_DATA_KEY (base64), lives in the Convex
//     environment. HKDF-SHA256 derives two single-purpose keys from it:
//       * AES-256-GCM to encrypt (a fresh random 96-bit IV for every value);
//       * HMAC-SHA256 for a "blind index", so an exact-match lookup (find the
//         user with this email) works without decrypting anything.
//   - Each ciphertext is bound to its row with additional authenticated data
//     (AAD), so a value copied into another row fails to decrypt.
//   - Each value records which key encrypted it. To rotate, move the old key to
//     LENDLOOP_DATA_KEY_PREVIOUS, set a new LENDLOOP_DATA_KEY, then run
//     `npx convex run security:reencryptEmails` until it reports nothing left.
//
// Stored format: "v1.<keyId>.<iv>.<ciphertext+tag>", with base64url parts.

const FORMAT = "v1";
const HKDF_SALT = utf8.encode("lendloop/data-key/v1");

type DataKey = { id: string; encryption: CryptoKey; index: CryptoKey };

const derived = new Map<string, Promise<DataKey>>();

function deriveDataKey(base64Key: string): Promise<DataKey> {
  let key = derived.get(base64Key);
  if (!key) {
    key = (async () => {
      const raw = fromBase64(base64Key);
      if (raw.length !== 32) throw new Error("data keys must be 32 bytes, base64-encoded");
      const master = await crypto.subtle.importKey("raw", raw, "HKDF", false, ["deriveKey"]);
      const derive = (info: string, algorithm: AesKeyGenParams | HmacKeyGenParams, usages: KeyUsage[]) =>
        crypto.subtle.deriveKey(
          { name: "HKDF", hash: "SHA-256", salt: HKDF_SALT, info: utf8.encode(info) },
          master,
          algorithm,
          false,
          usages,
        );
      const [encryption, index, fingerprint] = await Promise.all([
        derive("encrypt", { name: "AES-GCM", length: 256 }, ["encrypt", "decrypt"]),
        derive("blind-index", { name: "HMAC", hash: "SHA-256", length: 256 }, ["sign"]),
        crypto.subtle.digest("SHA-256", raw),
      ]);
      // A short, non-secret fingerprint of the key, stored with each value.
      return { id: toBase64Url(fingerprint).slice(0, 8), encryption, index };
    })();
    derived.set(base64Key, key);
  }
  return key;
}

async function keyring(): Promise<{ current: DataKey; previous?: DataKey }> {
  const current = process.env.LENDLOOP_DATA_KEY;
  // Fail closed: never fall back to storing plaintext.
  if (!current) throw new Error("LENDLOOP_DATA_KEY is not set");
  const previous = process.env.LENDLOOP_DATA_KEY_PREVIOUS;
  return {
    current: await deriveDataKey(current),
    previous: previous ? await deriveDataKey(previous) : undefined,
  };
}

export async function currentKeyId(): Promise<string> {
  return (await keyring()).current.id;
}

export async function previousKeyId(): Promise<string | null> {
  return (await keyring()).previous?.id ?? null;
}

/** The id of the key a stored value was encrypted with, read without decrypting. */
export function keyIdOf(value: string): string | null {
  const [format, keyId] = value.split(".");
  return format === FORMAT && keyId ? keyId : null;
}

export async function encryptField(plaintext: string, context: string): Promise<string> {
  const { current } = await keyring();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: utf8.encode(context) },
    current.encryption,
    utf8.encode(plaintext),
  );
  return [FORMAT, current.id, toBase64Url(iv), toBase64Url(ciphertext)].join(".");
}

/** Throws if the value was tampered with, belongs to another row, or its key isn't configured. */
export async function decryptField(value: string, context: string): Promise<string> {
  const [format, keyId, iv, ciphertext, ...rest] = value.split(".");
  if (format !== FORMAT || !keyId || !iv || !ciphertext || rest.length > 0) {
    throw new Error("not an encrypted value");
  }
  const { current, previous } = await keyring();
  const key = [current, previous].find((k) => k?.id === keyId);
  if (!key) throw new Error(`no configured key matches key id ${keyId}`);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(iv), additionalData: utf8.encode(context) },
    key.encryption,
    fromBase64(ciphertext),
  );
  return fromUtf8.decode(plaintext);
}

/** Deterministic keyed hash for equality lookups. Reveals nothing without the key. */
export async function blindIndex(value: string): Promise<string> {
  const { current } = await keyring();
  return toBase64Url(await crypto.subtle.sign("HMAC", current.index, utf8.encode(value)));
}
