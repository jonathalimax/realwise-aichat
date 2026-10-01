export interface Chunk {
  content: string;
  ordinal: number;
  tokenCount: number;
}

export function chunkMarkdown(markdown: string, targetChars = 1800, overlapChars = 250): Chunk[] {
  const paragraphs = markdown.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const chunks: Chunk[] = [];
  let buffer = "";
  let ordinal = 0;

  for (const paragraph of paragraphs) {
    if (buffer.length + paragraph.length > targetChars && buffer.length > 0) {
      chunks.push({ content: buffer.trim(), ordinal: ordinal++, tokenCount: Math.ceil(buffer.length / 4) });
      buffer = buffer.slice(-overlapChars);
    }
    buffer += (buffer ? "\n\n" : "") + paragraph;
  }
  if (buffer.trim()) {
    chunks.push({ content: buffer.trim(), ordinal: ordinal++, tokenCount: Math.ceil(buffer.length / 4) });
  }
  return chunks;
}
