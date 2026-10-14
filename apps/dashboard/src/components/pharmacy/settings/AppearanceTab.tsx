"use client";

import { useRef, useState } from "react";
import { saveBranding, uploadLogo, getBranding, type BrandingDto } from "../../../lib/pharmacy-api";
import { useLoad, errorMessage } from "../../../lib/use-load";
import { useSession } from "../../../lib/session";
import { assetUrl } from "../../../lib/format";
import { API_BASE_URL } from "../../../lib/api";
import { readableOn } from "../../../lib/color";
import { Alert } from "../../ui/alert";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { SectionCard, LoadState } from "../../page-kit";
import { PHARMACY_DEFAULT_BRANDING, SALES_DEFAULT_BRANDING } from "@realwise/shared";

const HEX = /^#[0-9a-fA-F]{6}$/;

type Key = "primaryColor" | "secondaryColor" | "tertiaryColor";
const COLORS: { key: Key; name: string; use: string }[] = [
  { key: "primaryColor", name: "Primária", use: "Botões, cabeçalho do chat, menu ativo" },
  { key: "secondaryColor", name: "Secundária", use: "Mensagens do cliente, destaques escuros" },
  { key: "tertiaryColor", name: "Terciária", use: "Selos e realces" },
];

/** Brand colours + logo. Saved through PUT /businesses/me/branding and applied app-wide as CSS variables. */
export function AppearanceTab({ canEdit, quickChips }: { canEdit: boolean; quickChips?: string[] }) {
  const { refresh, niche, me } = useSession();
  const state = useLoad(() => getBranding(), []);
  const defaults = niche === "farmacia" ? PHARMACY_DEFAULT_BRANDING : SALES_DEFAULT_BRANDING;
  return (
    <LoadState state={state} section="farmacia" what="a aparência">
      {state.data && <Editor dto={state.data} defaults={defaults} canEdit={canEdit} refresh={refresh} businessName={me?.business.name ?? "Farmácia"} quickChips={quickChips} onSaved={(d) => state.setData(d)} />}
    </LoadState>
  );
}

