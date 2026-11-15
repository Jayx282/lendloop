import { fail } from "./auth";

// Normalizes user-entered text: strips control characters, collapses
// whitespace and enforces length limits server-side (the UI limits are only hints).
export function cleanText(value: string, field: string, { min = 0, max }: { min?: number; max: number }): string {
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < min) {
    fail(min <= 1 ? `${field} is required.` : `${field} needs at least ${min} characters.`);
  }
  if (cleaned.length > max) fail(`${field} can be at most ${max} characters.`);
  return cleaned;
}

export function truncate(value: string, max = 500): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
