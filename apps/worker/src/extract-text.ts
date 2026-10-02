import { readFile } from "fs/promises";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import { createWorker } from "tesseract.js";

const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);
const LOW_CONFIDENCE_THRESHOLD = 40;
const UNREADABLE_NOTE = "[Não foi possível ler o texto desta imagem com confiança. Envie uma foto mais nítida ou um PDF/texto do conteúdo.]";

async function extractTextFromImage(localPath: string): Promise<{ markdown: string; ocrUsed: boolean }> {
  const worker = await createWorker("por");
  try {
    const { data } = await worker.recognize(localPath);
    const text = data.text.trim();
    if (!text || data.confidence < LOW_CONFIDENCE_THRESHOLD) {
      return { markdown: UNREADABLE_NOTE, ocrUsed: true };
    }
    return { markdown: text, ocrUsed: true };
  } finally {
    await worker.terminate();
  }
}

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

  if (IMAGE_MIME_TYPES.has(mimeType)) {
    return extractTextFromImage(localPath);
  }

  throw new Error(`Extraction for mimeType "${mimeType}" is not implemented yet`);
}