function Editor({
  dto,
  defaults,
  canEdit,
  refresh,
  businessName,
  quickChips,
  onSaved,
}: {
  dto: BrandingDto;
  defaults: { primaryColor: string; secondaryColor: string; tertiaryColor: string };
  canEdit: boolean;
  refresh: () => Promise<void>;
  businessName: string;
  quickChips?: string[];
  onSaved: (d: BrandingDto) => void;
}) {
  const [colors, setColors] = useState<Record<Key, string>>({ primaryColor: dto.primaryColor, secondaryColor: dto.secondaryColor, tertiaryColor: dto.tertiaryColor });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const invalid = COLORS.some((c) => !HEX.test(colors[c.key]));
  const dirty = COLORS.some((c) => colors[c.key].toLowerCase() !== dto[c.key].toLowerCase());

  async function save(next: Record<Key, string | null>) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await saveBranding(next);
      onSaved(res);
      setColors({ primaryColor: res.primaryColor, secondaryColor: res.secondaryColor, tertiaryColor: res.tertiaryColor });
      await refresh(); // re-reads /auth/me so the whole dashboard re-themes
      setMsg({ kind: "ok", text: "Cores salvas. O painel já usa as novas cores." });
    } catch (e) {
      setMsg({ kind: "error", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  async function onLogo(file: File | undefined) {
    if (!file) return;
    if (file.size > 1024 * 1024) return setMsg({ kind: "error", text: "O logo precisa ter até 1 MB (PNG, JPG, WebP ou SVG)." });
    setBusy(true);
    setMsg(null);
    try {
      await uploadLogo(file);
      onSaved(await getBranding());
      await refresh();
      setMsg({ kind: "ok", text: "Logo atualizado." });
    } catch (e) {
      setMsg({ kind: "error", text: errorMessage(e, "Não consegui enviar o logo.") });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const p1 = HEX.test(colors.primaryColor) ? colors.primaryColor : defaults.primaryColor;
  const p2 = HEX.test(colors.secondaryColor) ? colors.secondaryColor : defaults.secondaryColor;
  const p3 = HEX.test(colors.tertiaryColor) ? colors.tertiaryColor : defaults.tertiaryColor;
  const logo = assetUrl(dto.logoUrl, API_BASE_URL);
  const chips = quickChips?.length ? quickChips : ["Fazer um pedido", "Falar com o farmacêutico", "Horários e entrega"];

  return (
    <div className="flex flex-wrap items-start gap-4">
      <SectionCard
        className="min-w-0 flex-[1_1_340px]"
        title="Aparência"
        description={`Cores do chat, da página de acompanhamento e deste painel. Sem cores definidas, usa o padrão.`}
      >
        <div className="flex flex-col gap-3.5">
          {COLORS.map((c) => (
            <div key={c.key} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <b>{c.name}</b>
                <div className="text-xs text-muted">{c.use}</div>
              </div>
              <div className="flex flex-none items-center gap-2">
                <Input
                  aria-label={`${c.name} (código hexadecimal)`}
                  value={colors[c.key]}
                  disabled={!canEdit}
                  maxLength={7}
                  onChange={(e) => setColors({ ...colors, [c.key]: e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}` })}
                  className="h-9 w-[92px] font-mono text-xs"
                  aria-invalid={!HEX.test(colors[c.key])}
                />
                <input
                  type="color"
                  aria-label={c.name}
                  value={HEX.test(colors[c.key]) ? colors[c.key] : defaults[c.key]}
                  disabled={!canEdit}
                  onChange={(e) => setColors({ ...colors, [c.key]: e.target.value })}
                  className="h-9 w-10 cursor-pointer rounded-lg border border-border bg-surface p-0.5 disabled:cursor-not-allowed"
                />
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <b>Logo</b>
              {logo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo} alt="Logo atual" className="h-9 w-9 rounded-lg border border-border object-cover" />
              )}
            </div>
            {canEdit && (
              <>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="sr-only" id="logo-file" onChange={(e) => onLogo(e.target.files?.[0])} />
                <Button variant="outline" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
                  {logo ? "Trocar imagem" : "Enviar imagem"}
                </Button>
              </>
            )}
          </div>
          {invalid && <Alert variant="amber">Use cores no formato #RRGGBB, por exemplo #0F766E.</Alert>}
          {msg && <Alert variant={msg.kind === "ok" ? "soft" : "red"}>{msg.text}</Alert>}
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy || invalid || !dirty} onClick={() => save(colors)}>
                {busy ? "Salvando…" : "Salvar cores"}
              </Button>
              <Button
                variant="ghost"
                disabled={busy || !dto.isCustom}
                onClick={() => save({ primaryColor: null, secondaryColor: null, tertiaryColor: null })}
              >
                Restaurar padrão
              </Button>
            </div>
          )}
        </div>
      </SectionCard>

      <SectionCard className="min-w-0 flex-[1_1_340px]" title="Pré-visualização do chat">
        <div className="overflow-hidden rounded-[14px] border border-border">
          <div className="flex items-center gap-2.5 p-3.5" style={{ background: p1, color: readableOn(p1) }}>
            <span className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-full bg-white text-xs font-semibold text-zinc-900">A</span>
            <div>
              <b>Alex</b>{" "}
              <span className="inline-flex h-[18px] items-center rounded-full px-2 text-xs font-semibold" style={{ background: p3, color: readableOn(p3) }}>
                IA
              </span>
              <div className="text-xs opacity-90">{businessName}</div>
            </div>
          </div>
          <div className="flex flex-col gap-2.5 bg-bg p-3.5">
            <div className="max-w-[85%] rounded-xl border border-border bg-surface px-3 py-2.5 text-[13px]">
              Oi! Sou o Alex, assistente virtual com inteligência artificial. Posso montar seu pedido ou chamar o farmacêutico.
            </div>
            <div className="self-end rounded-xl px-3 py-2.5 text-[13px]" style={{ background: p2, color: readableOn(p2) }}>
              Quero dipirona
            </div>
            <div className="flex flex-wrap gap-2">
              {chips.slice(0, 3).map((c) => (
                <span key={c} className="inline-flex h-9 items-center rounded-lg px-3.5 text-sm font-medium" style={{ background: p1, color: readableOn(p1) }}>
                  {c}
                </span>
              ))}
            </div>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted">
          {dto.isCustom ? <Badge variant="soft">Cores personalizadas</Badge> : <Badge variant="outline">Cores padrão</Badge>}
        </p>
      </SectionCard>
    </div>
  );
}
