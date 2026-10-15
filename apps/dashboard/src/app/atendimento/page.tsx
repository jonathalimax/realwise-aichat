"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { closeHandoff, getHandoff, getHandoffs, handoffChatLink, markHandoffAnswered, replyHandoff, startHandoff, type HandoffDetail, type HandoffList, type HandoffStatus, type SuggestionItem } from "../../lib/pharmacy-api";
import { ApiError } from "../../lib/api";
import { errorMessage, useLoad } from "../../lib/use-load";
import { useSession } from "../../lib/session";
import { timeAgo } from "../../lib/format";
import { Badge, toneVariant } from "../../components/ui/badge";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import { Tabs } from "../../components/ui/segmented";
import { Card } from "../../components/ui/card";
import { Skeleton } from "../../components/ui/skeleton";
import { ReplyProductPicker } from "../../components/atendimento/ReplyProductPicker";
import { WhatsappDialog } from "../../components/atendimento/WhatsappDialog";
import { EmptyState, ErrorState, LoadState, PageHeader, PageStack, TableSkeleton } from "../../components/page-kit";
import { cn } from "../../lib/utils";

/** +5541999990001 -> (41) 99999-0001 */
function formatPhone(raw?: string | null): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return raw;
}

export default function AtendimentoPage() {
  return (
    <Suspense fallback={null}>
      <Atendimento />
    </Suspense>
  );
}

const TABS: { value: HandoffStatus; label: string; key: "open" | "answered" }[] = [
  { value: "open", label: "Abertos", key: "open" },
  { value: "answered", label: "Respondidos", key: "answered" },
];
const POLL_MS = 20_000;
type Kind = "all" | "clinical" | "general";
const KINDS: { value: Kind; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "clinical", label: "Precisam do farmacêutico" },
  { value: "general", label: "Qualquer atendente" },
];

/** Who may answer: clinical handoffs need a pharmacist (CRF); the rest can be answered by any staff with Atendimento access. */
function WhoBadge({ requiresPharmacist }: { requiresPharmacist?: boolean }) {
  return requiresPharmacist ? <Badge variant="amber">Farmacêutico</Badge> : <Badge variant="gray">Qualquer atendente</Badge>;
}

