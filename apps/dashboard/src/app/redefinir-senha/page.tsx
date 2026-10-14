"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { resetPassword } from "../../lib/pharmacy-api";
import { homeFor } from "../../lib/nav";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Field } from "../../components/page-kit";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordInner />
    </Suspense>
  );
}

function ResetPasswordInner() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 8) return setError("A senha precisa ter pelo menos 8 caracteres.");
    if (password !== confirm) return setError("As senhas não são iguais.");
    setBusy(true);
    try {
      const me = await resetPassword(token, password);
      router.push(homeFor(me.business.niche, me));
    } catch {
      setError("Este link expirou ou já foi usado. Peça um novo em “Esqueci a senha”.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg p-8" data-ui="shadcn">
      <Card className="w-full max-w-[420px]">
        <CardContent className="p-7">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div>
              <h1 className="text-[22px] font-bold tracking-tight text-ink">Criar nova senha</h1>
              <p className="text-sm text-muted">Escolha uma senha com pelo menos 8 caracteres.</p>
            </div>
            {!token ? (
              <p className="text-sm text-negative">Link inválido. Peça um novo em “Esqueci a senha” na tela de login.</p>
            ) : (
              <>
                <Field label="Nova senha" htmlFor="pw">
                  <Input id="pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                </Field>
                <Field label="Repita a senha" htmlFor="pw2">
                  <Input id="pw2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
                </Field>
                {error && (
                  <p role="alert" className="text-sm text-negative">
                    {error}
                  </p>
                )}
                <Button type="submit" size="lg" disabled={busy}>
                  {busy ? "Salvando…" : "Salvar e entrar"}
                </Button>
              </>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
