"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  CRF_SECTIONS,
  NICHE_SECTIONS,
  SECTION_LABELS,
  readOnlySectionsFor,
  type PermissionLevel,
  type PermissionSection,
} from "@realwise/shared";
import { createRole, getPermissionSections, getRoles, updateRole, type PermissionMap, type Role } from "../../../../lib/pharmacy-api";
import { ApiError } from "../../../../lib/api";
import { errorMessage, useLoad } from "../../../../lib/use-load";
import { useSession } from "../../../../lib/session";
import { Alert } from "../../../../components/ui/alert";
import { Button, buttonVariants } from "../../../../components/ui/button";
import { Card } from "../../../../components/ui/card";
import { Input } from "../../../../components/ui/input";
import { Select } from "../../../../components/ui/select";
import { Switch } from "../../../../components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../../components/ui/table";
import { Field, LoadState, PageHeader, PageStack } from "../../../../components/page-kit";
import { NotificationsAlwaysOn } from "../../../../components/page-notifications";
import { cn } from "../../../../lib/utils";

export default function RoleEditorPage() {
  return (
    <Suspense fallback={null}>
      <RoleEditor />
    </Suspense>
  );
}

interface SectionRow {
  key: PermissionSection;
  label: string;
  note?: string | null;
  crfOnly: boolean;
  readOnly: boolean;
}

const LEVELS: { value: PermissionLevel; label: string }[] = [
  { value: "none", label: "Nenhum" },
  { value: "view", label: "Ver" },
  { value: "edit", label: "Editar" },
];

const ERRORS: Record<string, string> = {
  STARTER_ROLE: "Funções padrão não podem ser alteradas. Duplique e edite a cópia.",
  OWNER_PROTECTED: "Somente um proprietário altera esta função.",
  CRF_REQUIRED: "Funções com edição em Receitas, Atendimento ou Revisar classes precisam exigir CRF.",
};

