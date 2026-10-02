"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ConfirmationResult } from "firebase/auth";
import { maskBrPhone, brPhoneToE164 } from "@realwise/shared";
import { createRecaptchaVerifier, sendPhoneOtp } from "../../lib/firebase";
import { verifyFirebaseToken } from "../../lib/api";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { Label } from "../../components/ui/label";

export default function LoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSendCode() {
    try {
      setError("");
      setLoading(true);
      const verifier = createRecaptchaVerifier("recaptcha-container");
      const result = await sendPhoneOtp(brPhoneToE164(phone), verifier);
      setConfirmation(result);
    } catch {
      setError("Não consegui enviar o código. Confira o número e tente de novo.");
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmCode() {
    if (!confirmation) return;
    try {
      setError("");
      setLoading(true);
      const credential = await confirmation.confirm(code);
      const idToken = await credential.user.getIdToken();
      const { business } = await verifyFirebaseToken(idToken);
      router.push(business.status === "onboarding" ? "/onboarding" : "/");
    } catch {
      setError("Código inválido ou expirado.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-ink lg:flex-row">
      {/* BRAND PANEL */}
      <div className="hidden lg:flex lg:w-1/2 lg:flex-col lg:justify-between bg-ink px-12 py-10 text-bg">
        <a href="/" className="font-serif text-xl font-bold text-bg">Realwise</a>
        <p className="max-w-sm font-serif text-2xl leading-[1.2] text-bg/80">
          Enquanto você dorme, <em className="italic text-lime">a Clara</em> responde.
        </p>
      </div>

      {/* FORM PANEL */}
      <div className="flex w-full flex-1 flex-col items-center justify-center px-6 py-10 sm:px-12 lg:w-1/2">
        <div className="w-full max-w-[380px]">
          <a href="/" className="mb-8 block font-serif text-lg font-bold text-ink lg:hidden">Realwise</a>
          <h2 className="font-serif text-3xl text-ink">Entrar na sua conta</h2>
          <p className="mt-2 text-sm text-ink-soft">Use o telefone cadastrado do seu negócio.</p>

          <div className="mt-8 flex flex-col gap-4">
            {!confirmation ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="phone">Telefone</Label>
                  <div className="flex items-center gap-2 rounded-lg border border-border bg-bg-2 px-3 py-2 focus-within:border-ink/40">
                    <span className="text-ink-soft">🇧🇷</span>
                    <input
                      id="phone"
                      value={phone}
                      onChange={(e) => setPhone(maskBrPhone(e.target.value))}
                      placeholder="(11) 99999-9999"
                      type="tel"
                      inputMode="numeric"
                      autoFocus
                      className="w-full bg-transparent text-base text-ink outline-none placeholder:text-ink-soft/60 md:text-sm"
                    />
                  </div>
                </div>
                <Button
                  onClick={handleSendCode}
                  disabled={loading || phone.replace(/\D/g, "").length < 10}
                  className="w-full"
                >
                  {loading ? "Enviando…" : "Enviar código"}
                </Button>
              </>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="code">Código de 6 dígitos</Label>
                  <Input
                    id="code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="000000"
                    type="tel"
                    inputMode="numeric"
                    autoFocus
                    className="tracking-[0.3em]"
                  />
                </div>
                <Button
                  onClick={handleConfirmCode}
                  disabled={loading || code.length < 6}
                  className="w-full"
                >
                  {loading ? "Confirmando…" : "Confirmar"}
                </Button>
              </>
            )}
            {error && <p className="text-sm text-negative">{error}</p>}
          </div>
          <div id="recaptcha-container" />
        </div>
      </div>
    </div>
  );
}
