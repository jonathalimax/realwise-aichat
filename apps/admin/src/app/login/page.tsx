"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ConfirmationResult } from "firebase/auth";
import { maskBrPhone, brPhoneToE164 } from "@realwise/shared";
import { createRecaptchaVerifier, sendPhoneOtp } from "../../lib/firebase";
import { verifyAdminFirebaseToken } from "../../lib/api";

export default function AdminLoginPage() {
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
      setConfirmation(await sendPhoneOtp(brPhoneToE164(phone), verifier));
    } catch {
      setError("Não consegui enviar o código.");
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
      await verifyAdminFirebaseToken(idToken);
      router.push("/");
    } catch {
      setError("Código inválido, ou este número não é um admin cadastrado.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-ink md:flex-row">
      {/* VISUAL PANEL */}
      <div className="relative flex w-full flex-col justify-between overflow-hidden bg-ink px-6 py-8 text-bg sm:px-12 sm:py-10 md:w-[46%]">
        <div
          className="pointer-events-none absolute inset-0 opacity-20"
          style={{ backgroundImage: "radial-gradient(circle at 25% 25%, #D7F26B 0, transparent 45%), radial-gradient(circle at 75% 75%, #5FBE94 0, transparent 40%)" }}
        />
        <span className="relative font-serif text-xl font-bold text-bg">Realwise · Admin</span>

        <div className="relative max-w-sm py-8 md:py-0">
          <h1 className="font-serif text-3xl leading-[1.15] text-bg sm:text-4xl">
            Acesso <em className="italic text-lime">interno</em>.
          </h1>
          <p className="mt-4 text-sm text-bg/70">
            Gerencie tenants, acompanhe a saúde da plataforma e a confiança do conhecimento de cada negócio.
          </p>

          <div className="mt-8 flex flex-col gap-2">
            {["Tenants e confiança do onboarding", "Conversas e leads em tempo real", "Configuração de modelo e infraestrutura"].map((t) => (
              <div key={t} className="flex items-center gap-2 rounded-xl border border-bg/15 bg-bg/5 px-3 py-2 text-xs text-bg/80">
                <span className="h-1.5 w-1.5 rounded-full bg-lime" /> {t}
              </div>
            ))}
          </div>
        </div>

        <p className="relative hidden text-xs text-bg/50 sm:block">Acesso restrito a números cadastrados como admin.</p>
      </div>

      {/* FORM PANEL */}
      <div className="flex w-full flex-1 flex-col justify-center px-6 py-10 sm:px-12 md:w-[54%] md:px-16 md:py-16">
        <div className="mx-auto w-full max-w-sm">
          <h2 className="font-serif text-3xl text-ink">Acesso interno</h2>
          <p className="mt-2 text-sm text-ink-soft">Use o telefone cadastrado como administrador.</p>

          <div className="mt-8 flex flex-col gap-4">
            {!confirmation ? (
              <>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Telefone</span>
                  <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-3 text-sm focus-within:border-ink/40">
                    <span className="text-ink-soft">🇧🇷</span>
                    <input
                      value={phone}
                      onChange={(e) => setPhone(maskBrPhone(e.target.value))}
                      placeholder="(11) 99999-9999"
                      type="tel"
                      inputMode="numeric"
                      autoFocus
                      className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-soft/60"
                    />
                  </div>
                </label>
                <button
                  onClick={handleSendCode}
                  disabled={loading || phone.replace(/\D/g, "").length < 10}
                  className="rounded-full bg-ink px-5 py-3 text-sm font-semibold text-lime transition-all duration-200 hover:-translate-y-0.5 hover:opacity-90 disabled:opacity-40 disabled:hover:translate-y-0"
                >
                  {loading ? "Enviando…" : "Enviar código"}
                </button>
              </>
            ) : (
              <>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Código de 6 dígitos</span>
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="000000"
                    type="tel"
                    inputMode="numeric"
                    autoFocus
                    className="rounded-xl border border-border bg-surface px-4 py-3 text-sm tracking-[0.3em] text-ink outline-none focus:border-ink/40"
                  />
                </label>
                <button
                  onClick={handleConfirmCode}
                  disabled={loading || code.length < 6}
                  className="rounded-full bg-ink px-5 py-3 text-sm font-semibold text-lime transition-all duration-200 hover:-translate-y-0.5 hover:opacity-90 disabled:opacity-40 disabled:hover:translate-y-0"
                >
                  {loading ? "Confirmando…" : "Confirmar"}
                </button>
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
