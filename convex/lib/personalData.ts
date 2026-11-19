import type { Doc } from "../_generated/dataModel";
import { blindIndex, decryptField, encryptField } from "./fieldEncryption";

// Email addresses are stored only encrypted (see fieldEncryption.ts). This module
// is the one place that turns them into ciphertext and back.

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// The ciphertext is bound to the user it belongs to.
const emailContext = (tokenIdentifier: string) => `users.email:${tokenIdentifier}`;

export async function emailLookupHash(email: string): Promise<string> {
  return await blindIndex(`email:${normalizeEmail(email)}`);
}

export async function sealEmail(tokenIdentifier: string, email: string) {
  const normalized = normalizeEmail(email);
  return {
    emailCiphertext: await encryptField(normalized, emailContext(tokenIdentifier)),
    emailHash: await emailLookupHash(normalized),
  };
}

/** The user's email, or undefined if there is none or it can't be decrypted (logged, never the value). */
export async function openEmail(user: Pick<Doc<"users">, "_id" | "tokenIdentifier" | "emailCiphertext">) {
  if (!user.emailCiphertext) return undefined;
  try {
    return await decryptField(user.emailCiphertext, emailContext(user.tokenIdentifier));
  } catch (error) {
    console.error(`Could not decrypt the email of user ${user._id}: ${error instanceof Error ? error.message : error}`);
    return undefined;
  }
}
