"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { deleteRole, getAccessLog, getMembers, getRoles, type LogEntry, type Member, type Role } from "../../lib/pharmacy-api";
import { accessLogDetail, LOG_CATEGORY_BADGE, MEMBER_STATUS_BADGE } from "../../lib/labels";
import { ApiError } from "../../lib/api";
import { errorMessage, useLoad } from "../../lib/use-load";
import { useSession } from "../../lib/session";
import { formatLogWhen, timeAgo } from "../../lib/format";
import { Avatar } from "../../components/ui/avatar";
import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button, buttonVariants } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Select } from "../../components/ui/select";
import { Tabs } from "../../components/ui/segmented";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { EmptyState, LinkButton, LoadState, PageHeader, PageStack, TableSkeleton } from "../../components/page-kit";
import { InviteDialog } from "../../components/team/InviteDialog";
import { MemberDialog } from "../../components/team/MemberDialog";
import { cn } from "../../lib/utils";

export default function EquipePage() {
  return (
    <Suspense fallback={null}>
      <Equipe />
    </Suspense>
  );
}

type TabKey = "membros" | "funcoes" | "registro";

function Equipe() {
  const router = useRouter();
  const params = useSearchParams();
  const { me, can } = useSession();
  const canEdit = can("equipe", "edit");
  const isOwner = me?.role.key === "owner";
  const canSeeLog = me?.role.key === "owner" || me?.role.key === "manager";
  const requested = params.get("tab") as TabKey | null;
  const tab: TabKey = requested === "funcoes" ? "funcoes" : requested === "registro" && canSeeLog ? "registro" : "membros";
  const setTab = (t: TabKey) => router.replace(t === "membros" ? "/equipe" : `/equipe?tab=${t}`, { scroll: false });

  const members = useLoad(() => getMembers(), []);
  const roles = useLoad(() => getRoles(), []);
  const [invite, setInvite] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const reloadAll = () => {
    void members.reload();
    void roles.reload();
  };

  return (
    <PageStack>
      <PageHeader
        title="Equipe e acessos"
        subtitle="Cadastre funcionários e controle o que cada um pode ver e fazer"
        actions={canEdit ? <Button onClick={() => setInvite(true)} disabled={!roles.data}>Convidar funcionário</Button> : undefined}
      />
      <Tabs
        label="Seção"
        value={tab}
        onValueChange={setTab}
        className="w-fit"
        options={[
          { value: "membros", label: "Membros" },
          { value: "funcoes", label: "Funções" },
          ...(canSeeLog ? [{ value: "registro" as const, label: "Registro de acessos" }] : []),
        ]}
      />

      {tab === "membros" && (
        <Card>
          <LoadState state={members} section="equipe" what="a equipe" skeleton={<TableSkeleton />}>
            {(members.data?.items.length ?? 0) === 0 ? (
              <EmptyState title="Nenhum funcionário cadastrado" description="Convide a equipe por e-mail. Cada pessoa entra com o acesso da função escolhida." />
            ) : (
              <Table bare>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pessoa</TableHead>
                    <TableHead>Função</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead>Último acesso</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.data!.items.map((m) => {
                    const protectedFromMe = m.locked || (!isOwner && m.role.key === "owner");
                    return (
                      <TableRow key={m.id}>
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <Avatar initials={m.initials} />
                            <div className="min-w-0">
                              <b>{m.name}</b>
                              {m.id === me?.member.id && <span className="ml-1.5 text-xs text-muted">(você)</span>}
                              <div className="truncate text-xs text-muted">{m.email}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={m.role.key === "owner" ? "default" : m.role.isStarter ? "soft" : "outline"}>{m.role.name}</Badge>
                          {m.crf && <div className="mt-0.5 text-xs text-muted">{m.crf}</div>}
                        </TableCell>
                        <TableCell>
                          <Badge variant={MEMBER_STATUS_BADGE[m.status]}>{m.statusLabel}</Badge>
                        </TableCell>
                        <TableCell className="text-muted">{m.lastAccessAt ? timeAgo(m.lastAccessAt) : "nunca"}</TableCell>
                        <TableCell className="text-right">
                          {protectedFromMe ? (
                            <span className="text-xs text-muted">Só um proprietário altera</span>
                          ) : canEdit ? (
                            <Button variant="outline" size="sm" onClick={() => setEditing(m)}>
                              Alterar acesso
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </LoadState>
        </Card>
      )}

      {tab === "funcoes" && <RolesTab state={roles} canEdit={canEdit} onChanged={reloadAll} />}
      {tab === "registro" && canSeeLog && <AccessLogTab members={members.data?.items ?? []} />}

      <InviteDialog open={invite} onOpenChange={setInvite} roles={roles.data?.items ?? []} canGrantOwner={Boolean(isOwner)} onInvited={reloadAll} />
      <MemberDialog
        member={editing}
        roles={roles.data?.items ?? []}
        isOwner={Boolean(isOwner)}
        isSelf={editing?.id === me?.member.id}
        onClose={() => setEditing(null)}
        onChanged={reloadAll}
      />
    </PageStack>
  );
}

function RolesTab({ state, canEdit, onChanged }: { state: ReturnType<typeof useLoad<{ items: Role[] }>>; canEdit: boolean; onChanged: () => void }) {
  const [toDelete, setToDelete] = useState<Role | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <LoadState state={state} section="equipe" what="as funções" skeleton={<Card><TableSkeleton rows={3} /></Card>}>
      {error && <Alert variant="red">{error}</Alert>}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
        {state.data?.items.map((r) => (
          <Card key={r.id}>
            <div data-slot="card-header" className="flex items-start justify-between gap-3 p-5 pb-3">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-ink">{r.name}</h2>
                <p className="mt-0.5 text-xs capitalize text-muted">{r.key ?? "personalizada"}</p>
              </div>
              <Badge variant={r.isStarter ? "gray" : "soft"}>{r.isStarter ? "Padrão" : "Personalizada"}</Badge>
            </div>
            <div className="flex flex-col gap-3 p-5 pt-1">
              <p className="text-[13px] text-muted">{r.description}</p>
              {r.requiresCrf && <Badge variant="amber" className="w-fit">Exige CRF</Badge>}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px]">{r.memberCount} {r.memberCount === 1 ? "pessoa" : "pessoas"}</span>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/equipe/funcoes/${r.id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                    {r.isStarter ? "Ver permissões" : canEdit ? "Editar" : "Ver permissões"}
                  </Link>
                  {canEdit && (
                    <Link href={`/equipe/funcoes/nova?from=${r.id}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
                      Duplicar
                    </Link>
                  )}
                  {canEdit && !r.isStarter && (
                    <Button variant="ghost" size="sm" onClick={() => setToDelete(r)}>
                      Excluir
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </Card>
        ))}
        {canEdit && (
          <Card className="border-dashed shadow-none">
            <div className="flex h-full flex-col items-center justify-center gap-2.5 p-5 text-center">
              <b>Criar função personalizada</b>
              <span className="text-[13px] text-muted">Escolha o que pode ver e editar em cada seção.</span>
              <LinkButton href="/equipe/funcoes/nova" size="sm">Nova função</LinkButton>
            </div>
          </Card>
        )}
      </div>
      <Dialog open={Boolean(toDelete)} onOpenChange={(o) => !o && setToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir a função {toDelete?.name}?</DialogTitle>
            <DialogDescription>Funções em uso por alguém da equipe não podem ser excluídas.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToDelete(null)}>Voltar</Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                if (!toDelete) return;
                setBusy(true);
                setError("");
                try {
                  await deleteRole(toDelete.id);
                  setToDelete(null);
                  onChanged();
                } catch (e) {
                  setToDelete(null);
                  setError(e instanceof ApiError && e.code === "ROLE_IN_USE" ? "Esta função ainda tem pessoas. Mude o acesso delas antes de excluir." : errorMessage(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Excluir função
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </LoadState>
  );
}

const CATEGORIES = ["Receita", "Atendimento", "Pedido", "Equipe", "Catálogo", "Configurações", "Plano", "Acesso", "Outros"];

function AccessLogTab({ members }: { members: Member[] }) {
  const [memberId, setMemberId] = useState("");
  const [category, setCategory] = useState("");
  const [extra, setExtra] = useState<LogEntry[]>([]);
  const [tail, setTail] = useState<string | null | undefined>(undefined);
  const [more, setMore] = useState(false);
  const state = useLoad(() => getAccessLog({ memberId: memberId || undefined, category: category || undefined, limit: 50 }), [memberId, category]);
  useEffect(() => {
    setExtra([]);
    setTail(undefined);
  }, [memberId, category]);
  const rows = [...(state.data?.items ?? []), ...extra];
  const nextCursor = tail === undefined ? state.data?.nextCursor ?? null : tail;
  return (
    <>
      <div className="flex flex-wrap gap-3">
        <div className="w-full sm:w-[260px]">
          <Select aria-label="Pessoa" value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            <option value="">Todas as pessoas</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-full sm:w-[220px]">
          <Select aria-label="Tipo" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Todas as ações</option>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </div>
      </div>
      <Card>
        <LoadState state={state} section="equipe" what="o registro de acessos" skeleton={<TableSkeleton />}>
          {rows.length === 0 ? (
            <EmptyState title="Nenhum registro ainda" description="Ações sensíveis (receitas, equipe, catálogo, configurações) aparecem aqui." />
          ) : (
            <>
              <Table bare>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quando</TableHead>
                    <TableHead>Pessoa</TableHead>
                    <TableHead>Ação</TableHead>
                    <TableHead>Detalhe</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="whitespace-nowrap text-muted">{formatLogWhen(l.createdAt)}</TableCell>
                      <TableCell className="whitespace-nowrap">{l.memberName ?? "Sistema"}</TableCell>
                      <TableCell>
                        <Badge variant={LOG_CATEGORY_BADGE[l.category] ?? "outline"}>{l.category}</Badge>
                      </TableCell>
                      <TableCell className="min-w-[240px] text-muted">{accessLogDetail(l)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {nextCursor && (
                <div className="flex justify-center border-t border-border p-3">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={more}
                    onClick={async () => {
                      setMore(true);
                      try {
                        const page = await getAccessLog({ memberId: memberId || undefined, category: category || undefined, cursor: nextCursor, limit: 50 });
                        setExtra((p) => [...p, ...page.items]);
                        setTail(page.nextCursor);
                      } finally {
                        setMore(false);
                      }
                    }}
                  >
                    {more ? "Carregando…" : "Carregar mais"}
                  </Button>
                </div>
              )}
            </>
          )}
        </LoadState>
      </Card>
    </>
  );
}