function RoleEditor() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const from = useSearchParams().get("from");
  const { niche, can } = useSession();
  const creating = id === "nova";
  const rolesState = useLoad(() => getRoles(), []);
  const sectionsState = useLoad(() => getPermissionSections(), []);
  const roles = rolesState.data?.items ?? [];
  const existing = creating ? null : roles.find((r) => r.id === id) ?? null;
  const base = existing ?? (from ? roles.find((r) => r.id === from) ?? null : null);

  // Section rows: from the API (labels, notes, locks) or the shared model when that route is not deployed yet.
  const rows: SectionRow[] = useMemo(() => {
    if (sectionsState.data) return sectionsState.data.sections.map((s) => ({ ...s }));
    const readOnly = readOnlySectionsFor(niche);
    return NICHE_SECTIONS[niche].map((key) => ({ key, label: SECTION_LABELS[key], note: null, crfOnly: CRF_SECTIONS.includes(key), readOnly: readOnly.includes(key) }));
  }, [sectionsState.data, niche]);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [requiresCrf, setRequiresCrf] = useState(false);
  const [ownOnly, setOwnOnly] = useState(false);
  const [perms, setPerms] = useState<Partial<PermissionMap>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (seeded || !rolesState.data) return;
    if (base) {
      setName(creating ? `${base.name} (cópia)` : base.name);
      setDescription(base.description ?? "");
      setRequiresCrf(base.requiresCrf);
      setOwnOnly(base.ownDeliveriesOnly);
      setPerms({ ...base.permissions });
    } else if (creating) {
      const initial: Partial<PermissionMap> = {};
      for (const r of rows) initial[r.key] = "none";
      setPerms(initial);
    }
    setSeeded(true);
  }, [rolesState.data, base, creating, seeded, rows]);

  const readOnlyRole = Boolean(existing && (existing.isStarter || existing.key === "owner"));
  const canEdit = can("equipe", "edit") && !readOnlyRole;

  function setLevel(row: SectionRow, level: PermissionLevel) {
    setPerms((p) => ({ ...p, [row.key]: level }));
  }
  function toggleCrf(v: boolean) {
    setRequiresCrf(v);
    if (!v) {
      // edit on pharmacist-only sections is not allowed without CRF
      setPerms((p) => {
        const next = { ...p };
        for (const r of rows) if (r.crfOnly && next[r.key] === "edit") next[r.key] = "view";
        return next;
      });
    }
  }
  function startFrom(roleId: string) {
    const r = roles.find((x) => x.id === roleId);
    if (!r) {
      const blank: Partial<PermissionMap> = {};
      for (const row of rows) blank[row.key] = "none";
      setPerms(blank);
      setRequiresCrf(false);
      return;
    }
    setPerms({ ...r.permissions });
    setRequiresCrf(r.requiresCrf);
    setOwnOnly(r.ownDeliveriesOnly);
  }

  async function save() {
    setError("");
    if (!name.trim()) return setError("Dê um nome para a função.");
    const permissions: Partial<PermissionMap> = {};
    for (const r of rows) permissions[r.key] = perms[r.key] ?? "none";
    setBusy(true);
    try {
      const body = { name: name.trim(), description: description.trim() || undefined, requiresCrf, permissions, ownDeliveriesOnly: ownOnly };
      if (creating) await createRole(body);
      else await updateRole(id, body);
      router.push("/equipe?tab=funcoes");
    } catch (e) {
      setError(e instanceof ApiError && e.code && ERRORS[e.code] ? ERRORS[e.code]! : errorMessage(e));
      setBusy(false);
    }
  }

  const notFound = !creating && rolesState.data && !existing;

  return (
    <PageStack className="max-w-[980px]">
      <PageHeader
        back={{ href: "/equipe?tab=funcoes", label: "Equipe e acessos" }}
        title={creating ? "Nova função" : existing?.name ?? "Função"}
        subtitle="Escolha o que essa função pode ver e fazer. O menu lateral mostra só o que a pessoa pode abrir."
      />
      <LoadState state={rolesState} section="equipe" what="a função">
        {notFound ? (
          <Alert variant="amber">Função não encontrada. Ela pode ter sido excluída.</Alert>
        ) : (
          <>
            {readOnlyRole && <Alert variant="soft">Funções padrão não podem ser editadas. Use “Duplicar” na lista de funções para criar uma versão personalizada.</Alert>}
            <Card>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] items-end gap-4 p-5">
                <Field label="Nome da função" htmlFor="rn">
                  <Input id="rn" value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Atendente sênior" />
                </Field>
                {creating ? (
                  <Field label="Começar a partir de" htmlFor="rb">
                    <Select id="rb" defaultValue={from ?? ""} onChange={(e) => startFrom(e.target.value)}>
                      <option value="">Em branco</option>
                      {roles.map((r: Role) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : (
                  <Field label="Descrição" htmlFor="rd">
                    <Input id="rd" value={description} disabled={!canEdit} onChange={(e) => setDescription(e.target.value)} />
                  </Field>
                )}
                {niche === "farmacia" && (
                  <div className="flex min-h-9 items-center justify-between gap-3 rounded-lg border border-border px-3 py-1.5">
                    <span>Exige CRF de farmacêutico</span>
                    <Switch checked={requiresCrf} disabled={!canEdit} onCheckedChange={toggleCrf} aria-label="Exige CRF" />
                  </div>
                )}
                {niche === "farmacia" && (
                  <div className="flex min-h-9 items-center justify-between gap-3 rounded-lg border border-border px-3 py-1.5">
                    <span>Vê somente as próprias entregas</span>
                    <Switch checked={ownOnly} disabled={!canEdit} onCheckedChange={setOwnOnly} aria-label="Somente as próprias entregas" />
                  </div>
                )}
              </div>
              {creating && (
                <div className="px-5 pb-5">
                  <Field label="Descrição (opcional)" htmlFor="rd2">
                    <Input id="rd2" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Para que serve esta função" />
                  </Field>
                </div>
              )}
            </Card>

            <Card>
              <Table bare className="min-w-[640px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Seção</TableHead>
                    {LEVELS.map((l) => (
                      <TableHead key={l.value}>{l.label}</TableHead>
                    ))}
                    <TableHead>Observação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const level = perms[r.key] ?? "none";
                    const editLocked = (r.crfOnly && !requiresCrf) || r.readOnly;
                    return (
                      <TableRow key={r.key}>
                        <TableCell>
                          <b>{r.label}</b>
                        </TableCell>
                        {LEVELS.map((l) => {
                          const selected = level === l.value;
                          const locked = !canEdit || (l.value === "edit" && editLocked);
                          return (
                            <TableCell key={l.value}>
                              <button
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                aria-label={`${r.label}: ${l.label.toLowerCase()}`}
                                disabled={locked && !selected}
                                onClick={() => !locked && setLevel(r, l.value)}
                                className={cn(
                                  "inline-flex h-[22px] w-[22px] items-center justify-center rounded-full border text-[10px] leading-none disabled:cursor-not-allowed disabled:opacity-40",
                                  selected ? "border-accent bg-accent text-white" : "border-border bg-surface hover:bg-bg-2",
                                )}
                              >
                                {selected ? "●" : ""}
                              </button>
                            </TableCell>
                          );
                        })}
                        <TableCell className="text-xs text-muted">
                          {r.note}
                          {r.crfOnly && !requiresCrf && <span className="block text-amber-800">Editar exige função com CRF.</span>}
                          {r.readOnly && <span className="block">Somente leitura.</span>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>

            <NotificationsAlwaysOn text="Notificações de pedidos e atendimentos continuam ativas para quem tem acesso a essas seções. Não é possível desligá-las." />
            {error && <Alert variant="red">{error}</Alert>}
            <div className="flex justify-end gap-2">
              <Link href="/equipe?tab=funcoes" className={cn(buttonVariants({ variant: "outline" }))}>
                {canEdit ? "Cancelar" : "Voltar"}
              </Link>
              {canEdit && (
                <Button disabled={busy} onClick={save}>
                  {busy ? "Salvando…" : "Salvar função"}
                </Button>
              )}
            </div>
          </>
        )}
      </LoadState>
    </PageStack>
  );
}
