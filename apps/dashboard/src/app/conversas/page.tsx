"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getConversations, getConversationThread, type MirrorConversation, type MirrorMessage, type MirrorThread } from "../../lib/pharmacy-api";
import { useLoad } from "../../lib/use-load";
import { useSession } from "../../lib/session";
import { timeAgo } from "../../lib/format";
import { Badge } from "../../components/ui/badge";
import { Alert } from "../../components/ui/alert";
import { Card } from "../../components/ui/card";
import { Skeleton } from "../../components/ui/skeleton";
import { Tabs } from "../../components/ui/segmented";
import { EmptyState, ErrorState, LinkButton, LoadState, PageHeader, PageStack, TableSkeleton } from "../../components/page-kit";
import { cn } from "../../lib/utils";

export default function ConversasPage() {
  return (
    <Suspense fallback={null}>
      <Conversas />
    </Suspense>
  );
}

function who(c: Pick<MirrorConversation, "lead" | "referenceCode">): string {
  return c.lead?.name || c.lead?.phone || (c.referenceCode ? `Visitante ${c.referenceCode}` : "Visitante");
}

function Conversas() {
  const initial = useSearchParams().get("open");
  const [filter, setFilter] = useState<"all" | "escalated">("all");
  const [selected, setSelected] = useState<string | null>(initial);
  const state = useLoad(() => getConversations(filter), [filter]);
  const list = state.data ?? [];

  useEffect(() => {
    if (!state.data) return;
    if (selected && (list.some((c) => c.id === selected) || selected === initial)) return;
    setSelected(list[0]?.id ?? null);
  }, [state.data]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <PageStack>
      <PageHeader
        title="Conversas"
        subtitle="Somente leitura. Para responder, use Atendimento farmacêutico."
        actions={
          <Tabs
            label="Filtro"
            value={filter}
            onValueChange={setFilter}
            options={[
              { value: "all", label: "Todas" },
              { value: "escalated", label: "Atendimentos" },
            ]}
          />
        }
      />
      <LoadState state={state} section="conversas" what="as conversas" skeleton={<Card><TableSkeleton /></Card>}>
        {list.length === 0 ? (
          <Card>
            <EmptyState title="Nenhuma conversa ainda" description="As conversas dos clientes com o Alex aparecem aqui, em modo leitura." />
          </Card>
        ) : (
          <div className="flex flex-wrap items-start gap-4">
            <Card className="min-w-0 max-w-full flex-[1_1_320px] p-2 md:max-w-[420px]">
              <ul className="flex max-h-[70dvh] flex-col overflow-y-auto">
                {list.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(c.id)}
                      aria-current={c.id === selected}
                      className={cn("flex w-full flex-col gap-1 rounded-lg p-3 text-left", c.id === selected ? "bg-brand-soft" : "hover:bg-bg-2")}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <b className="truncate">{who(c)}</b>
                        <span className="flex-none text-xs text-muted">{timeAgo(c.lastMessageAt)}</span>
                      </span>
                      <span className="line-clamp-2 text-[13px] text-muted">{c.preview || "Sem mensagens"}</span>
                      {c.status === "escalated" && <Badge variant="red" className="w-fit">Atendimento</Badge>}
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
            <div className="min-w-0 flex-[2_1_460px]">{selected && <Thread id={selected} />}</div>
          </div>
        )}
      </LoadState>
    </PageStack>
  );
}

function Thread({ id }: { id: string }) {
  const { can } = useSession();
  const state = useLoad<MirrorThread>(() => getConversationThread(id), [id]);
  const t = state.data?.id === id ? state.data : null;
  if (state.error && !t) return <Card><ErrorState error={state.error} onRetry={() => void state.reload()} what="esta conversa" /></Card>;
  if (!t) return <Card className="p-5"><Skeleton className="h-64" aria-busy="true" /></Card>;
  const title = t.lead?.name || t.lead?.phone || (t.referenceCode ? `Visitante ${t.referenceCode}` : "Visitante");
  return (
    <Card>
      <div data-slot="card-header" className="flex items-start justify-between gap-3 p-5 pb-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <p className="mt-0.5 text-xs text-muted">{t.personaName}, assistente virtual com IA</p>
        </div>
        {t.status === "escalated" && can("atendimento", "view") && (
          <LinkButton href="/atendimento" variant="outline" size="sm">
            Abrir atendimento
          </LinkButton>
        )}
      </div>
      <div className="mt-2 flex flex-col gap-2.5 rounded-b-xl bg-bg p-5" aria-label="Mensagens da conversa">
        {t.messages.length === 0 && <p className="text-sm text-muted">Sem mensagens.</p>}
        {t.messages.map((m) => (
          <Bubble key={m.id} m={m} persona={t.personaName} visitor={t.lead?.name?.split(" ")[0] ?? "Cliente"} />
        ))}
      </div>
      <p className="px-5 pb-4 pt-3 text-xs text-muted">
        Esta tela só espelha o que o cliente viu.{" "}
        <Link href="/atendimento" className="underline">
          Respostas são enviadas pelo atendimento farmacêutico.
        </Link>
      </p>
    </Card>
  );
}

function Bubble({ m, persona, visitor }: { m: MirrorMessage; persona: string; visitor: string }) {
  if (m.role === "system") {
    return (
      <div className="text-center">
        <Badge variant="soft">{m.content}</Badge>
      </div>
    );
  }
  const isVisitor = m.role === "visitor";
  const isPerson = m.role === "owner";
  const by = isVisitor ? visitor : isPerson ? [m.authorName, m.authorRole].filter(Boolean).join(" · ") || "Equipe" : `${persona} · IA`;
  return (
    <div className={cn("flex", isVisitor ? "justify-end" : "justify-start")}>
      <div className="max-w-[78%]">
        <div className={cn("mb-0.5 text-xs text-muted", isVisitor ? "text-right" : "text-left")}>{by}</div>
        <div
          className={cn(
            "whitespace-pre-wrap break-words rounded-xl border px-3.5 py-2.5",
            isVisitor ? "border-brand bg-brand text-white" : isPerson ? "border-accent/30 bg-brand-soft text-brand-2" : "border-border bg-surface text-ink",
          )}
        >
          {m.content}
        </div>
      </div>
    </div>
  );
}
