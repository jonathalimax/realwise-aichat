"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { loginAdmin } from "../../lib/api";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { Label } from "../../components/ui/label";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    try {
      setError("");
      setLoading(true);
      await loginAdmin(email, password);
      router.push("/");
    } catch {
      setError("Email ou senha inválidos.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-ink lg:flex-row">
      {/* BRAND PANEL */}
      <div className="hidden lg:flex lg:w-1/2 lg:flex-col lg:justify-between bg-ink px-12 py-10 text-bg">
        <span className="font-serif text-xl font-bold text-bg">Realwise · Admin</span>
        <p className="max-w-sm font-serif text-2xl leading-[1.2] text-bg/80">
          Acesso <em className="italic text-[#0B4D38]">interno</em> à plataforma.
        </p>
      </div>

      {/* FORM PANEL */}
      <div className="flex w-full flex-1 flex-col items-center justify-center px-6 py-10 sm:px-12 lg:w-1/2">
        <div className="w-full max-w-[380px]">
          <span className="mb-8 block font-serif text-lg font-bold text-ink lg:hidden">Realwise · Admin</span>
          <h2 className="font-serif text-3xl text-ink">Acesso interno</h2>
          <p className="mt-2 text-sm text-ink-soft">Entre com o email e senha cadastrados como administrador.</p>

          <form
            className="mt-8 flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              handleLogin();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@realwise.com.br"
                type="email"
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                type="password"
              />
            </div>
            <Button type="submit" disabled={loading || !email || !password} className="w-full">
              {loading ? "Entrando…" : "Entrar"}
            </Button>
            {error && <p className="text-sm text-negative">{error}</p>}
          </form>
        </div>
      </div>
    </div>
  );
}
