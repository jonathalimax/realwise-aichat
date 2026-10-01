import { readFile } from "fs/promises";

export async function extractTextFromDocument(localPath: string, mimeType: string): Promise<{ markdown: string; ocrUsed: boolean }> {
  if (mimeType === "text/plain" || mimeType === "text/markdown") {
    const content = await readFile(localPath, "utf-8");
    return { markdown: content, ocrUsed: false };
  }

  // PDF/DOCX/image extraction and OCR are not wired yet — see ai/evals and rag-implementation skill
  // for the intended pipeline (pdf-parse / mammoth / Tesseract). Plain text works end-to-end today.
  throw new Error(`Extraction for mimeType "${mimeType}" is not implemented yet`);
}
