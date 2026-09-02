/**
 * The identifier population a dictated sentence is matched against: what the buffer spells
 * that a mouth could say. Two or more spoken words (`ShardMemCache`, `enroll_tile`,
 * `HTTPServer`); single-word names are refused by the matcher inside a sentence anyway, and
 * harvesting them would only make the population large. A type starts upper-case and carries
 * a lower-case letter; `MAX_RETRIES` is a constant and is never a root.
 *
 * Core-side so the measurement rig and the extension harvest the same names.
 */
import type { NamedSymbol } from "./dictation";

export function harvestSpokenNames(text: string): NamedSymbol[] {
  if (typeof text !== "string" || text === "") {
    return [];
  }
  const seen = new Set<string>();
  const re = /[A-Za-z_][A-Za-z0-9_]{2,}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const name = m[0];
    if (seen.has(name)) {
      continue;
    }
    if (/[a-z][A-Z]/.test(name) || /[A-Z]{2,}[a-z]/.test(name) || /[A-Za-z0-9]_[A-Za-z0-9]/.test(name)) {
      seen.add(name);
    }
  }
  return [...seen].map((name) => ({ name, kind: /^[A-Z]/.test(name) && /[a-z]/.test(name) ? "type" : "other" }));
}
