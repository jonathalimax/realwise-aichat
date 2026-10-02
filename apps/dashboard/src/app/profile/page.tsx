"use client";

import { useEffect, useState } from "react";
import {
  getMe,
  updateBusiness,
  checkSlugAvailable,
  setBusinessSlug,
  addWhatsappNumber,
  getWhatsappNumbers,
} from "../../lib/api";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Input } from "../../components/ui/input";

export default function ProfilePage() {
  const [business, setBusiness] = useState<any>(null);
  const [slug, setSlug] = useState("");
  const [slugStatus, setSlugStatus] = useState<"idle" | "available" | "taken">("idle");
  const [whatsappNumbers, setWhatsappNumbers] = useState<any[]>([]);
  const [waLabel, setWaLabel] = useState("Principal");
  const [waPhone, setWaPhone] = useState("");
  const [savedInfo, setSavedInfo] = useState(false);

  async function refresh() {
    const b = await getMe();
    setBusiness(b);
    setSlug(b.slug?.startsWith("pending-") ? "" : b.slug);
    setWhatsappNumbers(await getWhatsappNumbers());
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleCheckSlug() {
    setSlugStatus((await checkSlugAvailable(slug)) ? "available" : "taken");
  }

  async function saveBusinessInfo() {
    await updateBusiness({ name: business.name, ownerName: business.ownerName, email: business.email, niche: business.niche });
    if (slug && slug !== business.slug && slugStatus === "available") await setBusinessSlug(slug);
    setSavedInfo(true);
    setTimeout(() => setSavedInfo(false), 2000);
    refresh();
  }

  async function handleAddWhatsapp() {
    if (!waPhone) return;
    await addWhatsappNumber(waLabel, waPhone);
    setWhatsappNumbers(await getWhatsappNumbers());
    setWaPhone("");
  }

  if (!business) return <p className="text-ink-soft">Carregando…</p>;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-2xl text-ink">Perfil do negócio</h1>
        <Badge variant={business.confidenceScore >= 70 ? "positive" : "warning"}>
          Prontidão: {business.confidenceScore}%
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sobre o negócio</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Input
            value={business.name}
            onChange={(e) => setBusiness({ ...business, name: e.target.value })}
            placeholder="Nome do negócio"
          />
          <Input
            value={business.ownerName}
            onChange={(e) => setBusiness({ ...business, ownerName: e.target.value })}
            placeholder="Seu nome"
          />
          <Input
            value={business.email ?? ""}
            onChange={(e) => setBusiness({ ...business, email: e.target.value })}
            placeholder="Seu e-mail"
            type="email"
          />
          <div className="flex gap-2">
            <Input
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugStatus("idle");
              }}
              placeholder="seu-link"
            />
            <Button variant="outline" size="sm" onClick={handleCheckSlug}>Verificar</Button>
          </div>
          {slugStatus === "available" && <p className="text-xs text-positive">Disponível!</p>}
          {slugStatus === "taken" && <p className="text-xs text-negative">Já em uso.</p>}
          <Button className="self-start" onClick={saveBusinessInfo}>{savedInfo ? "Salvo!" : "Salvar"}</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>WhatsApp para escalonamento</CardTitle>
          <CardDescription>Necessário para o chat conseguir passar um cliente para um atendente humano.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Input value={waLabel} onChange={(e) => setWaLabel(e.target.value)} placeholder="Label" className="w-32" />
            <Input value={waPhone} onChange={(e) => setWaPhone(e.target.value)} placeholder="(11) 99999-9999" className="flex-1" />
            <Button variant="outline" size="sm" onClick={handleAddWhatsapp}>Adicionar</Button>
          </div>
          {whatsappNumbers.map((n) => (
            <div key={n.id} className="rounded-lg border border-border bg-bg-2 px-3 py-2 text-sm">{n.label}: {n.phone}</div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
