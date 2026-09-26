// Upload a resume file (PDF, DOCX, TXT, MD) and get its text back. Nothing is stored.
import { extractResumeText, MAX_RESUME_BYTES, ResumeFileError } from "@/lib/extract";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "No file received." }, { status: 400 });
  if (file.size > MAX_RESUME_BYTES) return Response.json({ error: "That file is over 5 MB." }, { status: 413 });

  try {
    const text = await extractResumeText(file.name, new Uint8Array(await file.arrayBuffer()));
    if (text.trim().length < 80) {
      return Response.json({ error: "Couldn't find text in that file. If it's a scanned image, export a text-based PDF or DOCX." }, { status: 422 });
    }
    return Response.json({ name: file.name, text });
  } catch (err) {
    const message = err instanceof ResumeFileError ? err.message : "Couldn't read that file.";
    return Response.json({ error: message }, { status: 422 });
  }
}
