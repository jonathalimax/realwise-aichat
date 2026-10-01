import { readFile } from "fs/promises";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";

export async function extractTextFromDocument(localPath: string, mimeType: string): Promise<{ markdown: string; ocrUsed: boolean }> {
  if (mimeType === "text/plain" || mimeType === "text/markdown") {
    const content = await readFile(localPath, "utf-8");
    return { markdown: content, ocrUsed: false };
  }

  if (mimeType === "application/pdf") {
    const buffer = await readFile(localPath);
    const result = await pdfParse(buffer);
    return { markdown: result.text, ocrUsed: false };
  }

  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/msword"
  ) {
    const buffer = await readFile(localPath);
    const result = await mammoth.extractRawText({ buffer });
    return { markdown: result.value, ocrUsed: false };
  }

  // Image OCR (menus/price boards photographed on a phone) is not wired yet — would need
  // Tesseract or a vision-model call here. Everything else works end-to-end today.
  throw new Error(`Extraction for mimeType "${mimeType}" is not implemented yet`);
}
