"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyCatalogImport,
  getCatalogImport,
  getCatalogImports,
  getImportClassProposals,
  saveImportMapping,
  uploadCatalogImport,
  type CatalogImport,
  type ImportField,
} from "../../../lib/pharmacy-api";
import { CONFIDENCE_LABELS, IMPORT_FIELD_LABELS } from "../../../lib/labels";
import { errorMessage, useLoad } from "../../../lib/use-load";
import { useSession } from "../../../lib/session";
import { formatDateTime } from "../../../lib/format";
import { Badge, toneVariant } from "../../../components/ui/badge";
import { Alert } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { Checkbox } from "../../../components/ui/checkbox";
import { Input } from "../../../components/ui/input";
import { Select } from "../../../components/ui/select";
import { Card } from "../../../components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import { EmptyState, ErrorState, Field, LinkButton, PageHeader, PageStack, SectionCard } from "../../../components/page-kit";
import { Upload, Check } from "lucide-react";
import { cn } from "../../../lib/utils";

const STEPS = ["Arquivo", "Colunas", "Classes", "Confirmar"] as const;
const MAX_BYTES = 20 * 1024 * 1024;
const FIELDS = Object.keys(IMPORT_FIELD_LABELS) as ImportField[];

function localInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ImportPage() {
  const { can } = useSession();
  const canEdit = can("importar", "edit");
  const [step, setStep] = useState(1);
  const [imp, setImp] = useState<CatalogImport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const history = useLoad(() => getCatalogImports(), [done]);

  // poll until the worker finishes mapping (status leaves "uploaded") or finishes applying a large file
  const polling = useRef(false);
  const poll = useCallback(async (id: string, until: (i: CatalogImport) => boolean): Promise<CatalogImport> => {
    polling.current = true;
    const started = Date.now();
    for (;;) {
      const cur = await getCatalogImport(id);
      if (until(cur) || cur.status === "failed" || Date.now() - started > 180_000 || !polling.current) return cur;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }, []);
  useEffect(() => () => void (polling.current = false), []);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError("");
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) return setError("Envie uma planilha Excel (.xlsx, .xls) ou CSV.");
    if (file.size > MAX_BYTES) return setError("O arquivo passa de 20 MB.");
    setBusy(true);
    try {
      const created = await uploadCatalogImport(file);
      setImp(created);
      const ready = created.status === "uploaded" ? await poll(created.id, (i) => i.status !== "uploaded") : created;
      setImp(ready);
      if (ready.status === "failed") setError(ready.error ?? "Não consegui ler esta planilha.");
      else setStep(2);
    } catch (e) {
      setError(errorMessage(e, "Não consegui enviar a planilha."));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setImp(null);
    setStep(1);
    setDone(false);
    setError("");
  }

  return (
    <PageStack className="max-w-[980px]">
      <PageHeader
        back={{ href: "/catalogo", label: "Catálogo" }}
        title="Importar planilha"
        subtitle="Envie o arquivo do seu sistema, do jeito que ele é. A IA entende as colunas."
      />
      <ol className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label="Etapas">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const current = n === step && !done;
          const past = n < step || done;
          return (
            <li key={label} className="flex items-center gap-2 pr-3" aria-current={current ? "step" : undefined}>
              <span className={cn("inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold", current ? "bg-accent text-white" : past ? "bg-brand-soft text-brand-2" : "bg-bg-2 text-muted")}>
                {past ? <Check className="h-4 w-4" /> : n}
              </span>
              <span className={cn("font-medium", current ? "text-ink" : "text-muted")}>{label}</span>
            </li>
          );
        })}
      </ol>
      {error && <Alert variant="red">{error}</Alert>}

      {!canEdit && (
        <Alert variant="amber">Você pode ver o histórico, mas a sua função não permite importar planilhas.</Alert>
      )}

      {canEdit && !done && step === 1 && <UploadStep busy={busy} onFile={onFile} />}
      {canEdit && !done && step === 2 && imp && (
        <MappingStep
          imp={imp}
          onBack={() => setStep(1)}
          onSaved={(next) => {
            setImp(next);
            setStep(3);
          }}
        />
      )}
      {canEdit && !done && step === 3 && imp && <ClassesStep imp={imp} onBack={() => setStep(2)} onNext={() => setStep(4)} />}
      {canEdit && !done && step === 4 && imp && (
        <ConfirmStep
          imp={imp}
          onBack={() => setStep(3)}
          onApplied={async (applied) => {
            const final = applied.status === "applied" ? applied : await poll(applied.id, (i) => i.status === "applied");
            if (final.status === "failed") throw new Error(final.error ?? "A importação falhou.");
            setImp(final);
            setDone(true);
          }}
        />
      )}
      {done && imp && (
        <Card>
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-800">
              <Check className="h-6 w-6" />
            </span>
            <h2 className="text-xl font-semibold">Importação aplicada</h2>
            <p className="text-muted">
              {(imp.stats?.created ?? 0) + (imp.stats?.updated ?? 0)} produtos criados ou atualizados
              {imp.stats && imp.stats.unclassified > 0 ? `, ${imp.stats.unclassified} ainda sem classe` : ""}. Estoque atualizado.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <LinkButton href="/catalogo/classes">Revisar classes</LinkButton>
              <LinkButton href="/catalogo" variant="outline">Ver catálogo</LinkButton>
              <Button variant="ghost" onClick={reset}>Importar outra planilha</Button>
            </div>
          </div>
        </Card>
      )}

      <SectionCard title="Histórico de importações" flush>
        {history.loading && !history.data ? (
          <p className="px-5 py-4 text-sm text-muted">Carregando…</p>
        ) : history.error ? (
          <ErrorState error={history.error} what="o histórico" onRetry={() => void history.reload()} />
        ) : (history.data?.items.length ?? 0) === 0 ? (
          <EmptyState title="Nenhuma importação ainda" description="As planilhas que você enviar aparecem aqui." />
        ) : (
          <Table bare>
            <TableHeader>
              <TableRow>
                <TableHead>Arquivo</TableHead>
                <TableHead>Enviada</TableHead>
                <TableHead>Por</TableHead>
                <TableHead>Resultado</TableHead>
                <TableHead>Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.data!.items.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="font-medium">{i.filename}</TableCell>
                  <TableCell className="text-muted">{formatDateTime(i.createdAt)}</TableCell>
                  <TableCell className="text-muted">{i.createdByName ?? "—"}</TableCell>
                  <TableCell className="text-muted">{i.stats ? `${i.stats.created} novos · ${i.stats.updated} atualizados` : "—"}</TableCell>
                  <TableCell>
                    <Badge variant={i.status === "applied" ? "green" : i.status === "failed" ? "red" : "amber"}>
                      {i.status === "applied" ? "Aplicada" : i.status === "failed" ? "Falhou" : "Em andamento"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </PageStack>
  );
}

function UploadStep({ busy, onFile }: { busy: boolean; onFile: (f: File | undefined) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <Card>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          onFile(e.dataTransfer.files?.[0]);
        }}
        className={cn("m-5 flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-12 text-center", over ? "border-accent bg-brand-soft" : "border-zinc-300")}
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand-2">
          <Upload className="h-5 w-5" />
        </span>
        <b>{busy ? "Lendo a planilha com IA…" : "Arraste a planilha aqui ou escolha um arquivo"}</b>
        <span className="text-[13px] text-muted">{busy ? "Isso leva alguns segundos." : "Excel (.xlsx) ou CSV, até 20 MB. Não precisa seguir um modelo."}</span>
        <input ref={ref} type="file" accept=".xlsx,.xls,.csv" className="sr-only" id="sheet-file" onChange={(e) => onFile(e.target.files?.[0])} />
        <Button disabled={busy} onClick={() => ref.current?.click()}>
          {busy ? "Aguarde…" : "Escolher arquivo"}
        </Button>
      </div>
    </Card>
  );
}

