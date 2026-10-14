"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { ConfirmationResult } from "firebase/auth";
import { maskBrPhone, brPhoneToE164, getPlanDefinition, isPlanCode } from "@realwise/shared";
import { createRecaptchaVerifier, sendPhoneOtp } from "../../lib/firebase";
import { verifyFirebaseToken, ApiError } from "../../lib/api";
import { memberLogin, forgotPassword } from "../../lib/pharmacy-api";
import { homeFor } from "../../lib/nav";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { Label } from "../../components/ui/label";
import { Tabs } from "../../components/ui/segmented";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

// Each niche gets its own login look (persona, colours) on the same shared login. The niche comes from
// the link (?niche=farmacia); real estate stays the default so existing links look unchanged.
type LoginNiche = "imobiliaria" | "farmacia";
const LOGIN_THEMES: Record<LoginNiche, { brand: string; lead: string; persona: string; tail: string; panelClass: string; accent: string; defaultMode: "email" | null }> = {
  imobiliaria: { brand: "Realwise", lead: "Enquanto você dorme,", persona: "a Clara", tail: "responde.", panelClass: "bg-ink", accent: "#15803D", defaultMode: null },
  farmacia: { brand: "Realwise Farmácia", lead: "Enquanto você atende no balcão,", persona: "o Alex", tail: "cuida do chat.", panelClass: "bg-[#0B4F4A]", accent: "#F59E0B", defaultMode: "email" },
};

const WHATSAPP_URL = "https://wa.me/5585992265544?text=" + encodeURIComponent("Oi! Estou tentando entrar no painel da Realwise e deu erro.");

