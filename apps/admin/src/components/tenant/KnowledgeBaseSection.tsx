"use client";

import { Fragment, useState } from "react";
import { getTenantDocumentMarkdown } from "../../lib/api";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../ui/table";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusVariant(status: string) {
  if (status === "processed" || status === "ready") return "positive";
  if (status === "error" || status === "failed") return "negative";
  return "warning";
}

export function KnowledgeBaseSection({
  tenantId,
  documents,
  chunkTotal,
  chunkSample,
}: {
  tenantId: string;
  documents: any[];
  chunkTotal: number;
  chunkSample: any[];
}) {
  const [markdownByDocId, setMarkdownByDocId] = useState<Record<string, string>>({});
  const [openDocId, setOpenDocId] = useState<string | null>(null);
  const [loadingDocId, setLoadingDocId] = useState<string | null>(null);

  const filenameById = new Map(documents.map((d) => [d.id, d.filename]));

  async function toggleMarkdown(docId: string) {
    if (openDocId === docId) {
      setOpenDocId(null);
      return;
    }
    if (!markdownByDocId[docId]) {
      setLoadingDocId(docId);
      try {
        const result = await getTenantDocumentMarkdown(tenantId, docId);
        setMarkdownByDocId((prev) => ({ ...prev, [docId]: result.extractedMarkdown ?? "" }));
      } catch {
        setMarkdownByDocId((prev) => ({ ...prev, [docId]: "Falha ao carregar markdown." }));
      } finally {
        setLoadingDocId(null);
      }
    }
    setOpenDocId(docId);
  }

  function renderMarkdownPreview(docId: string) {
    if (openDocId !== docId) return null;
    return (
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-bg-2 p-3 text-xs text-ink">
        {loadingDocId === docId ? "Carregando…" : markdownByDocId[docId] || "Sem conteúdo extraído."}
      </pre>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {documents.length === 0 ? (
        <p className="text-ink-soft">Nenhum documento enviado.</p>
      ) : (
        <>
          <div className="hidden lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Arquivo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Tamanho</TableHead>
                  <TableHead>Páginas</TableHead>
                  <TableHead>Chunks</TableHead>
                  <TableHead>Anúncios</TableHead>
                  <TableHead>Enviado</TableHead>
                  <TableHead>Markdown</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((doc) => (
                  <Fragment key={doc.id}>
                    <TableRow>
                      <TableCell className="break-words">{doc.filename}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(doc.status) as any}>{doc.status}</Badge>
                        {doc.processingError && (
                          <div className="mt-1">
                            <Badge variant="negative">erro</Badge>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="break-words">{doc.mimeType}</TableCell>
                      <TableCell>{formatBytes(doc.sizeBytes)}</TableCell>
                      <TableCell>{doc.pageCount ?? "—"}</TableCell>
                      <TableCell>{doc.chunkCount}</TableCell>
                      <TableCell>{doc.listingCount}</TableCell>
                      <TableCell className="break-words">{new Date(doc.createdAt).toLocaleString("pt-BR")}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={doc.markdownLength === 0}
                          onClick={() => toggleMarkdown(doc.id)}
                        >
                          {openDocId === doc.id ? "Ocultar" : "Ver markdown"}
                        </Button>
                      </TableCell>
                    </TableRow>
                    {doc.processingError && (
                      <TableRow>
                        <TableCell colSpan={9} className="whitespace-pre-wrap break-words text-xs text-negative">
                          {doc.processingError}
                        </TableCell>
                      </TableRow>
                    )}
                    {openDocId === doc.id && (
                      <TableRow>
                        <TableCell colSpan={9}>{renderMarkdownPreview(doc.id)}</TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-col gap-2 lg:hidden">
            {documents.map((doc) => (
              <div key={doc.id} className="rounded-lg border border-border bg-bg-2 p-3">
                <div className="break-words font-semibold text-ink">{doc.filename}</div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <div className="text-ink-soft">Status</div>
                    <div className="text-ink">
                      <Badge variant={statusVariant(doc.status) as any}>{doc.status}</Badge>
                    </div>
                  </div>
                  <div>
                    <div className="text-ink-soft">Tipo</div>
                    <div className="break-words text-ink">{doc.mimeType}</div>
                  </div>
                  <div>
                    <div className="text-ink-soft">Tamanho</div>
                    <div className="text-ink">{formatBytes(doc.sizeBytes)}</div>
                  </div>
                  <div>
                    <div className="text-ink-soft">Páginas</div>
                    <div className="text-ink">{doc.pageCount ?? "—"}</div>
                  </div>
                  <div>
                    <div className="text-ink-soft">Chunks</div>
                    <div className="text-ink">{doc.chunkCount}</div>
                  </div>
                  <div>
                    <div className="text-ink-soft">Anúncios</div>
                    <div className="text-ink">{doc.listingCount}</div>
                  </div>
                  <div className="col-span-2">
                    <div className="text-ink-soft">Enviado</div>
                    <div className="break-words text-ink">{new Date(doc.createdAt).toLocaleString("pt-BR")}</div>
                  </div>
                </div>
                {doc.processingError && (
                  <div className="mt-2 flex flex-col gap-1">
                    <Badge variant="negative">erro de processamento</Badge>
                    <p className="whitespace-pre-wrap break-words text-xs text-negative">{doc.processingError}</p>
                  </div>
                )}
                <div className="mt-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={doc.markdownLength === 0}
                    onClick={() => toggleMarkdown(doc.id)}
                  >
                    {openDocId === doc.id ? "Ocultar markdown" : "Ver markdown"}
                  </Button>
                </div>
                {renderMarkdownPreview(doc.id)}
              </div>
            ))}
          </div>
        </>
      )}

      <div className="flex flex-col gap-2">
        <div className="text-sm font-semibold text-ink">{chunkTotal} chunks no total</div>
        {chunkSample.length > 0 && (
          <div className="flex flex-col gap-2">
            {chunkSample.map((chunk: any) => (
              <pre
                key={chunk.id}
                className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-bg-2 p-3 text-xs text-ink"
              >
                {`doc ${filenameById.get(chunk.documentId) ?? chunk.documentId} · #${chunk.ordinal} · ${chunk.tokenCount} tokens · ${chunk.sectionPath ?? "—"}\n\n${chunk.content}`}
              </pre>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