function MappingStep({ imp, onBack, onSaved }: { imp: CatalogImport; onBack: () => void; onSaved: (i: CatalogImport) => void }) {
  const cols = imp.mapping?.columns ?? [];
  const [fields, setFields] = useState<Record<string, ImportField>>(() => Object.fromEntries(cols.map((c) => [c.sourceColumn, c.field])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const chosen = Object.values(fields);
  const missing = (["name", "price"] as ImportField[]).filter((f) => !chosen.includes(f));

  async function next() {
    setBusy(true);
    setError("");
    try {
      onSaved(await saveImportMapping(imp.id, cols.map((c) => ({ sourceColumn: c.sourceColumn, field: fields[c.sourceColumn] ?? "ignore" })), imp.headerRow ?? undefined));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SectionCard
        title="Colunas sugeridas pela IA"
        description={`${imp.filename}${imp.rowCount ? ` · ${imp.rowCount} linhas` : ""} · a IA viu só 20 linhas de exemplo`}
        flush
      >
        {imp.mapping && !imp.mapping.modelUsed && (
          <div className="px-5 pb-3">
            <Alert variant="amber">A IA não estava disponível, então sugerimos as colunas pelo nome do cabeçalho. Confira cada uma com atenção.</Alert>
          </div>
        )}
        <Table bare>
          <TableHeader>
            <TableRow>
              <TableHead>Coluna da planilha</TableHead>
              <TableHead>Exemplo</TableHead>
              <TableHead>Campo</TableHead>
              <TableHead>Confiança</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cols.map((c) => (
              <TableRow key={c.sourceColumn}>
                <TableCell className="font-semibold">{c.sourceColumn}</TableCell>
                <TableCell className="max-w-[220px] truncate text-muted">{c.example}</TableCell>
                <TableCell className="min-w-[200px]">
                  <Select aria-label={`Campo para ${c.sourceColumn}`} value={fields[c.sourceColumn]} onChange={(e) => setFields({ ...fields, [c.sourceColumn]: e.target.value as ImportField })}>
                    {FIELDS.map((f) => (
                      <option key={f} value={f}>
                        {IMPORT_FIELD_LABELS[f]}
                      </option>
                    ))}
                  </Select>
                </TableCell>
                <TableCell>
                  <Badge variant={toneVariant(CONFIDENCE_LABELS[c.confidence].badge)}>{CONFIDENCE_LABELS[c.confidence].label}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SectionCard>
      {missing.length > 0 && <Alert variant="amber">Escolha uma coluna para {missing.map((f) => `“${IMPORT_FIELD_LABELS[f]}”`).join(" e ")}. Elas são obrigatórias.</Alert>}
      {error && <Alert variant="red">{error}</Alert>}
      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>Voltar</Button>
        <Button disabled={busy || missing.length > 0} onClick={next}>{busy ? "Salvando…" : "Continuar"}</Button>
      </div>
    </>
  );
}

function ClassesStep({ imp, onBack, onNext }: { imp: CatalogImport; onBack: () => void; onNext: () => void }) {
  const proposals = useLoad(() => getImportClassProposals(imp.id), [imp.id]);
  const summary = imp.dryRun?.classSummary ?? {};
  const fallback = [
    { key: "controlled", label: "Controlado", count: summary.controlled ?? 0, hint: "Revisão um a um" },
    { key: "prescription", label: "Receita", count: summary.prescription ?? 0, hint: "Exigem foto da receita" },
    { key: "otc", label: "Venda livre", count: summary.otc ?? 0, hint: "Vendidos direto no chat" },
    { key: "unclassified", label: "Incertos", count: summary.unclassified ?? 0, hint: "Sem classe, sem venda" },
  ];
  const groups = proposals.data?.groups ?? fallback;
  const unclassified = groups.find((g) => g.key === "unclassified")?.count ?? 0;
  const badge: Record<string, string> = { controlled: "gray", prescription: "amber", otc: "green", unclassified: "red" };
  return (
    <>
      <SectionCard title="Classes propostas" description="A confirmação é feita depois, em Revisar classes, pelo farmacêutico.">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
          {groups.map((k) => (
            <div key={k.key} className="flex flex-col gap-1 rounded-[10px] border border-border p-3.5">
              <Badge variant={toneVariant(badge[k.key])} className="w-fit">{k.label}</Badge>
              <span className="text-2xl font-bold">{k.count}</span>
              <span className="text-xs text-muted">{k.hint}</span>
            </div>
          ))}
        </div>
      </SectionCard>
      {unclassified > 0 && <Alert variant="amber">Os {unclassified} produtos incertos ficam “sem classe” e não podem ser vendidos no chat.</Alert>}
      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>Voltar</Button>
        <Button onClick={onNext}>Continuar</Button>
      </div>
    </>
  );
}

function ConfirmStep({ imp, onBack, onApplied }: { imp: CatalogImport; onBack: () => void; onApplied: (i: CatalogImport) => Promise<void> }) {
  const [asOf, setAsOf] = useState(() => localInputValue(new Date()));
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const d = imp.dryRun;

  async function apply() {
    if (!checked || !asOf) return;
    setBusy(true);
    setError("");
    try {
      await onApplied(await applyCatalogImport(imp.id, new Date(asOf).toISOString()));
    } catch (e) {
      setError(errorMessage(e, "Não consegui aplicar a importação."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SectionCard title="Confirmar importação" description="Nada é aplicado antes de você confirmar.">
        <div className="flex flex-col gap-4">
          {d && (
            <div className="flex flex-wrap gap-6">
              <span><b>Novos</b> {d.toCreate}</span>
              <span><b>Atualizados</b> {d.toUpdate}</span>
              <span><b>Ignorados</b> {d.skipped}</span>
              <span><b>Sem classe</b> {d.classSummary?.unclassified ?? 0}</span>
            </div>
          )}
          <Field label="Estoque atualizado em" htmlFor="asof" className="max-w-xs">
            <Input id="asof" type="datetime-local" value={asOf} max={localInputValue(new Date())} onChange={(e) => setAsOf(e.target.value)} />
          </Field>
          <label className="flex cursor-pointer items-center gap-2.5">
            <Checkbox checked={checked} onCheckedChange={(v) => setChecked(v === true)} aria-label="Confirmo que o estoque da planilha está correto" />
            <span>Confirmo que o estoque desta planilha está correto na data acima</span>
          </label>
          <p className="text-xs text-muted">Planilhas com mais de 24 horas desligam a confirmação automática de pedidos.</p>
        </div>
      </SectionCard>
      {error && <Alert variant="red">{error}</Alert>}
      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>Voltar</Button>
        <Button disabled={!checked || !asOf || busy} onClick={apply}>{busy ? "Aplicando…" : "Aplicar importação"}</Button>
      </div>
    </>
  );
}
