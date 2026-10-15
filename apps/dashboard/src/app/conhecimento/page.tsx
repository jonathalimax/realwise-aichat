"use client";

import { useRef, useState } from "react";
import { FileText, MessageSquareText, Pencil, Search, Trash2, Upload } from "lucide-react";
import {
  answerKbOpenQuestion,
  createKbQa,
  deleteKbDocument,
  deleteKbQa,
  getKbDocuments,
  getKbOpenQuestions,
  getKbQa,
  testKbAlex,
  updateKbQa,
  uploadKbDocument,
  type KbDocument,
  type KbOpenQuestion,
  type KbQa,
  type KbTestResult,
  type SearchMode,
} from "../../lib/pharmacy-api";
import { useLoad, errorMessage } from "../../lib/use-load";
import { useSession } from "../../lib/session";
import { modeOf } from "../../lib/nav";
import { timeAgo } from "../../lib/format";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Tabs } from "../../components/ui/segmented";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { EmptyState, Field, LoadState, PageHeader, PageStack, SectionCard, TableSkeleton } from "../../components/page-kit";

type Tab = "qa" | "documents" | "open";

const HEALTH_WARNING = "Não coloque dados de clientes nem orientações de dosagem. Dose, horário e indicação de remédio são sempre do farmacêutico: o Alex encaminha essas perguntas e não usa a base para elas.";

function ModeBadge({ mode }: { mode: SearchMode }) {
  if (mode === "semantic") return null;
  if (mode === "pending") return <Badge variant="gray">Indexando</Badge>;
  return (
    <Badge variant="soft" title="Sem busca por significado: o Alex encontra este conteúdo pelas palavras da pergunta.">
      Busca por palavras
    </Badge>
  );
}

export default function ConhecimentoPage() {
  const { can, me } = useSession();
  const canEdit = can("conhecimento", "edit");
  const attendance = modeOf(me) === "attendance";
  const [tab, setTab] = useState<Tab>("qa");
  const qa = useLoad(() => getKbQa(), []);
  const docs = useLoad(() => getKbDocuments(), []);
  const open = useLoad(() => getKbOpenQuestions(), []);

  return (
    <PageStack>
      <PageHeader title="Base de conhecimento" subtitle="Tudo o que o Alex pode responder sobre a sua farmácia, além do que já está nas configurações." />
      {attendance && (
        <Alert variant="soft" title="No modo atendimento, a base é o cérebro do Alex">
          Quanto mais perguntas dos clientes você cobrir aqui (estacionamento, convênios, promoções, trocas), menos o cliente espera pela equipe.
        </Alert>
      )}
      <Alert variant="amber" title="Só informações da loja">
        {HEALTH_WARNING}
      </Alert>
      <TestAlexCard />
      <Tabs
        label="Seções da base de conhecimento"
        value={tab}
        onValueChange={setTab}
        options={[
          { value: "qa", label: "Perguntas e respostas", count: qa.data?.items.length ?? null },
          { value: "documents", label: "Documentos", count: docs.data?.length ?? null },
          { value: "open", label: "Perguntas sem resposta", count: open.data?.items.length ?? null },
        ]}
      />
      {tab === "qa" && <QaSection state={qa} canEdit={canEdit} />}
      {tab === "documents" && <DocumentsSection state={docs} canEdit={canEdit} />}
      {tab === "open" && <OpenQuestionsSection state={open} canEdit={canEdit} onSaved={() => void qa.reload()} />}
    </PageStack>
  );
}

