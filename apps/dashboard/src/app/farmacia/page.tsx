"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  confirmProposal,
  dismissProposal,
  getPharmacySettings,
  savePharmacySettings,
  type PharmacySettingsDto,
} from "../../lib/pharmacy-api";
import { PAYMENT_METHODS } from "../../lib/labels";
import { errorMessage, useLoad } from "../../lib/use-load";
import { useSession } from "../../lib/session";
import { formatCnpj, timeAgo } from "../../lib/format";
import { ApiError } from "../../lib/api";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Input } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { Tabs } from "../../components/ui/segmented";
import { Textarea } from "../../components/ui/textarea";
import { Field, LinkButton, LoadState, PageHeader, PageStack, SectionCard } from "../../components/page-kit";
import { NotificationsAlwaysOn } from "../../components/page-notifications";
import { AppearanceTab } from "../../components/pharmacy/settings/AppearanceTab";
import { FIELD_KEY, describeProposed, pendingKeys, toForm, toPatch, type SettingsForm } from "../../components/pharmacy/settings/model";

const TABS = [
  { value: "identidade", label: "Identidade e legal" },
  { value: "entrega", label: "Entrega" },
  { value: "retirada", label: "Retirada" },
  { value: "limites", label: "Limites" },
  { value: "estoque", label: "Estoque" },
  { value: "horarios", label: "Horários" },
  { value: "aparencia", label: "Aparência" },
] as const;
type TabKey = (typeof TABS)[number]["value"];

export default function FarmaciaPage() {
  return (
    <Suspense fallback={null}>
      <Farmacia />
    </Suspense>
  );
}

