import { en, type Words } from "./en.js";
import { fr } from "./fr.js";

export type { Words } from "./en.js";

// The languages the tool speaks; any other is spoken to in English, its
// own default.
const catalogues: Record<string, Words> = { en, fr };

// words is the catalogue of a member's language ("fr", "fr-CA" → French).
export function words(language: string): Words {
  return catalogues[language.toLowerCase().split("-")[0] ?? ""] ?? en;
}

// languageOf is the language a catalogue speaks, for <html lang>.
export function languageOf(language: string): string {
  const primary = language.toLowerCase().split("-")[0] ?? "";
  return primary in catalogues ? primary : "en";
}
