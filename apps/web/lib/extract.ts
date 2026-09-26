// Resume file → plain text the parser understands. Server-only.
import mammoth from "mammoth";
import { extractText } from "unpdf";

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;

export class ResumeFileError extends Error {}

export async function extractResumeText(name: string, bytes: Uint8Array): Promise<string> {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const magic = new TextDecoder().decode(bytes.slice(0, 4));

  if (ext === "pdf" || magic === "%PDF") {
    const { text } = await extractText(bytes, { mergePages: true });
    return text;
  }
  if (ext === "docx" || magic.startsWith("PK")) {
    // Via HTML rather than raw text: raw text drops list bullets, and bullets are how the parser
    // tells a role's duties apart from the next role.
    const { value } = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
    return htmlToText(value);
  }
  if (ext === "doc") throw new ResumeFileError("Old .doc files aren't supported. Save it as .docx or PDF.");
  if (["txt", "md", "markdown", "text"].includes(ext)) return new TextDecoder().decode(bytes);
  throw new ResumeFileError("Use a PDF, DOCX, TXT or Markdown file.");
}

function htmlToText(html: string): string {
  return html
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|h[1-6]|li|tr|table)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
