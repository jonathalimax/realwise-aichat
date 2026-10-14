"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../lib/api";
import {
  deleteProductImage,
  getProduct,
  setProductClass,
  updateProduct,
  uploadProductImage,
  type Product,
  type ProductPatch,
  type SaleClass,
} from "../../lib/pharmacy-api";
import { CLASS_LABELS } from "../../lib/labels";
import { centsToInput, formatBRL, parseBRLToCents, timeAgo } from "../../lib/format";
import { errorMessage, useLoad } from "../../lib/use-load";
import { useSession } from "../../lib/session";
import { Alert } from "../ui/alert";
import { Badge, toneVariant } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select } from "../ui/select";
import { Switch } from "../ui/switch";
import { Skeleton } from "../ui/skeleton";
import { SidePanel } from "../ui/side-panel";
import { ErrorState, Field } from "../page-kit";
import { ProductThumb } from "./ProductThumb";

const CLASS_OPTIONS: SaleClass[] = ["otc", "prescription", "controlled", "unclassified"];

export function ProductSheet({ productId, onClose, onChanged }: { productId: string | null; onClose: () => void; onChanged: () => void }) {
  const { me, can } = useSession();
  const state = useLoad<Product | null>(() => (productId ? getProduct(productId) : Promise.resolve(null)), [productId]);
  const product = productId && state.data?.id === productId ? state.data : null;
  const canEdit = can("catalogo", "edit");
  const canClass = can("classes", "edit") && Boolean(me?.canPerformPharmacistActions);

  const [form, setForm] = useState({ name: "", price: "", stock: "", max: "", group: "", required: false, saleClass: "unclassified" as SaleClass });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!product) return;
    setForm({
      name: product.name,
      price: centsToInput(product.priceCents),
      stock: String(product.stockQty),
      max: product.maxQtyPerOrder == null ? "" : String(product.maxQtyPerOrder),
      group: product.equivalentGroup ?? "",
      required: product.pharmacistRequired,
      saleClass: product.saleClass,
    });
    setError("");
    setSaved(false);
  }, [product?.id, product?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!product) return;
    setError("");
    const cents = parseBRLToCents(form.price);
    if (!form.name.trim()) return setError("Informe o nome do produto.");
    if (cents === null) return setError("Informe um preço válido, por exemplo 8,90.");
    const stock = Number(form.stock);
    if (!Number.isInteger(stock) || stock < 0) return setError("O estoque precisa ser um número inteiro, 0 ou mais.");
    const max = form.max.trim() === "" ? null : Number(form.max);
    if (max !== null && (!Number.isInteger(max) || max < 0)) return setError("A quantidade máxima precisa ser um número inteiro.");

    const patch: ProductPatch = {};
    if (form.name.trim() !== product.name) patch.name = form.name.trim();
    if (cents !== product.priceCents) patch.priceCents = cents;
    if (stock !== product.stockQty) patch.stockQty = stock;
    if (max !== product.maxQtyPerOrder) patch.maxQtyPerOrder = max;
    if ((form.group.trim() || null) !== product.equivalentGroup) patch.equivalentGroup = form.group.trim() || null;
    if (form.required !== product.pharmacistRequired) patch.pharmacistRequired = form.required;

    setBusy(true);
    try {
      let updated = product;
      if (Object.keys(patch).length) updated = await updateProduct(product.id, patch);
      if (canClass && form.saleClass !== product.saleClass) updated = await setProductClass(product.id, form.saleClass);
      state.setData(updated);
      setSaved(true);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError && e.code === "CRF_REQUIRED" ? "Somente um farmacêutico com CRF cadastrado confirma a classe." : errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file || !product) return;
    if (file.size > 2 * 1024 * 1024) return setError("A imagem precisa ter até 2 MB.");
    setBusy(true);
    setError("");
    try {
      await uploadProductImage(product.id, file);
      await state.reload();
      onChanged();
    } catch (e) {
      setError(errorMessage(e, "Não consegui enviar a imagem."));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removeImage() {
    if (!product) return;
    setBusy(true);
    try {
      await deleteProductImage(product.id);
      await state.reload();
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SidePanel
      open={Boolean(productId)}
      onOpenChange={(o) => !o && onClose()}
      title={product?.name ?? "Produto"}
      description={product?.subtitle}
      footer={
        product && canEdit ? (
          <>
            <Button disabled={busy} onClick={save}>
              {busy ? "Salvando…" : "Salvar"}
            </Button>
            <Button variant="outline" onClick={onClose}>
              {saved ? "Fechar" : "Cancelar"}
            </Button>
            {saved && <span className="self-center text-[13px] text-green-700" role="status">Alterações salvas.</span>}
          </>
        ) : undefined
      }
    >
      {state.loading && !product && <Skeleton className="h-64" aria-busy="true" />}
      {state.error && !product && <ErrorState error={state.error} onRetry={() => void state.reload()} what="este produto" />}
      {product && (
        <>
          <div className="flex items-center gap-3.5">
            <ProductThumb product={product} size="lg" />
            {canEdit && (
              <div className="flex flex-col items-start gap-1.5">
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" id="product-image" onChange={(e) => onFile(e.target.files?.[0])} />
                <Button variant="outline" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
                  {product.imageUrl ? "Trocar imagem" : "Enviar imagem"}
                </Button>
                {product.imageUrl && (
                  <Button variant="ghost" size="sm" disabled={busy} onClick={removeImage}>
                    Remover imagem
                  </Button>
                )}
                <span className="text-xs text-muted">JPG, PNG ou WebP até 2 MB</span>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={toneVariant(product.classBadge)}>{product.classLabel}</Badge>
            <Badge variant="outline">Estoque {product.stockQty}</Badge>
            {product.needsReview && <Badge variant="amber">Classe a revisar</Badge>}
          </div>
          {product.warning && <Alert variant="amber">{product.warning}</Alert>}
          {product.needsReview && product.classProposed && (
            <Alert variant="amber">
              Uma nova importação propôs a classe “{CLASS_LABELS[product.classProposed]?.label}”{product.classProposedReason ? ` (${product.classProposedReason})` : ""}, diferente da confirmada.
            </Alert>
          )}
          {error && <Alert variant="red">{error}</Alert>}

          <Field label="Nome" htmlFor="pn">
            <Input id="pn" value={form.name} disabled={!canEdit} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Preço" htmlFor="pp">
              <Input id="pp" inputMode="decimal" value={form.price} disabled={!canEdit} onChange={(e) => setForm({ ...form, price: e.target.value })} />
            </Field>
            <Field label="Estoque" htmlFor="ps" hint={product.stockAsOf ? `Atualizado ${timeAgo(product.stockAsOf)}` : undefined}>
              <Input id="ps" inputMode="numeric" value={form.stock} disabled={!canEdit} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Máx. por pedido" htmlFor="pm">
              <Input id="pm" inputMode="numeric" value={form.max} placeholder="Padrão da farmácia" disabled={!canEdit} onChange={(e) => setForm({ ...form, max: e.target.value })} />
            </Field>
            <Field label="Grupo de equivalentes" htmlFor="pe">
              <Input id="pe" value={form.group} placeholder="Ex.: grupo A" disabled={!canEdit} onChange={(e) => setForm({ ...form, group: e.target.value })} />
            </Field>
          </div>
          <Field label="Classe de venda" htmlFor="pc" hint="Somente o farmacêutico confirma a classe.">
            <Select id="pc" value={form.saleClass} disabled={!canClass} onChange={(e) => setForm({ ...form, saleClass: e.target.value as SaleClass })}>
              {CLASS_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {CLASS_LABELS[c].label}
                </option>
              ))}
            </Select>
            {product.classConfirmedByName && <span className="text-xs text-muted">Confirmada por {product.classConfirmedByName}</span>}
          </Field>
          <div className="flex items-center justify-between gap-3">
            <span>Sempre exige farmacêutico</span>
            <Switch checked={form.required} disabled={!canEdit} onCheckedChange={(v) => setForm({ ...form, required: v })} aria-label="Sempre exige farmacêutico" />
          </div>
          {(product.ean || product.activeIngredient) && (
            <dl className="grid grid-cols-2 gap-3 text-[13px]">
              {product.ean && (
                <div>
                  <dt className="text-xs text-muted">EAN</dt>
                  <dd>{product.ean}</dd>
                </div>
              )}
              {product.activeIngredient && (
                <div>
                  <dt className="text-xs text-muted">Princípio ativo</dt>
                  <dd>{product.activeIngredient}</dd>
                </div>
              )}
            </dl>
          )}
          {product.equivalents && product.equivalents.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <b>Equivalentes</b>
              {product.equivalents.map((e) => (
                <div key={e.id} className="flex justify-between text-[13px]">
                  <span>{e.name}</span>
                  <span className="text-muted">
                    {e.stockQty > 0 ? `${e.stockQty} em estoque` : "sem estoque"} · {formatBRL(e.priceCents)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </SidePanel>
  );
}
