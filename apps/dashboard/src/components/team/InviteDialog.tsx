"use client";

import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { inviteMember, type Role } from "../../lib/pharmacy-api";
import { ApiError } from "../../lib/api";
import { errorMessage } from "../../lib/use-load";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Field } from "../page-kit";
import { cn } from "../../lib/utils";

/** "Convidar funcionário": e-mail + role (default: starter Attendant). Generic for every niche. */
export function InviteDialog({ open, onOpenChange, roles, canGrantOwner, onInvited }: { open: boolean; onOpenChange: (o: boolean) => void; roles: Role[]; canGrantOwner: boolean; onInvited: () => void }) {
  const options = roles.filter((r) => canGrantOwner || r.key !== "owner");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setEmail("");
    setError("");
    setInviteUrl(null);
    setCopied(false);
    setRoleId((options.find((r) => r.key === "attendant") ?? options[0])?.id ?? "");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const role = options.find((r) => r.id === roleId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await inviteMember({ email: email.trim(), name: name.trim() || undefined, roleId: roleId || undefined });
      onInvited();
      if (res.inviteUrl) setInviteUrl(res.inviteUrl);
      else onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === "EMAIL_IN_USE") setError("Este e-mail já faz parte da equipe.");
      else if (err instanceof ApiError && err.code === "INVALID_EMAIL") setError("Informe um e-mail válido.");
      else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convidar funcionário</DialogTitle>
          <DialogDescription>A pessoa recebe um e-mail para criar a senha e entra com o acesso da função escolhida.</DialogDescription>
        </DialogHeader>
        {inviteUrl ? (
          <>
            <Alert variant="soft">
              O envio de e-mail não está configurado neste ambiente. Copie o link do convite e envie para a pessoa:
              <code className="mt-2 block break-all rounded bg-surface p-2 text-xs">{inviteUrl}</code>
            </Alert>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={async () => {
                  await navigator.clipboard?.writeText(inviteUrl).catch(() => {});
                  setCopied(true);
                }}
              >
                <Copy className="h-4 w-4" /> {copied ? "Copiado" : "Copiar link"}
              </Button>
              <Button onClick={() => onOpenChange(false)}>Concluir</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <Field label="Nome" htmlFor="iname">
              <Input id="iname" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome completo" autoComplete="off" />
            </Field>
            <Field label="E-mail" htmlFor="iemail">
              <Input id="iemail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@empresa.com.br" autoComplete="off" />
            </Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium" id="role-label">
                Função
              </span>
              <div role="radiogroup" aria-labelledby="role-label" className="flex max-h-60 flex-col gap-1.5 overflow-y-auto">
                {options.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    role="radio"
                    aria-checked={roleId === r.id}
                    onClick={() => setRoleId(r.id)}
                    className={cn(
                      "flex flex-col items-start rounded-lg border px-3 py-2 text-left",
                      roleId === r.id ? "border-accent bg-accent/10 ring-1 ring-accent" : "border-transparent hover:bg-bg-2",
                    )}
                  >
                    <b className="text-sm">{r.name}</b>
                    {r.description && <span className="text-xs font-normal text-muted">{r.description}</span>}
                  </button>
                ))}
              </div>
            </div>
            {role?.requiresCrf && <Alert variant="soft">Esta função exige CRF. A pessoa informa o número ao aceitar o convite.</Alert>}
            {error && (
              <p role="alert" className="text-sm text-negative">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={busy || !email.trim() || !roleId}>
                {busy ? "Enviando…" : "Enviar convite"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
