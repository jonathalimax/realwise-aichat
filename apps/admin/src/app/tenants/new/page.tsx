"use client";

import { useState } from "react";
import Link from "next/link";
import { createBusiness, type CreateBusinessInput } from "../../../lib/api";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";

const NICHES: { value: CreateBusinessInput["niche"]; label: string }[] = [
  { value: "farmacia", label: "Farmácia" },
  { value: "imobiliaria", label: "Imobiliária" },
  { value: "concessionaria", label: "Concessionária" },
];

export default function NewTenantPage() {
  const [niche, setNiche] = useState<CreateBusinessInput["niche"]>("farmacia");
  const [businessName, setBusinessName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [trialDays, setTrialDays] = useState("7");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ id: string; email: string; url?: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const days = Number(trialDays);
      const res = await createBusiness({ niche, businessName: businessName.trim(), ownerName: ownerName.trim(), email: email.trim(), trialDays: Number.isFinite(days) ? days : undefined });
      setDone({ id: res.business.id, email: email.trim(), url: res.inviteUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não consegui criar o cliente.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Convite enviado</CardTitle>
            <CardDescription>{done.url ? "O e-mail não está configurado neste ambiente. Envie este link ao proprietário." : `Enviamos um e-mail para ${done.email} com o link para criar a senha. O link vale por 7 dias.`}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {done.url && <Input readOnly value={done.url} onFocus={(e) => e.currentTarget.select()} />}
            <div className="flex gap-2">
              <Link href={`/tenants/${done.id}`}><Button size="sm">Abrir cliente</Button></Link>
              <Link href="/"><Button size="sm" variant="outline">Voltar</Button></Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Novo cliente</CardTitle>
          <CardDescription>O proprietário recebe um e-mail com um link para criar a senha e começar a configuração. Sem SMS.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Tipo de negócio</Label>
              <div className="flex gap-2">
                {NICHES.map((n) => (
                  <Button key={n.value} type="button" size="sm" variant={niche === n.value ? "default" : "outline"} onClick={() => setNiche(n.value)}>
                    {n.label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="businessName">Nome do negócio</Label>
              <Input id="businessName" required value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Farmácia Exemplo" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ownerName">Nome do responsável</Label>
              <Input id="ownerName" required value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">E-mail do responsável</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="dono@empresa.com.br" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="trial">Dias de teste</Label>
              <Input id="trial" type="number" min={0} max={90} value={trialDays} onChange={(e) => setTrialDays(e.target.value)} />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>{busy ? "Criando…" : "Criar e enviar convite"}</Button>
              <Link href="/"><Button type="button" variant="outline">Cancelar</Button></Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
