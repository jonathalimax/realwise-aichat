"use client";

import { useEffect, useState } from "react";
import { maskBrPhone } from "@realwise/shared";
import { getPlatformConfig, updatePlatformConfig } from "../../lib/api";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";

// The stored number includes the country code (e.g. "5511999999999"); maskBrPhone only knows how
// to format the DDD+number part, so split off a leading "55" before masking and keep it as a
// fixed "+55" prefix rather than letting it get mistaken for the DDD.
function maskWithDdi(digits: string): string {
  const ddiStripped = digits.startsWith("55") ? digits.slice(2) : digits;
  return `+55 ${maskBrPhone(ddiStripped)}`.trim();
}

export default function AdminSettingsPage() {
  const [phone, setPhone] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getPlatformConfig().then((c) => setPhone(c.supportWhatsappNumber ?? ""));
  }, []);

  async function save() {
    try {
      setError("");
      const updated = await updatePlatformConfig(phone);
      setPhone(updated.supportWhatsappNumber ?? "");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar.");
    }
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <h1 className="font-serif text-2xl text-ink">Configurações</h1>

      <Card>
        <CardHeader>
          <CardTitle>Suporte RealWise</CardTitle>
          <CardDescription>
            Número de WhatsApp para onde o Assistente do Dono encaminha o cliente quando não consegue resolver algo
            sozinho — ex.: um pedido de suporte humano da RealWise.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div>
            <Label>Número de WhatsApp (com DDI e DDD)</Label>
            <Input
              value={phone ? maskWithDdi(phone) : ""}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, "");
                setPhone(digits.startsWith("55") ? digits : `55${digits}`);
              }}
              placeholder="+55 (11) 99999-9999"
              inputMode="numeric"
              className="mt-1"
            />
          </div>
          {error && <p className="text-sm text-negative">{error}</p>}
          <Button className="self-start" onClick={save}>
            {saved ? "Salvo!" : "Salvar"}
          </Button>
          {phone && (
            <Button
              className="self-start"
              variant="ghost"
              onClick={async () => {
                setPhone("");
                await updatePlatformConfig("");
              }}
            >
              Remover número
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