function isRateLimitError(err: unknown): boolean {
  const code = (err as { code?: string })?.code ?? "";
  const status = (err as { status?: number })?.status;
  return status === 429 || code === "auth/too-many-requests" || code === "auth/quota-exceeded";
}

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [error, setError] = useState("");
  const [rateLimited, setRateLimited] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  // "email" = team member (e-mail + senha); "phone" = existing owner flow (Firebase SMS code), untouched.
  const firebaseConfigured = Boolean(process.env.NEXT_PUBLIC_FIREBASE_API_KEY);
  const nicheParam = searchParams.get("niche");
  const niche: LoginNiche = nicheParam === "farmacia" ? "farmacia" : "imobiliaria";
  const theme = LOGIN_THEMES[niche];
  const [mode, setMode] = useState<"phone" | "email">(theme.defaultMode ?? (firebaseConfigured ? "phone" : "email"));

  useEffect(() => {
    try {
      const saved = localStorage.getItem("rw_login_mode");
      if (searchParams.get("mode") === "email" || theme.defaultMode === "email") setMode("email");
      else if (saved === "email" || (saved === "phone" && firebaseConfigured)) setMode(saved);
    } catch {
      /* private mode: keep default */
    }
  }, [searchParams, firebaseConfigured, theme]);

  function changeMode(next: "phone" | "email") {
    setMode(next);
    setError("");
    try {
      localStorage.setItem("rw_login_mode", next);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    const plan = searchParams.get("plan");
    if (isPlanCode(plan)) {
      localStorage.setItem("rw_selected_plan", plan);
      setSelectedPlan(plan);
    }
  }, [searchParams]);

  async function handleSendCode() {
    try {
      setError("");
      setRateLimited(false);
      setLoading(true);
      const verifier = createRecaptchaVerifier("recaptcha-container");
      const result = await sendPhoneOtp(brPhoneToE164(phone), verifier);
      setConfirmation(result);
    } catch (err) {
      if (isRateLimitError(err)) {
        setRateLimited(true);
        setError("Muitas tentativas agora. Espere alguns minutos ou fale com a gente no WhatsApp.");
      } else {
        setError("Não consegui enviar o código. Confira o número e tente de novo.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmCode() {
    if (!confirmation) return;
    try {
      setError("");
      setRateLimited(false);
      setLoading(true);
      const credential = await confirmation.confirm(code);
      const idToken = await credential.user.getIdToken();
      const { business } = await verifyFirebaseToken(idToken);
      const hasSelectedPlan = typeof window !== "undefined" && localStorage.getItem("rw_selected_plan");
      if (business.status === "onboarding") {
        router.push("/onboarding");
      } else if (hasSelectedPlan) {
        router.push("/billing");
      } else {
        router.push("/");
      }
    } catch (err) {
      if (isRateLimitError(err)) {
        setRateLimited(true);
        setError("Muitas tentativas agora. Espere alguns minutos ou fale com a gente no WhatsApp.");
      } else {
        setError("Código inválido ou expirado.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-ink lg:flex-row">
      {/* BRAND PANEL */}
      <div className={`hidden lg:flex lg:w-1/2 lg:flex-col lg:justify-between ${theme.panelClass} px-12 py-10 text-bg`}>
        <a href="/" className="font-serif text-xl font-bold text-bg">{theme.brand}</a>
        <p className="max-w-sm font-serif text-2xl leading-[1.2] text-bg/80">
          {theme.lead} <em className="italic" style={{ color: theme.accent }}>{theme.persona}</em> {theme.tail}
        </p>
      </div>

      {/* FORM PANEL */}
      <div className="flex w-full flex-1 flex-col items-center justify-center px-6 py-10 sm:px-12 lg:w-1/2">
        <div className="w-full max-w-[380px]">
          <a href="/" className="mb-8 block font-serif text-lg font-bold text-ink lg:hidden">{theme.brand}</a>
          <Tabs
            className="mb-6 w-full [&>button]:flex-1 [&>button]:justify-center"
            label="Forma de entrar"
            value={mode}
            onValueChange={changeMode}
            options={[
              { value: "email", label: "E-mail e senha" },
              { value: "phone", label: "Telefone" },
            ]}
          />
          {mode === "email" ? (
            <EmailLogin />
          ) : (
            <>
          <h2 className="font-serif text-3xl text-ink">Entre ou crie sua conta</h2>
          <p className="mt-2 text-sm text-ink-soft">
            Seu telefone é seu login. Se for sua primeira vez, a gente cria sua conta agora — sem cartão, 7 dias
            grátis.
          </p>
          {selectedPlan && (
            <p className="mt-3 rounded-lg bg-bg-2 px-3 py-2 text-sm text-ink-soft">
              Plano selecionado: <span className="font-semibold text-ink">{getPlanDefinition(selectedPlan)?.name ?? selectedPlan}</span>
            </p>
          )}

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
            {error && (
              <p className="text-sm text-negative">
                {error}
                {rateLimited && (
                  <>
                    {" "}
                    <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
                      Falar no WhatsApp
                    </a>
                  </>
                )}
              </p>
            )}
          </div>
            </>
          )}
          <div id="recaptcha-container" />
        </div>
      </div>
    </div>
  );
}


function EmailLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [businessSlug, setBusinessSlug] = useState("");
  const [choices, setChoices] = useState<{ slug: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [forgot, setForgot] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (forgot) {
        await forgotPassword(email.trim(), businessSlug || undefined);
        setForgotSent(true);
        return;
      }
      const me = await memberLogin(email.trim(), password, businessSlug || undefined);
      router.push(me.business.status === "onboarding" ? "/onboarding" : homeFor(me.business.niche, me));
    } catch (err) {
      if (err instanceof ApiError && err.code === "BUSINESS_AMBIGUOUS") {
        setChoices(err.body?.businesses ?? []);
        setError("Este e-mail existe em mais de um negócio. Escolha qual abrir.");
      } else if (err instanceof ApiError && err.status === 429) {
        setError("Muitas tentativas agora. Espere alguns minutos e tente de novo.");
      } else if (forgot) {
        setError("Não consegui enviar o link agora. Tente de novo em instantes.");
      } else {
        setError("E-mail ou senha incorretos.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <h2 className="font-serif text-3xl text-ink">{forgot ? "Redefinir senha" : "Entrar"}</h2>
        <p className="mt-2 text-sm text-ink-soft">
          {forgot ? "Enviaremos um link para criar uma nova senha." : "Use o e-mail do seu cadastro na equipe."}
        </p>
      </div>
      {forgotSent ? (
        <p className="rounded-lg bg-bg-2 px-3 py-3 text-sm text-ink-soft" role="status">
          Se este e-mail estiver cadastrado, você receberá um link para criar uma nova senha em alguns minutos.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@farmacia.com.br" autoFocus />
          </div>
          {!forgot && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Senha</Label>
                <button type="button" onClick={() => { setForgot(true); setError(""); }} className="text-xs font-semibold text-accent hover:underline">
                  Esqueci a senha
                </button>
              </div>
              <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          )}
          {choices.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="business">Negócio</Label>
              <select id="business" value={businessSlug} onChange={(e) => setBusinessSlug(e.target.value)} required className="h-9 rounded-lg border border-border bg-surface px-3 text-sm">
                <option value="">Escolha…</option>
                {choices.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <Button type="submit" disabled={loading || !email || (!forgot && !password)} className="w-full">
            {loading ? "Aguarde…" : forgot ? "Enviar link" : "Entrar"}
          </Button>
        </>
      )}
      {forgot && (
        <button type="button" onClick={() => { setForgot(false); setForgotSent(false); setError(""); }} className="text-sm text-ink-soft hover:underline">
          Voltar para o login
        </button>
      )}
      {error && (
        <p className="text-sm text-negative" role="alert">
          {error}
        </p>
      )}
      <p className="text-xs text-ink-soft">Recebeu um convite? Abra o link que chegou no seu e-mail para criar a sua conta.</p>
    </form>
  );
}
