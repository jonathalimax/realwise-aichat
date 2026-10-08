// One-off seeding script: reads curated markdown from ai/shared-knowledge/<niche>/*.md and
// ingests it directly into SharedKnowledgeDocument/SharedKnowledgeChunk, mirroring
// registerTextDocument + processSharedKnowledgeIngestion without needing BullMQ/HTTP admin auth.
// Run with DATABASE_URL and OLLAMA_URL pointed at the target environment.
import { readdirSync, readFileSync } from "fs";
import { join, basename } from "path";
import { PrismaClient } from "@realwise/db";
import { chunkMarkdown } from "../src/chunking";
import { embedText } from "../src/embeddings";

const prisma = new PrismaClient();
const ROOT = process.env.SHARED_KNOWLEDGE_ROOT ?? join(__dirname, "..", "ai", "shared-knowledge");
const NICHES = ["imobiliaria", "concessionaria"];

function stripNulls(text: string): string {
  return text.replace(new RegExp(String.fromCharCode(0), "g"), "");
}

function parseFile(raw: string): { title: string; version?: string; sourceCitation?: string; body: string } {
  const lines = stripNulls(raw).split("\n");
  let title = "";
  let version: string | undefined;
  let sourceCitation: string | undefined;
  let bodyStart = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^title:\s*/i.test(line)) title = line.replace(/^title:\s*/i, "").trim();
    else if (/^version:\s*/i.test(line)) version = line.replace(/^version:\s*/i, "").trim();
    else if (/^sourceCitation:\s*/i.test(line)) sourceCitation = line.replace(/^sourceCitation:\s*/i, "").trim();
    else if (line.trim() === "" && title) {
      bodyStart = i + 1;
      break;
    }
  }
  const body = lines.slice(bodyStart).join("\n").trim();
  return { title: title || "Untitled", version, sourceCitation, body };
}

async function ingestFile(niche: string, filePath: string) {
  const raw = readFileSync(filePath, "utf-8");
  const { title, version, sourceCitation, body } = parseFile(raw);
  const filename = basename(filePath);

  const document = await prisma.sharedKnowledgeDocument.create({
    data: {
      niche,
      title,
      filename,
      mimeType: "text/markdown",
      sizeBytes: Buffer.byteLength(body, "utf-8"),
      storageKey: `seed/${niche}/${filename}`,
      source: "seed-script",
      status: "processing",
      sourceCitation,
      version,
    },
  });

  const chunks = chunkMarkdown(body);
  let ok = 0;
  for (const chunk of chunks) {
    const embedding = await embedText(chunk.content);
    const created = await prisma.sharedKnowledgeChunk.create({
      data: {
        documentId: document.id,
        niche,
        ordinal: chunk.ordinal,
        content: chunk.content,
        tokenCount: chunk.tokenCount,
      },
    });
    await prisma.$executeRawUnsafe(
      `UPDATE "SharedKnowledgeChunk" SET embedding = $1::vector WHERE id = $2`,
      `[${embedding.join(",")}]`,
      created.id,
    );
    ok++;
  }

  await prisma.sharedKnowledgeDocument.update({
    where: { id: document.id },
    data: { status: "processed", extractedMarkdown: body, isActive: true, reviewedAt: new Date() },
  });

  console.log(`[ok] ${niche}/${filename} -> ${ok} chunks`);
}

async function main() {
  for (const niche of NICHES) {
    const dir = join(ROOT, niche);
    const files = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md" && !f.startsWith("."));
    console.log(`=== ${niche}: ${files.length} files ===`);
    for (const f of files) {
      await ingestFile(niche, join(dir, f));
    }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect().finally(() => process.exit(1));
  });
