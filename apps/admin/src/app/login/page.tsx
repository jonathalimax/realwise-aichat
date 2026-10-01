"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ConfirmationResult } from "firebase/auth";
import { createRecaptchaVerifier, sendPhoneOtp } from "../../lib/firebase";
import { verifyAdminFirebaseToken } from "../../lib/api";

export default function AdminLoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [error, setError] = useState("");

  async function handleSendCode() {
    try {
      setError("");
      const verifier = createRecaptchaVerifier("recaptcha-container");
      setConfirmation(await sendPhoneOtp(phone, verifier));
    } catch {
      setError("Não consegui enviar o código.");
    }
  }

  async function handleConfirmCode() {
    if (!confirmation) return;
    try {
      setError("");
      const credential = await confirmation.confirm(code);
      const idToken = await credential.user.getIdToken();
      await verifyAdminFirebaseToken(idToken);
      router.push("/");
    } catch {
      setError("Código inválido, ou este número não é um admin cadastrado.");
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-6">
      <h1 className="font-serif text-2xl text-ink">Acesso interno</h1>
      {!confirmation ? (
        <>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+55 11 99999-9999" className="rounded-xl border border-border bg-surface px-4 py-3 text-sm" />
          <button onClick={handleSendCode} className="rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white">Enviar código</button>
        </>
      ) : (
        <>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Código de 6 dígitos" className="rounded-xl border border-border bg-surface px-4 py-3 text-sm" />
          <button onClick={handleConfirmCode} className="rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white">Confirmar</button>
        </>
      )}
      {error && <p className="text-sm text-negative">{error}</p>}
      <div id="recaptcha-container" />
    </div>
  );
}
