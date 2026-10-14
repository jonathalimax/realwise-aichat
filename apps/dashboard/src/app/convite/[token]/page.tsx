"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { ApiError } from "../../../lib/api";
import { acceptInvite, getInvite, type InvitePreview } from "../../../lib/pharmacy-api";
import { homeFor } from "../../../lib/nav";
import { hexToTriplet, tint } from "../../../lib/color";
import { Card, CardContent } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Badge } from "../../../components/ui/badge";
import { Alert } from "../../../components/ui/alert";
import { Checkbox } from "../../../components/ui/checkbox";
import { Field } from "../../../components/page-kit";

export default function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "invalid">("loading");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [crf, setCrf] = useState("");
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getInvite(token)
      .then((i) => {
        setInvite(i);
        setName(i.name ?? "");
        setState("ready");
      })
      .catch(() => setState("invalid"));
  }, [token]);

  // the invite page is public: theme it with the invited business' brand colours
  const brand = invite?.business.branding;
  useEffect(() => {
    if (!brand) return;
    const root = document.documentElement;
    root.style.setProperty("--brand-primary", brand.primaryColor);
    root.style.setProperty("--brand-secondary", brand.secondaryColor);
    root.style.setProperty("--brand-soft", tint(brand.primaryColor, 0.12));
    root.style.setProperty("--accent", hexToTriplet(brand.primaryColor) ?? "15 118 110");
    return () => {
      root.style.removeProperty("--accent");
      root.style.removeProperty("--brand-primary");
      root.style.removeProperty("--brand-secondary");
      root.style.removeProperty("--brand-soft");
    };
  }, [brand]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!invite) return;
    setError("");
    if (password.length < 8) return setError("A senha precisa ter pelo menos 8 caracteres.");
    if (invite.role.requiresCrf && !crf.trim()) return setError("Informe o seu CRF para criar a conta.");
    setBusy(true);
    try {
      const me = await acceptInvite({ token, name: name.trim(), password, crf: crf.trim() || undefined, acceptTerms: true });
      router.push(homeFor(me.business.niche, me));
    } catch (err) {
      if (err instanceof ApiError && err.code === "CRF_REQUIRED_FOR_ROLE") setError("Esta função exige o CRF de farmacêutico.");
      else if (err instanceof ApiError && err.code === "WEAK_PASSWORD") setError("Escolha uma senha mais forte (mínimo 8 caracteres).");
      else setError(err instanceof Error ? err.message : "Não consegui criar a conta.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg p-8" data-ui="shadcn">
      <div className="flex w-full max-w-[460px] flex-col gap-5">
        <div className="flex items-center justify-center gap-2.5">
          {invite?.business.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={invite.business.logoUrl} alt="" className="h-9 w-9 rounded-[9px] object-cover" />
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-brand text-white" aria-hidden>
              <Plus className="h-5 w-5" strokeWidth={2.4} />
            </span>
          )}
          <b className="text-[17px] text-ink">{invite?.business.name ?? "Realwise"}</b>
        </div>
        <Card>
          <CardContent className="flex flex-col gap-4 p-7">
            {state === "loading" && <p className="text-sm text-muted">Carregando convite…</p>}
            {state === "invalid" && (
              <>
                <h1 className="text-[22px] font-bold tracking-tight text-ink">Convite indisponível</h1>
                <p className="text-sm text-muted">Este link expirou ou já foi usado. Peça um novo convite a quem cuida da equipe.</p>
              </>
            )}
            {state === "ready" && invite && (
              <form onSubmit={submit} className="flex flex-col gap-4">
                <div>
                  <h1 className="text-[22px] font-bold tracking-tight text-ink">Você foi convidado</h1>
                  <p className="text-sm text-muted">{invite.business.name} convidou você para entrar na equipe.</p>
                </div>
                <Alert variant="soft" action={<Badge variant="default">{invite.role.name}</Badge>}>
                  Sua função
                </Alert>
                {invite.role.description && <p className="text-[13px] text-muted">{invite.role.description}</p>}
                <Field label="Nome" htmlFor="n">
                  <Input id="n" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
                </Field>
                <Field label="E-mail" htmlFor="e">
                  <Input id="e" value={invite.email} disabled />
                </Field>
                {invite.role.requiresCrf && (
                  <Field label="CRF do farmacêutico" htmlFor="crf" hint="Obrigatório para esta função.">
                    <Input id="crf" value={crf} onChange={(e) => setCrf(e.target.value)} placeholder="CRF-PR 00000" required />
                  </Field>
                )}
                <Field label="Crie uma senha" htmlFor="p" hint="Mínimo de 8 caracteres.">
                  <Input id="p" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
                </Field>
                <label className="flex cursor-pointer items-start gap-2.5">
                  <Checkbox checked={terms} onCheckedChange={(v) => setTerms(v === true)} aria-label="Aceito os termos" className="mt-0.5" />
                  <span className="text-[13px]">Entendo que dados de saúde dos clientes são sensíveis e vou usá-los só para atender pedidos (LGPD).</span>
                </label>
                {error && (
                  <p role="alert" className="text-sm text-negative">
                    {error}
                  </p>
                )}
                <Button type="submit" size="lg" disabled={busy || !terms || !name.trim()}>
                  {busy ? "Criando…" : "Criar conta e entrar"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
