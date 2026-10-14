"use client";

import { useState } from "react";
import {
  confirmClassGroup,
  getClassReview,
  getClassReviewProducts,
  setProductClass,
  type ClassGroup,
  type SaleClass,
} from "../../../lib/pharmacy-api";
import { CLASS_LABELS } from "../../../lib/labels";
import { ApiError } from "../../../lib/api";
import { errorMessage, useLoad } from "../../../lib/use-load";
import { useSession } from "../../../lib/session";
import { Badge, toneVariant } from "../../../components/ui/badge";
import { Alert } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { Progress } from "../../../components/ui/progress";
import { Select } from "../../../components/ui/select";
import { Card } from "../../../components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import { EmptyState, LoadState, PageHeader, PageStack, SectionCard, TableSkeleton } from "../../../components/page-kit";

export default function ClassReviewPage() {
  const { me, can } = useSession();
  const state = useLoad(() => getClassReview(), []);
  const canConfirm = can("classes", "edit") && Boolean(me?.canPerformPharmacistActions);
  const progress = state.data?.progress;
  const groups = state.data?.groups ?? [];

  return (
    <PageStack className="max-w-[980px]">
      <PageHeader
        back={{ href: "/catalogo", label: "Catálogo" }}
        title="Revisar classes"
        subtitle="A IA propôs uma classe para cada produto. Nada é vendido no chat antes da confirmação do farmacêutico."
      />
      {canConfirm ? (
        <Alert variant="soft">
          Revisão feita por{" "}
          <b>
            {me?.member.name} · {me?.role.name}
            {me?.member.crf ? ` (${me.member.crf})` : ""}
          </b>
          . Produtos incertos ficam sem classe e não podem ser vendidos.
        </Alert>
      ) : (
        <Alert variant="amber">Somente um farmacêutico com CRF cadastrado confirma classes. Você pode acompanhar as propostas, mas não confirmar.</Alert>
      )}
      <LoadState state={state} section="classes" what="as classes propostas" skeleton={<Card><TableSkeleton rows={4} /></Card>}>
        {progress && (
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
            <span>Confirmados nesta revisão:</span>
            <b className="text-ink">
              {progress.confirmed} de {progress.total}
            </b>
            <Progress value={progress.percent} className="max-w-[280px] flex-1" />
          </div>
        )}
        {groups.every((g) => g.count === 0) ? (
          <Card>
            <EmptyState title="Nenhuma classe para revisar" description="Importe uma planilha de estoque para a IA propor as classes dos produtos." />
          </Card>
        ) : (
          groups.map((g) => <GroupCard key={g.key} group={g} canConfirm={canConfirm} onChanged={() => void state.reload()} />)
        )}
      </LoadState>
    </PageStack>
  );
}

function GroupCard({ group: g, canConfirm, onChanged }: { group: ClassGroup; canConfirm: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(g.key === "controlled");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const products = useLoad(() => (open ? getClassReviewProducts(g.key) : Promise.resolve(null)), [open, g.key, g.confirmedCount]);

  async function confirmAll() {
    setBusy(true);
    setError("");
    try {
      await confirmClassGroup(g.key);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError && e.code === "CRF_REQUIRED" ? "Somente um farmacêutico com CRF cadastrado confirma classes." : errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard
      title={
        <span className="flex flex-wrap items-center gap-2">
          {g.title}
          <Badge variant={toneVariant(g.badge)}>{g.count} produtos</Badge>
        </span>
      }
      description={g.hint}
      action={
        <>
          {g.canConfirm && !g.done && canConfirm && g.count > 0 && (
            <Button size="sm" disabled={busy} onClick={confirmAll}>
              {busy ? "Confirmando…" : "Confirmar todos"}
            </Button>
          )}
          {g.done && <Badge variant="green">Confirmado</Badge>}
          <Button variant="outline" size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? "Ocultar" : "Ver produtos"}
          </Button>
        </>
      }
      flush
    >
      {error && (
        <div className="px-5 pb-3">
          <Alert variant="red">{error}</Alert>
        </div>
      )}
      {open && (
        <>
          {products.loading && !products.data ? (
            <TableSkeleton rows={3} />
          ) : (products.data?.items.length ?? 0) === 0 ? (
            <EmptyState title="Nenhum produto neste grupo" />
          ) : (
            <Table bare>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead>Proposta por</TableHead>
                  <TableHead>Classe proposta</TableHead>
                  {canConfirm && <TableHead className="text-right">Ação</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.data!.items.map((r) => (
                  <ProductReviewRow key={r.id} row={r} groupKey={g.key} canConfirm={canConfirm} onChanged={() => { void products.reload(); onChanged(); }} />
                ))}
              </TableBody>
            </Table>
          )}
          {products.data?.nextCursor && <p className="px-5 py-3 text-xs text-muted">Mostrando os primeiros 50 produtos. Use “Confirmar todos” para o grupo inteiro.</p>}
        </>
      )}
    </SectionCard>
  );
}

function ProductReviewRow({
  row,
  groupKey,
  canConfirm,
  onChanged,
}: {
  row: { id: string; name: string; subtitle: string; by: string; classProposed: SaleClass | null; needsReview: boolean };
  groupKey: ClassGroup["key"];
  canConfirm: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState<SaleClass>("otc");
  const shown = (row.classProposed ?? groupKey) as SaleClass;
  async function apply(c: SaleClass) {
    setBusy(true);
    try {
      await setProductClass(row.id, c);
      onChanged();
    } finally {
      setBusy(false);
    }
  }
  return (
    <TableRow>
      <TableCell>
        <b>{row.name}</b>
        <div className="text-xs text-muted">{row.subtitle}</div>
      </TableCell>
      <TableCell className="text-muted">{row.by}</TableCell>
      <TableCell>
        <Badge variant={toneVariant(CLASS_LABELS[shown]?.badge)}>{CLASS_LABELS[shown]?.label ?? shown}</Badge>
      </TableCell>
      {canConfirm && (
        <TableCell className="text-right">
          {groupKey === "unclassified" ? (
            <span className="flex items-center justify-end gap-2">
              <span className="w-36">
                <Select aria-label={`Classe de ${row.name}`} value={choice} onChange={(e) => setChoice(e.target.value as SaleClass)}>
                  <option value="otc">Venda livre</option>
                  <option value="prescription">Receita</option>
                  <option value="controlled">Controlado</option>
                </Select>
              </span>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => apply(choice)}>
                Definir
              </Button>
            </span>
          ) : (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => apply(groupKey)}>
              Confirmar
            </Button>
          )}
        </TableCell>
      )}
    </TableRow>
  );
}
