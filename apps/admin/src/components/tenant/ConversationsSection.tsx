"use client";

import { useEffect, useState } from "react";
import { getTenantConversations } from "../../lib/api";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../ui/table";
import { ConversationThreadViewer } from "./ConversationThreadViewer";

const PAGE_SIZE = 50;

const STATUS_VARIANT: Record<string, "neutral" | "positive" | "negative" | "warning"> = {
  active: "neutral",
  idle: "neutral",
  escalated: "warning",
  closed: "neutral",
};

// Table-with-click-to-preview pattern mirroring ListingsSection.tsx + ListingPreview.tsx: a row
// per conversation, clicking it opens the full "mirror" thread view (ConversationThreadViewer).
export function ConversationsSection({ tenantId }: { tenantId: string }) {
  const [conversations, setConversations] = useState<any[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  async function loadPage(nextOffset: number) {
    setLoading(true);
    try {
      const result = await getTenantConversations(tenantId, PAGE_SIZE, nextOffset);
      setConversations((prev) => (nextOffset === 0 ? result.conversations : [...prev, ...result.conversations]));
      setTotal(result.total);
      setOffset(nextOffset);
    } catch {
      // Tolerate failures — conversations panel should not blank the whole tenant page.
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  if (total === null) {
    return <p className="text-ink-soft">Carregando…</p>;
  }

  if (total === 0) {
    return <p className="text-ink-soft">Nenhuma conversa ainda.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="hidden lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ref</TableHead>
              <TableHead>Lead</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Mensagens</TableHead>
              <TableHead>Iniciada</TableHead>
              <TableHead>Última mensagem</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {conversations.map((c) => (
              <TableRow key={c.id} className="cursor-pointer hover:bg-surface" onClick={() => setActiveConversationId(c.id)}>
                <TableCell className="break-words">{c.referenceCode ?? "—"}</TableCell>
                <TableCell className="break-words">{c.lead?.name ?? c.lead?.phone ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[c.status] ?? "neutral"}>{c.status}</Badge>
                </TableCell>
                <TableCell>{c.messageCount}</TableCell>
                <TableCell className="break-words">{new Date(c.startedAt).toLocaleString("pt-BR")}</TableCell>
                <TableCell className="break-words">{new Date(c.lastMessageAt).toLocaleString("pt-BR")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-2 lg:hidden">
        {conversations.map((c) => (
          <div
            key={c.id}
            className="cursor-pointer rounded-lg border border-border bg-bg-2 p-3"
            onClick={() => setActiveConversationId(c.id)}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="break-words font-semibold text-ink">{c.lead?.name ?? c.lead?.phone ?? "Visitante"}</div>
              <Badge variant={STATUS_VARIANT[c.status] ?? "neutral"}>{c.status}</Badge>
            </div>
            <div className="text-xs text-ink-soft">{c.referenceCode ?? "—"}</div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-ink-soft">Mensagens</div>
                <div className="text-ink">{c.messageCount}</div>
              </div>
              <div>
                <div className="text-ink-soft">Última mensagem</div>
                <div className="break-words text-ink">{new Date(c.lastMessageAt).toLocaleString("pt-BR")}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {conversations.length < total && (
        <Button variant="outline" size="sm" disabled={loading} onClick={() => loadPage(offset + PAGE_SIZE)}>
          {loading ? "Carregando…" : "Carregar mais"}
        </Button>
      )}

      <ConversationThreadViewer
        tenantId={tenantId}
        conversationId={activeConversationId}
        open={activeConversationId !== null}
        onOpenChange={(open) => {
          if (!open) setActiveConversationId(null);
        }}
      />
    </div>
  );
}
