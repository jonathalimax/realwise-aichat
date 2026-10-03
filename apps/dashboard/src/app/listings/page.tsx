"use client";

import { useEffect, useState } from "react";
import { getMe, getListings, getDocuments, updateListing, deleteListing, reextractListings } from "../../lib/api";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Input } from "../../components/ui/input";
import { Pencil } from "lucide-react";

function statusBadgeVariant(status: string) {
  switch (status) {
    case "active":
      return "positive" as const;
    case "sold":
    case "rented":
      return "neutral" as const;
    default:
      return "warning" as const;
  }
}

function statusLabel(status: string) {
  switch (status) {
    case "active":
      return "Ativo";
    case "sold":
      return "Vendido";
    case "rented":
      return "Alugado";
    case "inactive":
      return "Inativo";
    default:
      return status;
  }
}

export default function ListingsPage() {
  const [business, setBusiness] = useState<any>(null);
  const [documents, setDocuments] = useState<any[]>([]);
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editStatus, setEditStatus] = useState("active");
  const [extracting, setExtracting] = useState(false);

  async function refresh() {
    setLoading(true);
    const [b, docs, l] = await Promise.all([getMe(), getDocuments().catch(() => []), getListings().catch(() => [])]);
    setBusiness(b);
    setDocuments(docs);
    setListings(l);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  function startEdit(listing: any) {
    setEditingId(listing.id);
    setEditTitle(listing.title ?? "");
    setEditPrice(listing.priceText ?? "");
    setEditStatus(listing.status ?? "active");
  }

  async function saveEdit() {
    if (!editingId) return;
    await updateListing(editingId, { title: editTitle, priceText: editPrice, status: editStatus });
    setEditingId(null);
    refresh();
  }

  async function handleDelete(id: string) {
    await deleteListing(id);
    refresh();
  }

  async function handleReextract() {
    setExtracting(true);
    try {
      await reextractListings();
      await refresh();
    } finally {
      setExtracting(false);
    }
  }

  if (loading || !business) return <p className="text-ink-soft">Carregando…</p>;

  const isStudio = business.subscription?.plan?.code === "studio";

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-2xl text-ink">Anúncios</h1>
        <Button variant="outline" size="sm" disabled={extracting || !isStudio} onClick={handleReextract}>
          {extracting ? "Extraindo… isso pode levar alguns minutos" : "Reextrair anúncios"}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Inventário</CardTitle>
          <CardDescription>
            Anúncios extraídos automaticamente dos seus documentos (disponível no plano Studio). Edições feitas aqui não
            são sobrescritas por uma nova extração.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!isStudio && (
            <p className="rounded-lg border border-border bg-bg-2 px-4 py-3 text-sm text-ink-soft">
              A extração automática de anúncios está disponível no plano Studio.{" "}
              <a href="/billing" className="font-semibold text-accent">Ver planos</a>
            </p>
          )}

          {listings.length === 0 && (
            <p className="rounded-lg border border-border bg-bg-2 px-4 py-3 text-sm text-ink-soft">
              Nenhum anúncio encontrado ainda. Anúncios são extraídos automaticamente dos seus documentos (disponível no
              plano Studio).{" "}
              {documents.length === 0 ? (
                <>
                  Nenhum documento enviado ainda —{" "}
                  <a href="/knowledge" className="font-semibold text-accent">adicione documentos</a> para começar.
                </>
              ) : null}
            </p>
          )}

          {listings.map((listing) => {
            const overridden = listing.overriddenFields ?? {};
            const isEditing = editingId === listing.id;
            return (
              <div key={listing.id} className="flex flex-col gap-2 rounded-lg border border-border bg-bg-2 p-3 sm:flex-row sm:items-center sm:gap-4">
                <div className="h-16 w-16 flex-none overflow-hidden rounded-lg bg-surface">
                  {listing.images?.[0]?.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={listing.images[0].url} alt={listing.title} className="h-full w-full object-cover" />
                  ) : null}
                </div>

                <div className="flex-1">
                  <div className="text-xs text-ink-soft">{listing.referenceCode}</div>
                  {isEditing ? (
                    <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="mt-1" />
                  ) : (
                    <div className="flex items-center gap-1 text-sm font-medium text-ink">
                      {listing.title}
                      {overridden.title && <Pencil className="h-3 w-3 text-ink-soft" />}
                    </div>
                  )}
                  <div className="text-xs text-ink-soft">
                    {[listing.neighborhood, listing.city].filter(Boolean).join(", ") || "—"}
                  </div>
                </div>

                <div className="flex-none">
                  {isEditing ? (
                    <Input value={editPrice} onChange={(e) => setEditPrice(e.target.value)} className="w-32" />
                  ) : (
                    <div className="flex items-center gap-1 text-sm text-ink">
                      {listing.priceText ?? "—"}
                      {overridden.priceText && <Pencil className="h-3 w-3 text-ink-soft" />}
                    </div>
                  )}
                </div>

                <div className="flex-none">
                  {isEditing ? (
                    <select
                      value={editStatus}
                      onChange={(e) => setEditStatus(e.target.value)}
                      className="rounded-lg border border-border bg-bg px-2 py-1 text-sm"
                    >
                      <option value="active">Ativo</option>
                      <option value="inactive">Inativo</option>
                      <option value="sold">Vendido</option>
                      <option value="rented">Alugado</option>
                    </select>
                  ) : (
                    <Badge variant={statusBadgeVariant(listing.status)}>{statusLabel(listing.status)}</Badge>
                  )}
                </div>

                <div className="flex flex-none gap-2">
                  {isEditing ? (
                    <>
                      <Button size="sm" onClick={saveEdit}>Salvar</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancelar</Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" variant="outline" onClick={() => startEdit(listing)}>Editar</Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDelete(listing.id)}>Remover</Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
