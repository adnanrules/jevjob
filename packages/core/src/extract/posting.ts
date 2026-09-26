// Posting normalizer: loose plain-text postings (Indeed details, copied pages) → header + bullet structure.
// Job boards often strip list markup, leaving every item as its own paragraph. Both the rules and Jev read
// requirements much better when "What You Will Have" is a header with bullets under it.

const BULLET = /^(?:[-*–]\s+|[•●▪◦‣]\s*)/;
const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "with", "you", "your", "&", "-", "–"]);
const MAX_HEADER = 80;
const MAX_ITEM = 400;

/** One-word lines are headers only when they're words postings use as headers ("Python" alone is a list item). */
const ONE_WORD_HEADERS = /^(qualifications|requirements|responsibilities|duties|benefits|perks|skills|education|experience|overview|summary|about|compensation|description|preferred|bonus)$/i;

/** "What You Will Do", "Top Candidates May Have:", "Benefits:" are headers; "Mobile and web development" is not. */
export function isHeaderLine(line: string): boolean {
  if (!line || line.length > MAX_HEADER || BULLET.test(line) || /[.!?]["')]?$/.test(line)) return false;
  if (/:$/.test(line)) return true;
  const words = line.replace(/[()]/g, "").split(/\s+/).filter(Boolean);
  if (words.length > 10) return false;
  if (words.length === 1) return ONE_WORD_HEADERS.test(words[0]!);
  const content = words.filter((w) => !SMALL_WORDS.has(w.toLowerCase()));
  if (!content.length) return false;
  const capitalized = content.filter((w) => /^[A-Z0-9]/.test(w)).length;
  return capitalized / content.length >= 0.75;
}

/**
 * Rebuilds structure: headers stay on their own line; short paragraphs under a header become "- " bullets.
 * Idempotent: already-structured markdown comes back unchanged apart from bullet style.
 */
export function normalizePosting(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim());
  const out: string[] = [];
  let underHeader = false;
  let justHeaded = false; // the first line under a header is its first item, even if it looks like a title
  for (const line of lines) {
    if (!line) {
      if (out.at(-1) !== "") out.push("");
      continue;
    }
    if (BULLET.test(line)) {
      out.push(`- ${line.replace(BULLET, "")}`);
      justHeaded = false;
      continue;
    }
    if (isHeaderLine(line) && (!justHeaded || /:$/.test(line))) {
      justHeaded = true;
      if (out.length && out.at(-1) !== "") out.push("");
      out.push(line.replace(/:$/, ""));
      underHeader = true;
      continue;
    }
    justHeaded = false;
    out.push(underHeader && line.length <= MAX_ITEM ? `- ${line}` : line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
