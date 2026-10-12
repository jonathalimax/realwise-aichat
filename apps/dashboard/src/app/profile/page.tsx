"use client";

import { useEffect, useState } from "react";
import {
  getMe,
  updateBusiness,
  checkSlugAvailable,
  setBusinessSlug,
  addWhatsappNumber,
  updateWhatsappNumber,
  removeWhatsappNumber,
  getWhatsappNumbers,
} from "../../lib/api";
import { maskBrPhone } from "@realwise/shared";
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
  const [waError, setWaError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editPhone, setEditPhone] = useState("");
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

  function onlyDigits(phone: string) {
    return phone.replace(/\D/g, "");
  }

  async function handleAddWhatsapp() {
    const digits = onlyDigits(waPhone);
    if (digits.length < 10) {
      setWaError("Informe um número válido, com DDD (apenas números).");
      return;
    }
    setWaError("");
    await addWhatsappNumber(waLabel, digits);
    setWhatsappNumbers(await getWhatsappNumbers());
    setWaPhone("");
  }

  function startEdit(n: any) {
    setEditingId(n.id);
    setEditLabel(n.label);
    setEditPhone(maskBrPhone(n.phone));
  }

  async function saveEdit(id: string) {
    const digits = onlyDigits(editPhone);
    if (digits.length < 10) {
      setWaError("Informe um número válido, com DDD (apenas números).");
      return;
    }
    setWaError("");
    await updateWhatsappNumber(id, editLabel, digits);
    setEditingId(null);
    setWhatsappNumbers(await getWhatsappNumbers());
  }

  async function handleRemoveWhatsapp(id: string) {
    await removeWhatsappNumber(id);
    setWhatsappNumbers(await getWhatsappNumbers());
  }

  if (!business) return <p className="text-ink-soft">Carregando…</p>;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-2xl text-ink">Perfil do negócio</h1>
        <Badge variant={business.confidenceScore >= 70 ? "positive" : "warning"}>
          Prontidão: {business.confidenceScore}%
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sobre o negócio</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 pt-0">
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
        <CardContent className="flex flex-col gap-3 pt-0">
          <div className="flex flex-wrap gap-2">
            <Input value={waLabel} onChange={(e) => setWaLabel(e.target.value)} placeholder="Label" className="w-full sm:w-32" />
            <Input
              value={waPhone}
              onChange={(e) => setWaPhone(maskBrPhone(e.target.value))}
              placeholder="(11) 99999-9999"
              inputMode="numeric"
              className="flex-1"
            />
            <Button variant="outline" size="sm" onClick={handleAddWhatsapp}>Adicionar</Button>
          </div>
          {waError && <p className="text-xs text-negative">{waError}</p>}
          {whatsappNumbers.map((n) =>
            editingId === n.id ? (
              <div key={n.id} className="flex flex-wrap gap-2 rounded-lg border border-border bg-bg-2 px-3 py-2">
                <Input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} className="w-full sm:w-32" />
                <Input
                  value={editPhone}
                  onChange={(e) => setEditPhone(maskBrPhone(e.target.value))}
                  inputMode="numeric"
                  className="flex-1"
                />
                <Button size="sm" onClick={() => saveEdit(n.id)}>Salvar</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancelar</Button>
              </div>
            ) : (
              <div key={n.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-bg-2 px-3 py-2 text-sm">
                <span className="min-w-0 break-all">{n.label}: {n.phone}</span>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => startEdit(n)}>Editar</Button>
                  <Button size="sm" variant="ghost" onClick={() => handleRemoveWhatsapp(n.id)}>Excluir</Button>
                </div>
              </div>
            ),
          )}
        </CardContent>
      </Card>
    </div>
  );
}
