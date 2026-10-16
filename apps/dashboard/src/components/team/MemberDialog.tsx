"use client";

import { useEffect, useState } from "react";
import {
  deleteMember,
  disableMember,
  enableMember,
  resendInvite,
  updateMember,
  type Member,
  type Role,
} from "../../lib/pharmacy-api";
import { ApiError } from "../../lib/api";
import { errorMessage } from "../../lib/use-load";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select } from "../ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Field } from "../page-kit";

const MESSAGES: Record<string, string> = {
  OWNER_PROTECTED: "Somente um proprietário altera outro proprietário ou concede essa função.",
  LAST_OWNER: "Precisa existir ao menos um proprietário ativo. Defina outro antes.",
  CANNOT_CHANGE_OWN_ROLE: "Você não pode alterar a sua própria função.",
  CRF_REQUIRED_FOR_ROLE: "Esta função exige o CRF do farmacêutico.",
  MEMBER_HAS_HISTORY: "Esta pessoa já tem histórico. Desative o acesso em vez de remover.",
};

/** "Alterar acesso": change role / CRF, disable or re-enable, resend or cancel an invite. */
export function MemberDialog({
  member,
  roles,
  isOwner,
  isSelf,
  onClose,
  onChanged,
}: {
  member: Member | null;
  roles: Role[];
  isOwner: boolean;
  isSelf: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [roleId, setRoleId] = useState("");
  const [crf, setCrf] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [confirming, setConfirming] = useState<"disable" | "delete" | null>(null);

  useEffect(() => {
    setRoleId(member?.role.id ?? "");
    setCrf(member?.crf ?? "");
    setError("");
    setInfo("");
    setConfirming(null);
  }, [member?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const options = roles.filter((r) => isOwner || r.key !== "owner" || r.id === member?.role.id);
  const selectedRole = roles.find((r) => r.id === roleId);
  const needsCrf = Boolean(selectedRole?.requiresCrf);

  async function run(key: string, fn: () => Promise<unknown>, done?: string, close = false) {
    setBusy(key);
    setError("");
    setInfo("");
    try {
      await fn();
      onChanged();
      if (close) onClose();
      else if (done) setInfo(done);
    } catch (e) {
      setError(e instanceof ApiError && e.code && MESSAGES[e.code] ? MESSAGES[e.code]! : errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  if (!member) return <Dialog open={false} onOpenChange={onClose} />;
  const changed = roleId !== member.role.id || (crf.trim() || null) !== (member.crf ?? null);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Alterar acesso de {member.name}</DialogTitle>
          <DialogDescription>{member.email}</DialogDescription>
        </DialogHeader>
        {isSelf && <Alert variant="soft">Você não pode alterar a sua própria função nem desativar o seu acesso.</Alert>}
        <Field label="Função" htmlFor="mrole">
          <Select id="mrole" value={roleId} disabled={isSelf} onChange={(e) => setRoleId(e.target.value)}>
            {options.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        {needsCrf && (
          <Field label="CRF do farmacêutico" htmlFor="mcrf" hint="Obrigatório para esta função.">
            <Input id="mcrf" value={crf} onChange={(e) => setCrf(e.target.value)} placeholder="CRF-PR 00000" />
          </Field>
        )}
        {confirming && (
          <Alert
            variant="amber"
            action={
              <span className="flex gap-2">
                <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => setConfirming(null)} autoFocus>
                  Voltar
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => run(confirming, () => (confirming === "disable" ? disableMember(member.id) : deleteMember(member.id)), undefined, true)}
                >
                  {confirming === "disable" ? "Sim, desativar" : "Sim, cancelar convite"}
                </Button>
              </span>
            }
          >
            {confirming === "disable" ? `Desativar o acesso de ${member.name}? A pessoa é desconectada na hora e só volta se você reativar.` : `Cancelar o convite de ${member.name}? O link enviado deixa de funcionar.`}
          </Alert>
        )}
        {error && <Alert variant="red">{error}</Alert>}
        {info && <Alert variant="soft">{info}</Alert>}
        <DialogFooter className="justify-between">
          <span className="flex flex-wrap gap-2">
            {member.status === "invited" && (
              <>
                <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => run("resend", () => resendInvite(member.id), "Convite reenviado.")}>
                  Reenviar convite
                </Button>
                <Button variant="destructive" size="sm" disabled={busy !== null} onClick={() => setConfirming("delete")}>
                  Cancelar convite
                </Button>
              </>
            )}
            {member.status === "active" && !isSelf && (
              <Button variant="destructive" size="sm" disabled={busy !== null} onClick={() => setConfirming("disable")}>
                Desativar acesso
              </Button>
            )}
            {member.status === "disabled" && (
              <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => run("enable", () => enableMember(member.id), undefined, true)}>
                Reativar acesso
              </Button>
            )}
          </span>
          <span className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Fechar
            </Button>
            <Button
              disabled={busy !== null || !changed || isSelf || (needsCrf && !crf.trim())}
              onClick={() => run("save", () => updateMember(member.id, { roleId: roleId !== member.role.id ? roleId : undefined, crf: crf.trim() || null }), undefined, true)}
            >
              {busy === "save" ? "Salvando…" : "Salvar"}
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