function Farmacia() {
  const router = useRouter();
  const params = useSearchParams();
  const tabParam = params.get("tab") as TabKey | null;
  const tab: TabKey = TABS.some((t) => t.value === tabParam) ? tabParam! : "identidade";
  const { me, can, refresh } = useSession();
  const canEdit = can("farmacia", "edit");
  const isOwner = me?.role.key === "owner";
  const state = useLoad(() => getPharmacySettings(), []);
  const dto = state.data;

  const [form, setForm] = useState<SettingsForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  useEffect(() => {
    if (dto) setForm(toForm(dto.settings));
  }, [dto]);

  const pending = useMemo(() => pendingKeys(dto?.proposals ?? {}), [dto]);
  const pendingCount = Object.values(dto?.proposals ?? {}).filter((p) => p.status === "pending").length;
  const badge = (field: keyof typeof FIELD_KEY) => (pending.has(FIELD_KEY[field]) ? <Badge variant="amber" className="h-[18px]">confirmar</Badge> : undefined);
  const set = useCallback(<K extends keyof SettingsForm>(k: K, v: SettingsForm[K]) => setForm((f) => (f ? { ...f, [k]: v } : f)), []);
  const setTab = (t: TabKey) => router.replace(`/farmacia?tab=${t}`, { scroll: false });

  const result = form && dto ? toPatch(form, dto.settings) : null;
  const dirty = result ? Object.keys(result.patch).length > 0 : false;

  async function save() {
    if (!form || !dto || !result) return;
    if (result.error) return setMsg({ kind: "error", text: result.error });
    setBusy(true);
    setMsg(null);
    try {
      const next = await savePharmacySettings(result.patch);
      state.setData(next);
      setMsg({ kind: "ok", text: "Alterações salvas." });
    } catch (e) {
      setMsg({
        kind: "error",
        text: e instanceof ApiError && e.code === "OWNER_PROTECTED" ? "Identidade legal só para proprietário." : errorMessage(e),
      });
    } finally {
      setBusy(false);
    }
  }

  async function proposal(fieldKey: string, action: "confirm" | "dismiss") {
    setBusy(true);
    setMsg(null);
    try {
      state.setData(action === "confirm" ? await confirmProposal(fieldKey) : await dismissProposal(fieldKey));
      await refresh();
    } catch (e) {
      setMsg({ kind: "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  const identityLocked = !canEdit || !isOwner;

  return (
    <PageStack className="max-w-[980px]">
      <PageHeader
        title="Farmácia"
        subtitle="Regras que o sistema aplica no chat e nos pedidos"
        actions={canEdit && tab !== "aparencia" ? <Button disabled={busy || !dirty} onClick={save}>{busy ? "Salvando…" : "Salvar alterações"}</Button> : undefined}
      />
      <NotificationsAlwaysOn text={dto?.banner ? `${dto.banner.replace(/\.$/, "")}. Não podem ser desligadas.` : undefined} />
      {!canEdit && <Alert variant="amber">Você pode ver estas regras, mas a sua função não permite alterá-las.</Alert>}
      {msg && <Alert variant={msg.kind === "ok" ? "soft" : "red"}>{msg.text}</Alert>}

      <LoadState state={state} section="farmacia" what="as configurações da farmácia">
        {dto && form && (
          <>
            {pendingCount > 0 && (
              <Alert variant="amber" title={`${pendingCount} ${pendingCount === 1 ? "campo foi preenchido" : "campos foram preenchidos"} pela entrevista com o Assistente e ${pendingCount === 1 ? "aguarda" : "aguardam"} sua confirmação`}>
                Eles aparecem marcados com “confirmar”. Nada é aplicado antes de você confirmar.
              </Alert>
            )}
            {pendingCount > 0 && canEdit && (
              <SectionCard title="Sugestões do Assistente" description="Respostas da entrevista que viram regras da farmácia">
                <ul className="flex flex-col divide-y divide-border">
                  {Object.values(dto.proposals)
                    .filter((p) => p.status === "pending")
                    .map((p) => {
                      const entries = Object.entries(p.proposed ?? {});
                      return (
                        <li key={p.fieldKey} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                          <div className="min-w-0">
                            <b>{p.label}</b>
                            <div className="text-[13px] text-muted">Resposta: “{p.rawAnswer}” · {timeAgo(p.proposedAt)}</div>
                            {entries.length > 0 ? (
                              <div className="text-[13px]">{entries.map(([k, v]) => describeProposed(k, v)).join(" · ")}</div>
                            ) : (
                              <div className="text-[13px] text-amber-800">Não consegui interpretar a resposta. Preencha o campo manualmente.</div>
                            )}
                          </div>
                          <div className="flex gap-2">
                            {entries.length > 0 && (
                              <Button size="sm" disabled={busy} onClick={() => proposal(p.fieldKey, "confirm")}>
                                Confirmar
                              </Button>
                            )}
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => proposal(p.fieldKey, "dismiss")}>
                              Dispensar
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                </ul>
              </SectionCard>
            )}

            <Tabs label="Seções" value={tab} onValueChange={setTab} options={TABS} className="w-fit" />

            {tab === "identidade" && (
              <SectionCard title="Identidade e legal" description="Aparece no rodapé do chat para o cliente">
                {!isOwner && canEdit && <Alert variant="soft" className="mb-4">Identidade legal só para proprietário.</Alert>}
                <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
                  <Field label="Razão social" htmlFor="a1" badge={badge("legalName")}>
                    <Input id="a1" value={form.legalName} disabled={identityLocked} onChange={(e) => set("legalName", e.target.value)} />
                  </Field>
                  <Field label="CNPJ" htmlFor="a2" badge={badge("cnpj")}>
                    <Input id="a2" inputMode="numeric" value={formatCnpj(form.cnpj)} disabled={identityLocked} onChange={(e) => set("cnpj", e.target.value.replace(/\D/g, "").slice(0, 14))} placeholder="00.000.000/0000-00" />
                  </Field>
                  <Field label="Autorização de funcionamento (AFE)" htmlFor="a3" badge={badge("afeNumber")}>
                    <Input id="a3" value={form.afeNumber} disabled={identityLocked} onChange={(e) => set("afeNumber", e.target.value)} />
                  </Field>
                  <Field label="Farmacêutico responsável" htmlFor="a4" badge={badge("pharmacistName")}>
                    <Input id="a4" value={form.pharmacistName} disabled={identityLocked} onChange={(e) => set("pharmacistName", e.target.value)} />
                  </Field>
                  <Field label="CRF" htmlFor="a5" badge={badge("pharmacistCrf")}>
                    <Input id="a5" value={form.pharmacistCrf} disabled={identityLocked} onChange={(e) => set("pharmacistCrf", e.target.value)} placeholder="CRF-PR 00000" />
                  </Field>
                </div>
              </SectionCard>
            )}

            {tab === "entrega" && (
              <>
                <SectionCard
                  title="Entrega"
                  description="Pedidos fora da área vão para o farmacêutico"
                  action={<Switch checked={form.deliveryEnabled} disabled={!canEdit} onCheckedChange={(v) => set("deliveryEnabled", v)} aria-label="Entrega ligada" />}
                >
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
                    <Field label="Taxa de entrega" htmlFor="b1" badge={badge("deliveryFee")}>
                      <Input id="b1" inputMode="decimal" value={form.deliveryFee} disabled={!canEdit} onChange={(e) => set("deliveryFee", e.target.value)} placeholder="6,00" />
                    </Field>
                    <Field label="Pedido mínimo" htmlFor="b2" badge={badge("minOrder")}>
                      <Input id="b2" inputMode="decimal" value={form.minOrder} disabled={!canEdit} onChange={(e) => set("minOrder", e.target.value)} placeholder="15,00" />
                    </Field>
                    <Field
                      label="Bairros e faixas de CEP atendidos"
                      htmlFor="b3"
                      className="col-span-full"
                      badge={badge("areas")}
                      hint="Separe por vírgula. Números com 5 dígitos valem como prefixo de CEP (ex.: 80250)."
                    >
                      <Textarea id="b3" rows={3} value={form.areas} disabled={!canEdit} onChange={(e) => set("areas", e.target.value)} placeholder="Água Verde, Batel, Centro, 80250" />
                    </Field>
                  </div>
                </SectionCard>
                <SectionCard title="Pagamento" description="O pagamento é sempre feito na entrega ou na retirada">
                  <div className="flex flex-wrap gap-5" role="group" aria-label="Formas de pagamento">
                    {PAYMENT_METHODS.map((m) => (
                      <label key={m.value} className="flex cursor-pointer items-center gap-2">
                        <Checkbox
                          checked={form.payments.includes(m.value)}
                          disabled={!canEdit}
                          onCheckedChange={(v) => set("payments", v === true ? [...form.payments, m.value] : form.payments.filter((x) => x !== m.value))}
                          aria-label={m.label}
                        />
                        {m.label}
                      </label>
                    ))}
                    {badge("payments")}
                  </div>
                </SectionCard>
              </>
            )}

            {tab === "retirada" && (
              <SectionCard
                title="Retirada em loja"
                description="O cliente retira e paga na farmácia"
                action={<Switch checked={form.pickupEnabled} disabled={!canEdit} onCheckedChange={(v) => set("pickupEnabled", v)} aria-label="Retirada ligada" />}
              >
                <Field label="Política de troca" htmlFor="c1" badge={badge("exchangePolicy")} hint="Mostrada ao cliente quando ele pergunta sobre trocas e devoluções.">
                  <Textarea id="c1" rows={3} value={form.exchangePolicy} disabled={!canEdit} onChange={(e) => set("exchangePolicy", e.target.value)} />
                </Field>
              </SectionCard>
            )}

            {tab === "limites" && (
              <SectionCard title="Limites" description="O sistema aplica essas regras antes de confirmar">
                <div className="flex flex-col gap-5">
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4">
                    <Field label="Quantidade máxima por item" htmlFor="d1" badge={badge("maxQty")}>
                      <Input id="d1" inputMode="numeric" value={form.maxQty} disabled={!canEdit} onChange={(e) => set("maxQty", e.target.value)} />
                    </Field>
                    <Field label="Lembrete de pedido parado (min)" htmlFor="d2" badge={badge("reminder")} hint="Quanto tempo um pedido novo espera antes de alertar a equipe.">
                      <Input id="d2" inputMode="numeric" value={form.reminder} disabled={!canEdit} onChange={(e) => set("reminder", e.target.value)} />
                    </Field>
                    <Field label="Guarda das fotos de receita (dias)" htmlFor="d3" badge={badge("retentionDays")} hint="Depois do pedido encerrado, a foto é apagada.">
                      <Input id="d3" inputMode="numeric" value={form.retentionDays} disabled={!canEdit} onChange={(e) => set("retentionDays", e.target.value)} />
                    </Field>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <b>Confirmar pedidos livres automaticamente</b>
                      <div className="text-xs text-muted">Quando o produto é de venda livre, tem estoque e a planilha está em dia</div>
                    </div>
                    <Switch checked={form.autoConfirm} disabled={!canEdit} onCheckedChange={(v) => set("autoConfirm", v)} aria-label="Confirmação automática" />
                  </div>
                  <hr className="border-border" />
                  <div className="flex flex-col gap-1">
                    <b>Sempre exigem farmacêutico, mesmo sendo de venda livre</b>
                    <p className="text-[13px] text-muted">
                      Marque cada produto no <Link href="/catalogo" className="font-semibold text-accent hover:underline">Catálogo</Link> (opção “Sempre exige farmacêutico”).
                    </p>
                  </div>
                </div>
              </SectionCard>
            )}

            {tab === "estoque" && (
              <SectionCard title="Estoque" description="Protege contra planilhas antigas">
                <div className="flex flex-col gap-4">
                  <Field label="Idade máxima da planilha para confirmar sozinho" htmlFor="e1" className="max-w-xs" badge={badge("stockMaxAge")}>
                    <Select id="e1" value={form.stockMaxAge} disabled={!canEdit} onChange={(e) => set("stockMaxAge", e.target.value)}>
                      {Array.from(new Set(["6", "12", "24", "48", "72", form.stockMaxAge])).sort((a, b) => Number(a) - Number(b)).map((h) => (
                        <option key={h} value={h}>
                          {h} horas
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <p className="text-[13px] text-muted">
                    {dto.sheet?.stockAsOf
                      ? `Planilha atual: atualizada ${timeAgo(dto.sheet.stockAsOf)}. ${dto.sheet.stale ? "Está acima do limite: todo pedido vai para o farmacêutico." : "Acima do limite, todo pedido vai para o farmacêutico."}`
                      : "Nenhuma planilha importada ainda. Sem ela, todo pedido vai para o farmacêutico."}
                  </p>
                  {can("importar", "edit") && <LinkButton href="/catalogo/importar" variant="outline" className="w-fit">Atualizar planilha</LinkButton>}
                </div>
              </SectionCard>
            )}

            {tab === "horarios" && (
              <SectionCard title="Horários" description="Mostrados ao cliente no chat">
                <div className="flex max-w-[560px] flex-col gap-3">
                  {badge("hours")}
                  {form.hours.map((h, i) => (
                    <div key={h.key} className="flex flex-wrap items-center justify-between gap-3">
                      <span className="w-40 flex-none">{h.label}</span>
                      <span className="flex items-center gap-2 text-muted">
                        {h.open ? (
                          <>
                            <Input
                              type="time"
                              aria-label={`${h.label}: abre às`}
                              value={h.from ?? ""}
                              disabled={!canEdit}
                              className="h-9 w-[110px]"
                              onChange={(e) => set("hours", form.hours.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))}
                            />
                            <span>às</span>
                            <Input
                              type="time"
                              aria-label={`${h.label}: fecha às`}
                              value={h.to ?? ""}
                              disabled={!canEdit}
                              className="h-9 w-[110px]"
                              onChange={(e) => set("hours", form.hours.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))}
                            />
                          </>
                        ) : (
                          "Fechado"
                        )}
                      </span>
                      <Switch
                        checked={h.open}
                        disabled={!canEdit}
                        aria-label={`${h.label} aberto`}
                        onCheckedChange={(v) => set("hours", form.hours.map((x, j) => (j === i ? { ...x, open: v, from: v ? x.from ?? "08:00" : x.from, to: v ? x.to ?? "18:00" : x.to } : x)))}
                      />
                    </div>
                  ))}
                </div>
              </SectionCard>
            )}

            {tab === "aparencia" && (
              <>
                <AppearanceTab canEdit={canEdit} quickChips={form.chips.split("\n").map((c) => c.trim()).filter(Boolean)} />
                <SectionCard title="Atalhos do chat" description="Botões que aparecem para o cliente logo na abertura (até 4, um por linha)">
                  <Field label="Atalhos" htmlFor="chips" badge={badge("chips")}>
                    <Textarea id="chips" rows={4} value={form.chips} disabled={!canEdit} onChange={(e) => set("chips", e.target.value)} />
                  </Field>
                  {canEdit && (
                    <Button className="mt-4" disabled={busy || !dirty} onClick={save}>
                      {busy ? "Salvando…" : "Salvar atalhos"}
                    </Button>
                  )}
                </SectionCard>
              </>
            )}
          </>
        )}
      </LoadState>
    </PageStack>
  );
}
