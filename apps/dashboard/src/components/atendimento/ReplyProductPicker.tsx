"use client";

import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { ProductThumb } from "../pharmacy/ProductThumb";
import { searchSuggestableProducts, type SuggestionItem } from "../../lib/pharmacy-api";
import { errorMessage } from "../../lib/use-load";
import { formatBRL } from "../../lib/format";

export const MAX_SUGGESTED = 6;

function label(p: Pick<SuggestionItem, "name" | "presentation">) {
  return p.presentation ? `${p.name} · ${p.presentation}` : p.name;
}

const thumb = (p: SuggestionItem) => ({ imageUrl: p.imageUrl, placeholderIcon: p.placeholderIcon, saleClass: p.requiresPrescription ? ("prescription" as const) : ("otc" as const), name: p.name });

/**
 * Product picker for the pharmacist reply: search the catalog (only products the API says are listable), pick up to 6.
 * "Usar sugestão do Alex" chips only PRE-FILL the picker; nothing is sent until the pharmacist presses the send button.
 */
export function ReplyProductPicker({
  selected,
  onChange,
  alexSuggestions,
  disabled,
}: {
  selected: SuggestionItem[];
  onChange: (items: SuggestionItem[]) => void;
  /** Pharmacist-only suggestion of the brief (product ids). Shown as one-tap chips. */
  alexSuggestions: { productId: string; name: string }[];
  disabled?: boolean;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SuggestionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const full = selected.length >= MAX_SUGGESTED;
  const picked = new Set(selected.map((s) => s.productId));

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      setError("");
      return;
    }
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      searchSuggestableProducts({ q: term })
        .then((r) => alive && (setResults(r.items), setError("")))
        .catch((e) => alive && setError(errorMessage(e)))
        .finally(() => alive && setLoading(false));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  const add = (p: SuggestionItem) => !full && !picked.has(p.productId) && onChange([...selected, p]);
  const remove = (id: string) => onChange(selected.filter((s) => s.productId !== id));

  async function useAlex() {
    setError("");
    try {
      const ids = alexSuggestions.map((s) => s.productId).filter((id) => !picked.has(id));
      const { items } = await searchSuggestableProducts({ ids });
      onChange([...selected, ...items].slice(0, MAX_SUGGESTED));
      if (items.length < ids.length) setError("Alguns produtos sugeridos não podem mais ser indicados (sem estoque ou sem classificação confirmada).");
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">Indicar produtos ({selected.length}/{MAX_SUGGESTED})</span>
        {alexSuggestions.length > 0 && (
          <Button type="button" variant="outline" size="sm" disabled={disabled || full} onClick={() => void useAlex()} title="Só preenche a lista. Nada é enviado até você clicar em enviar.">
            Usar sugestão do Alex: {alexSuggestions.map((s) => s.name).join(", ")}
          </Button>
        )}
      </div>
      {selected.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label="Produtos escolhidos">
          {selected.map((p) => (
            <li key={p.productId} className="flex items-center gap-2.5 rounded-lg border border-border bg-bg-2 p-2">
              <ProductThumb product={thumb(p)} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{label(p)}</span>
                <span className="text-xs text-muted">{formatBRL(p.priceCents)}{p.requiresPrescription ? " · exige receita" : ""}</span>
              </span>
              <button type="button" onClick={() => remove(p.productId)} disabled={disabled} aria-label={`Remover ${p.name}`} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-ink max-md:h-11 max-md:w-11">
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} disabled={disabled || full} placeholder={full ? "Limite de 6 produtos" : "Buscar no catálogo por nome ou princípio ativo"} aria-label="Buscar produto" />
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      {q.trim().length >= 2 && !full && (
        <ul className="flex max-h-56 flex-col overflow-auto rounded-lg border border-border" aria-label="Resultados da busca">
          {loading && results.length === 0 && <li className="p-3 text-sm text-muted">Buscando…</li>}
          {!loading && results.length === 0 && !error && <li className="p-3 text-sm text-muted">Nenhum produto disponível com esse nome. Só aparecem itens em estoque com classe confirmada (livre ou com receita).</li>}
          {results.map((p) => (
            <li key={p.productId} className="border-b border-border last:border-b-0">
              <button type="button" disabled={picked.has(p.productId)} onClick={() => add(p)} className="flex w-full items-center gap-2.5 p-2 text-left hover:bg-bg-2 disabled:opacity-50 max-md:min-h-11">
                <ProductThumb product={thumb(p)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{label(p)}</span>
                  <span className="text-xs text-muted">{formatBRL(p.priceCents)}{p.requiresPrescription ? " · exige receita" : ""}</span>
                </span>
                {picked.has(p.productId) ? <span className="text-xs text-muted">Adicionado</span> : <Plus className="h-4 w-4 text-accent" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