function Atendimento() {
  const initial = useSearchParams().get("open");
  const [status, setStatus] = useState<HandoffStatus>("open");
  const [selected, setSelected] = useState<string | null>(initial);
  const [kind, setKind] = useState<Kind>("all");
  const state = useLoad(() => getHandoffs({ status }), [status], { live: "handoffs" });
  const all = state.data?.items ?? [];
  const items = all.filter((h) => (kind === "all" ? true : kind === "clinical" ? h.requiresPharmacist : !h.requiresPharmacist));

  useEffect(() => {
    const t = setInterval(() => document.visibilityState === "visible" && void state.reload(), POLL_MS);
    return () => clearInterval(t);
  }, [state.reload]); // eslint-disable-line react-hooks/exhaustive-deps

  // keep a valid selection: first item of the list when nothing (or something stale) is selected
  useEffect(() => {
    if (!state.data) return;
    if (selected && (items.some((i) => i.id === selected) || selected === initial)) return;
    setSelected(items[0]?.id ?? null);
  }, [state.data, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <PageStack>
      <PageHeader
        title="Atendimento farmacêutico"
        subtitle="Conversas que o Alex encaminhou para a equipe responder"
        actions={<Tabs label="Situação" value={status} onValueChange={setStatus} options={TABS.map((t) => ({ value: t.value, label: t.label, count: state.data?.counts?.[t.key] ?? null }))} />}
      />
      <Alert variant="soft">
        Dúvidas clínicas, receitas e controlados só podem ser respondidos por um farmacêutico com CRF. Perguntas gerais, produto em falta e pedidos de produto qualquer pessoa da equipe com acesso ao Atendimento responde. As sugestões abaixo aparecem só para a equipe e nunca são enviadas ao cliente.
      </Alert>
      <Tabs label="Tipo de atendimento" value={kind} onValueChange={setKind} options={KINDS} />
      <LoadState state={state} section="atendimento" what="os atendimentos" skeleton={<TableSkeleton />}>
        {items.length === 0 ? (
          <Card>
            <EmptyState title={kind !== "all" && all.length > 0 ? "Nenhum atendimento deste tipo" : status === "open" ? "Nenhum atendimento aberto" : "Nenhum atendimento respondido"} description="Quando o Alex encaminhar uma conversa para a equipe, ela aparece aqui." />
          </Card>
        ) : (
          <div className="flex flex-wrap items-start gap-4">
            <Card className="min-w-0 max-w-full flex-[1_1_340px] p-2 md:max-w-[460px]">
              <ul className="flex flex-col">
                {items.map((h) => (
                  <HandoffRow key={h.id} h={h} active={h.id === selected} onPick={() => setSelected(h.id)} />
                ))}
              </ul>
            </Card>
            <div className="min-w-0 flex-[2_1_480px]">
              {selected ? <Detail id={selected} onChanged={() => void state.reload()} /> : null}
            </div>
          </div>
        )}
      </LoadState>
    </PageStack>
  );
}

function HandoffRow({ h, active, onPick }: { h: HandoffList; active: boolean; onPick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        aria-current={active}
        className={cn("flex w-full flex-col gap-1 rounded-lg p-3 text-left", active ? "bg-brand-soft" : "hover:bg-bg-2")}
      >
        <span className="flex items-center justify-between gap-2">
          <b>{h.who}</b>
          <Badge variant={toneVariant(h.tagBadge)}>{h.tag}</Badge>
        </span>
        <span className="text-[13px] text-muted">{h.summary}</span>
        <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
          {timeAgo(h.createdAt)}
          <WhoBadge requiresPharmacist={h.requiresPharmacist} />
          {h.inProgress && <Badge variant="soft">Em atendimento · {h.inProgress.byName}</Badge>}
        </span>
      </button>
    </li>
  );
}

function Detail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const { me, can, refreshNotifications } = useSession();
  const state = useLoad<HandoffDetail>(() => getHandoff(id), [id], { live: "handoffs" });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"reply" | "close" | "answered" | null>(null);
  const [error, setError] = useState("");
  const [waOpen, setWaOpen] = useState(false);
  const [chatMode, setChatMode] = useState(false);
  const [picked, setPicked] = useState<SuggestionItem[]>([]);
  const [note, setNote] = useState("");
  const [linkCopied, setLinkCopied] = useState<"ok" | "fail" | null>(null);
  useEffect(() => {
    setPicked([]);
    setNote("");
    setLinkCopied(null);
    setText("");
    setError("");
    setWaOpen(false);
    setChatMode(false);
  }, [id]);
  const h = state.data?.id === id ? state.data : null;
  const canReply = can("atendimento", "edit") && (h?.canHandle ?? Boolean(me?.canPerformPharmacistActions));
  const hasPhone = Boolean(h?.contact?.hasPhone);
  const onWhatsapp = h?.inProgress?.channel === "whatsapp";

  async function onWhatsappStarted() {
    state.setData(await startHandoff(id, "whatsapp"));
    onChanged();
  }

  async function replyInChat() {
    setChatMode(true);
    if (!h?.inProgress) startHandoff(id, "chat").then((u) => { state.setData(u); onChanged(); }).catch(() => undefined);
  }

  async function act(kind: "reply" | "close" | "answered") {
    setBusy(kind);
    setError("");
    try {
      const updated = kind === "reply" ? await replyHandoff(id, { text: text.trim() || undefined, productIds: picked.length ? picked.map((p) => p.productId) : undefined, note: picked.length && note.trim() ? note.trim() : undefined }) : kind === "close" ? await closeHandoff(id) : await markHandoffAnswered(id);
      state.setData(updated);
      setText("");
      setPicked([]);
      setNote("");
      onChanged();
      void refreshNotifications();
    } catch (e) {
      setError(e instanceof ApiError && e.code === "CRF_REQUIRED" ? "Somente um farmacêutico com CRF cadastrado pode responder." : errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function copyChatLink() {
    setLinkCopied(null);
    try {
      const { url } = await handoffChatLink(id);
      await navigator.clipboard.writeText(url);
      setLinkCopied("ok");
    } catch {
      setLinkCopied("fail");
    }
  }

  if (state.error && !h) return <Card><ErrorState error={state.error} onRetry={() => void state.reload()} what="este atendimento" /></Card>;
  if (!h) return <Card className="p-5"><Skeleton className="h-64" aria-busy="true" /></Card>;

  return (
    <Card>
      <div data-slot="card-header" className="flex items-start justify-between gap-3 p-5 pb-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-ink">
            {h.who} · {h.reasonLabel}
          </h2>
          <p className="mt-0.5 text-xs text-muted">{timeAgo(h.createdAt)} · consentimento LGPD registrado</p>
        </div>
        <span className="flex flex-wrap items-center justify-end gap-1.5">
          <WhoBadge requiresPharmacist={h.requiresPharmacist} />
          <Badge variant={toneVariant(h.tagBadge)}>{h.tag}</Badge>
        </span>
      </div>
      <div className="flex flex-col gap-4 p-5 pt-1">
        {h.briefRows.length > 0 ? (
          <dl className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
            {h.briefRows.map((b) => (
              <div key={b.label} className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted">{b.label}</dt>
                <dd className="font-medium">{b.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-muted">Sem resumo estruturado para este atendimento (o prazo de guarda pode ter vencido).</p>
        )}
        {h.suggestion && (
          <Alert variant="amber" title={h.suggestion.label}>
            {h.suggestion.text}
          </Alert>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {h.conversationId && can("conversas", "view") && (
            <Link href={`/conversas?open=${h.conversationId}`} className="text-[13px] font-semibold text-accent hover:underline">
              Ver conversa completa →
            </Link>
          )}
          {canReply && h.status !== "closed" && h.conversationId && (
            <Button type="button" variant="outline" size="sm" onClick={() => void copyChatLink()}>
              Copiar link do chat
            </Button>
          )}
          {linkCopied === "ok" && <span role="status" className="text-xs text-green-700">Link copiado. Ele abre a mesma conversa, com o histórico.</span>}
          {linkCopied === "fail" && <span role="alert" className="text-xs text-red-700">Não consegui copiar o link.</span>}
        </div>
        <hr className="border-border" />
        {error && <Alert variant="red">{error}</Alert>}
        {h.status === "open" && h.inProgress && (
          <Alert variant="soft">
            Em atendimento · {h.inProgress.byName} · {h.inProgress.byRole}
            {onWhatsapp ? " (WhatsApp)" : " (chat)"}.
          </Alert>
        )}
        {h.status === "open" && canReply && (
          <>
            {hasPhone && (
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => setWaOpen(true)} disabled={busy !== null}>
                  {onWhatsapp ? "Abrir WhatsApp novamente" : "Iniciar atendimento"}
                </Button>
                {onWhatsapp && (
                  <Button variant="outline" disabled={busy !== null} onClick={() => act("answered")}>
                    {busy === "answered" ? "Salvando…" : "Marcar como respondido"}
                  </Button>
                )}
                {!chatMode && (
                  <Button variant="outline" disabled={busy !== null} onClick={replyInChat}>
                    Responder aqui no chat
                  </Button>
                )}
                <span className="text-xs text-muted">
                  Contato: {h.contact?.firstName ?? "cliente"} · {formatPhone(h.contact?.phone) ?? h.contact?.phoneMasked}
                </span>
              </div>
            )}
            {!hasPhone && (
              <p className="text-xs text-muted">Este cliente não informou o WhatsApp: a resposta vai pelo chat.</p>
            )}
            {(chatMode || !hasPhone) && (
              <>
                {!h.requiresPharmacist && (
                  <p className="text-xs text-muted">Pergunta geral: qualquer pessoa da equipe pode responder.</p>
                )}
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="reply" className="text-sm font-medium">
                    Responder ao cliente
                  </label>
                  <Textarea id="reply" rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Sua resposta aparece no chat com seu nome e função" />
                </div>
                <ReplyProductPicker selected={picked} onChange={setPicked} disabled={busy !== null} alexSuggestions={h.requiresPharmacist ? (h.suggestion?.products ?? []) : []} />
                {picked.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="reply-note" className="text-sm font-medium">
                      Observação sobre os produtos <span className="font-normal text-muted">(opcional)</span>
                    </label>
                    <Textarea id="reply-note" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: tomar após as refeições" />
                  </div>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-muted">
                    Será enviado como {me?.member.name} · {me?.role.name}
                  </span>
                  <span className="flex gap-2">
                    <Button variant="outline" disabled={busy !== null} onClick={() => act("close")}>
                      {busy === "close" ? "Encerrando…" : "Encerrar sem responder"}
                    </Button>
                    <Button disabled={busy !== null || (text.trim().length === 0 && picked.length === 0)} onClick={() => act("reply")}>
                      {busy === "reply" ? "Enviando…" : picked.length > 0 ? "Enviar resposta e produtos" : "Enviar resposta"}
                    </Button>
                  </span>
                </div>
              </>
            )}
            {hasPhone && !chatMode && (
              <div>
                <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => act("close")}>
                  {busy === "close" ? "Encerrando…" : "Encerrar sem responder"}
                </Button>
              </div>
            )}
            {hasPhone && <WhatsappDialog handoffId={id} open={waOpen} onOpenChange={setWaOpen} onStarted={onWhatsappStarted} />}
          </>
        )}
        {h.status === "open" && !canReply && (
          <Alert variant="soft">
            {h.requiresPharmacist
              ? "Este atendimento é clínico: somente um farmacêutico com CRF cadastrado pode responder ou encerrar. Você pode acompanhar o resumo e o contato."
              : "Você não tem permissão para responder atendimentos."}
            {hasPhone && (
              <span className="mt-1 block text-xs">
                Contato: {h.contact?.firstName ?? "cliente"} · {formatPhone(h.contact?.phone) ?? h.contact?.phoneMasked}
              </span>
            )}
          </Alert>
        )}
        {h.status !== "open" && h.answer && (
          <Alert variant="soft">
            {h.answer.text.startsWith("Atendimento continuado pelo WhatsApp") ? (
              <>Respondido por {h.answer.byName} · {h.answer.byRole}. A conversa continuou pelo WhatsApp e o cliente viu um aviso no chat.</>
            ) : (
              <>
                Respondido por {h.answer.byName} · {h.answer.byRole}. O cliente viu a mensagem no chat.
                <span className="mt-1 block text-[13px] opacity-80">“{h.answer.text}”</span>
              </>
            )}
          </Alert>
        )}
        {h.status === "closed" && !h.answer && <Alert variant="soft">Atendimento encerrado.</Alert>}
      </div>
    </Card>
  );
}