// ---------------------------------------------------------------- Testar o Alex
function TestAlexCard() {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<KbTestResult | null>(null);

  async function run() {
    if (!question.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await testKbAlex(question.trim()));
    } catch (e) {
      setResult(null);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Testar o Alex" description="Digite uma pergunta como um cliente faria e veja o que ele responderia com a base. Nada é enviado a clientes nem cria atendimento.">
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ex.: Vocês têm estacionamento?" aria-label="Pergunta de teste" maxLength={300} />
        <Button type="submit" disabled={busy || !question.trim()}>
          <Search className="h-4 w-4" aria-hidden /> {busy ? "Consultando..." : "Perguntar"}
        </Button>
      </form>
      {error && (
        <Alert variant="red" className="mt-3">
          {error}
        </Alert>
      )}
      {result && (
        <div className="mt-4 flex flex-col gap-3" aria-live="polite">
          {result.outcome === "answer" ? (
            <div className="rounded-xl border border-border bg-bg-2 p-4">
              <div className="mb-1 text-xs font-semibold text-muted">O Alex responderia</div>
              <p className="whitespace-pre-wrap text-sm text-ink">{result.answer}</p>
              {result.message && <p className="mt-2 text-xs text-muted">{result.message}</p>}
            </div>
          ) : (
            <Alert variant={result.outcome === "pharmacist" ? "soft" : "amber"} title={result.outcome === "pharmacist" ? "Vai para o farmacêutico" : "Sem resposta na base"}>
              {result.message}
            </Alert>
          )}
          {result.sources.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs font-semibold text-muted">Fontes encontradas</div>
              <ul className="flex flex-col gap-2">
                {result.sources.map((s, i) => (
                  <li key={i} className="flex gap-2.5 rounded-lg border border-border p-3 text-sm">
                    {s.kind === "qa" ? <MessageSquareText className="mt-0.5 h-4 w-4 flex-none text-muted" aria-hidden /> : <FileText className="mt-0.5 h-4 w-4 flex-none text-muted" aria-hidden />}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-ink">{s.name}</span>
                        <Badge variant={s.kind === "qa" ? "accent" : "outline"}>{s.kind === "qa" ? "Pergunta e resposta" : "Documento"}</Badge>
                        {s.used && <Badge variant="green">Usada na resposta</Badge>}
                      </div>
                      <p className="mt-1 text-xs text-muted">{s.excerpt}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------- Perguntas e respostas
function QaSection({ state, canEdit }: { state: ReturnType<typeof useLoad<{ items: KbQa[]; max: number }>>; canEdit: boolean }) {
  const [editing, setEditing] = useState<KbQa | "new" | null>(null);
  const [removing, setRemoving] = useState<KbQa | null>(null);
  const items = state.data?.items ?? [];

  return (
    <SectionCard
      title="Perguntas e respostas"
      description="Respostas curtas para o que os clientes mais perguntam. O Alex usa estas respostas antes de chamar a equipe."
      action={
        <Button onClick={() => setEditing("new")} disabled={!canEdit} title={canEdit ? undefined : "Você pode ver, mas não editar."}>
          Adicionar pergunta
        </Button>
      }
    >
      <LoadState state={state} section="conhecimento" what="as perguntas" skeleton={<TableSkeleton rows={3} />}>
        {items.length === 0 ? (
          <EmptyState title="Nenhuma pergunta cadastrada" description={'Comece com algo como "Vocês têm estacionamento?" e "Sim, gratuito para clientes".'} />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {items.map((q) => (
              <li key={q.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{q.question}</span>
                    <ModeBadge mode={q.searchMode} />
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted">{q.answer}</p>
                </div>
                <div className="flex flex-none gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => setEditing(q)} disabled={!canEdit} aria-label={`Editar: ${q.question}`}>
                    <Pencil className="h-3.5 w-3.5" aria-hidden /> Editar
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => setRemoving(q)} disabled={!canEdit} aria-label={`Excluir: ${q.question}`}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden /> Excluir
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </LoadState>
      <QaDialog target={editing} onClose={() => setEditing(null)} onSaved={() => void state.reload()} />
      <Dialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir esta pergunta?</DialogTitle>
            <DialogDescription>O Alex deixa de usar esta resposta: {removing?.question}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!removing) return;
                await deleteKbQa(removing.id).catch(() => undefined);
                setRemoving(null);
                void state.reload();
              }}
            >
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}

function QaDialog({ target, onClose, onSaved }: { target: KbQa | "new" | null; onClose: () => void; onSaved: () => void }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastTarget, setLastTarget] = useState<typeof target>(null);
  if (target !== lastTarget) {
    setLastTarget(target);
    setError(null);
    setQuestion(target && target !== "new" ? target.question : "");
    setAnswer(target && target !== "new" ? target.answer : "");
  }

  async function save() {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      if (target === "new") await createKbQa(question, answer);
      else await updateKbQa(target.id, question, answer);
      onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{target === "new" ? "Nova pergunta e resposta" : "Editar pergunta e resposta"}</DialogTitle>
          <DialogDescription>Escreva como o cliente pergunta e como você responderia no balcão.</DialogDescription>
        </DialogHeader>
        <Field label="Pergunta do cliente" htmlFor="kb-q">
          <Input id="kb-q" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Vocês têm estacionamento?" maxLength={200} />
        </Field>
        <Field label="Resposta" htmlFor="kb-a" hint="Curta e direta. Sem dose, horário de uso ou indicação de remédio, e sem dados de clientes.">
          <Textarea id="kb-a" rows={4} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Sim, gratuito para clientes." maxLength={1200} />
        </Field>
        {error && <Alert variant="red">{error}</Alert>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={busy || question.trim().length < 5 || answer.trim().length < 2}>
            {busy ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Documentos
const STATUS: Record<KbDocument["status"], { label: string; variant: "gray" | "amber" | "green" | "red" }> = {
  uploaded: { label: "Na fila", variant: "gray" },
  processing: { label: "Processando", variant: "amber" },
  processed: { label: "Pronto", variant: "green" },
  failed: { label: "Falhou", variant: "red" },
};

function DocumentsSection({ state, canEdit }: { state: ReturnType<typeof useLoad<KbDocument[]>>; canEdit: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<KbDocument | null>(null);
  const docs = state.data ?? [];

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await uploadKbDocument(file);
      await state.reload();
      // The worker processes in the background: refresh a few times so "Processando" turns into "Pronto".
      for (const wait of [2000, 4000, 8000]) {
        await new Promise((r) => setTimeout(r, wait));
        await state.reload();
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard
      title="Documentos"
      description="Cardápio de serviços, política de trocas, convênios, regulamento de promoções. PDF, DOCX ou TXT, até 20 MB."
      action={
        <>
          <input ref={input} type="file" accept=".pdf,.docx,.txt,.md" disabled={!canEdit} className="sr-only" aria-label="Enviar documento" onChange={onPick} tabIndex={-1} />
          <Button onClick={() => input.current?.click()} disabled={!canEdit || busy} title={canEdit ? undefined : "Você pode ver, mas não editar."}>
            <Upload className="h-4 w-4" aria-hidden /> {busy ? "Enviando..." : "Enviar documento"}
          </Button>
        </>
      }
    >
      {error && (
        <Alert variant="red" className="mb-3">
          {error}
        </Alert>
      )}
      <LoadState state={state} section="conhecimento" what="os documentos" skeleton={<TableSkeleton rows={3} />}>
        {docs.length === 0 ? (
          <EmptyState title="Nenhum documento" description="Envie um arquivo e o Alex passa a responder com ele." />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {docs.map((d) => (
              <li key={d.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <FileText className="h-4 w-4 flex-none text-muted" aria-hidden />
                    <span className="break-all font-medium text-ink">{d.filename}</span>
                    <Badge variant={STATUS[d.status].variant}>{STATUS[d.status].label}</Badge>
                    {d.status === "processed" && <ModeBadge mode={d.searchMode} />}
                  </div>
                  <p className="mt-0.5 text-xs text-muted">
                    Enviado {timeAgo(d.createdAt)}
                    {d.status === "failed" && d.processingError ? ` · ${d.processingError}` : ""}
                  </p>
                </div>
                <Button size="sm" variant="destructive" onClick={() => setRemoving(d)} disabled={!canEdit} aria-label={`Excluir documento ${d.filename}`}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden /> Excluir
                </Button>
              </li>
            ))}
          </ul>
        )}
      </LoadState>
      <Dialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir este documento?</DialogTitle>
            <DialogDescription>O Alex deixa de usar o conteúdo de {removing?.filename}.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!removing) return;
                await deleteKbDocument(removing.id).catch(() => undefined);
                setRemoving(null);
                void state.reload();
              }}
            >
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}

// ---------------------------------------------------------------- Perguntas sem resposta
function OpenQuestionsSection({ state, canEdit, onSaved }: { state: ReturnType<typeof useLoad<{ items: KbOpenQuestion[] }>>; canEdit: boolean; onSaved: () => void }) {
  const [answering, setAnswering] = useState<KbOpenQuestion | null>(null);
  const items = state.data?.items ?? [];

  return (
    <SectionCard title="Perguntas sem resposta" description="Perguntas que os clientes fizeram e o Alex não soube responder. Responda uma vez e a resposta fica na base para os próximos clientes.">
      <LoadState state={state} section="conhecimento" what="as perguntas" skeleton={<TableSkeleton rows={3} />}>
        {items.length === 0 ? (
          <EmptyState title="Nenhuma pergunta esperando" description="Quando o Alex não souber algo, a pergunta aparece aqui." />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {items.map((q) => (
              <li key={q.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="font-medium text-ink">{q.question}</div>
                  <p className="text-xs text-muted">Perguntada {timeAgo(q.createdAt)}</p>
                </div>
                <Button size="sm" onClick={() => setAnswering(q)} disabled={!canEdit} title={canEdit ? undefined : "Você pode ver, mas não editar."}>
                  Responder e salvar na base
                </Button>
              </li>
            ))}
          </ul>
        )}
      </LoadState>
      <AnswerDialog
        target={answering}
        onClose={() => setAnswering(null)}
        onDone={() => {
          void state.reload();
          onSaved();
        }}
      />
    </SectionCard>
  );
}

function AnswerDialog({ target, onClose, onDone }: { target: KbOpenQuestion | null; onClose: () => void; onDone: () => void }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<KbOpenQuestion | null>(null);
  if (target !== last) {
    setLast(target);
    setError(null);
    setQuestion(target?.question ?? "");
    setAnswer("");
  }

  async function submit(saveToKb: boolean) {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await answerKbOpenQuestion(target.id, { answer, question, saveToKb });
      onDone();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Responder e salvar na base</DialogTitle>
          <DialogDescription>A resposta vai para o cliente no chat e fica na base para as próximas vezes.</DialogDescription>
        </DialogHeader>
        <Field label="Pergunta (ajuste a redação se quiser)" htmlFor="oq-q">
          <Input id="oq-q" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={200} />
        </Field>
        <Field label="Resposta" htmlFor="oq-a" hint="Sem dose, horário de uso, indicação de remédio ou dados de clientes.">
          <Textarea id="oq-a" rows={4} value={answer} onChange={(e) => setAnswer(e.target.value)} maxLength={1200} />
        </Field>
        {error && <Alert variant="red">{error}</Alert>}
        <DialogFooter>
          <Button variant="outline" onClick={() => void submit(false)} disabled={busy || answer.trim().length < 2}>
            Só responder
          </Button>
          <Button onClick={() => void submit(true)} disabled={busy || answer.trim().length < 2 || question.trim().length < 5}>
            {busy ? "Enviando..." : "Responder e salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
