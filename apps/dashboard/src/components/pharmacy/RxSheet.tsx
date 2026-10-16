"use client";

import { useEffect, useState } from "react";
import { ApiError } from "../../lib/api";
import {
  approvePrescription,
  fetchPrescriptionFile,
  getPrescription,
  rejectPrescription,
  type RxDetail,
} from "../../lib/pharmacy-api";
import { RX_REJECT_REASONS } from "../../lib/labels";
import { errorMessage, useLoad } from "../../lib/use-load";
import { useSession } from "../../lib/session";
import { timeAgo } from "../../lib/format";
import { Badge, toneVariant } from "../ui/badge";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { Select } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { Skeleton } from "../ui/skeleton";
import { SidePanel } from "../ui/side-panel";
import { ErrorState } from "../page-kit";

/** Prescription viewer: protected file (blob via cookie auth, never a public URL) + approve / reject (pharmacist with CRF). */
export function RxSheet({ rxId, onClose, onChanged }: { rxId: string | null; onClose: () => void; onChanged: () => void }) {
  const { me, can, refreshNotifications } = useSession();
  const state = useLoad<RxDetail | null>(() => (rxId ? getPrescription(rxId) : Promise.resolve(null)), [rxId], { live: "prescriptions" });
  const rx = rxId && state.data?.id === rxId ? state.data : null;
  const [file, setFile] = useState<{ url: string; mimeType: string } | null>(null);
  const [fileError, setFileError] = useState("");
  const [reasonChoice, setReasonChoice] = useState<string>(RX_REJECT_REASONS[0]);
  const [otherReason, setOtherReason] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState("");

  // load the protected image/PDF as a blob; revoke it when the panel closes
  useEffect(() => {
    setFile(null);
    setFileError("");
    setError("");
    if (!rx || !rx.fileAvailable) return;
    let revoked = false;
    let created: string | null = null;
    fetchPrescriptionFile(rx.fileUrl)
      .then((f) => {
        if (revoked) return URL.revokeObjectURL(f.url);
        created = f.url;
        setFile(f);
      })
      .catch((e) => !revoked && setFileError(errorMessage(e, "Não consegui abrir a foto da receita.")));
    return () => {
      revoked = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [rx?.id, rx?.fileAvailable]); // eslint-disable-line react-hooks/exhaustive-deps

  const canReview = can("receitas", "edit") && Boolean(me?.canPerformPharmacistActions);
  const reason = reasonChoice === "Outro motivo" ? otherReason.trim() : reasonChoice;

  async function act(kind: "approve" | "reject") {
    if (!rx) return;
    setBusy(kind);
    setError("");
    try {
      const updated = kind === "approve" ? await approvePrescription(rx.id) : await rejectPrescription(rx.id, reason);
      state.setData(updated);
      onChanged();
      void refreshNotifications();
    } catch (e) {
      if (e instanceof ApiError && e.code === "CRF_REQUIRED") setError("Somente um farmacêutico com CRF cadastrado pode validar receitas.");
      else setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <SidePanel
      open={Boolean(rxId)}
      onOpenChange={(o) => !o && onClose()}
      title={rx?.code ?? "Receita"}
      description={rx ? `${rx.patientName ?? "Paciente não informado"} · ${rx.orderCode ?? "sem pedido"}` : undefined}
      footer={
        rx?.status === "pending" && canReview ? (
          <>
            <Button disabled={busy !== null} onClick={() => act("approve")}>
              {busy === "approve" ? "Aprovando…" : "Aprovar receita"}
            </Button>
            <Button variant="destructive" disabled={busy !== null || reason.length < 3} onClick={() => act("reject")}>
              {busy === "reject" ? "Recusando…" : "Recusar"}
            </Button>
          </>
        ) : undefined
      }
    >
      {state.loading && !rx && <Skeleton className="h-72" aria-busy="true" />}
      {state.error && !rx && <ErrorState error={state.error} onRetry={() => void state.reload()} what="esta receita" />}
      {rx && (
        <>
          <div className="flex items-center gap-2">
            <Badge variant={toneVariant(rx.badge)}>{rx.statusLabel}</Badge>
          </div>
          <div className="flex min-h-[280px] items-center justify-center overflow-hidden rounded-[10px] border border-dashed border-zinc-400 bg-bg-2 text-center text-sm text-muted">
            {!rx.fileAvailable ? (
              <p className="p-4">A foto desta receita já foi apagada ({rx.retentionLabel ?? "prazo de guarda encerrado"}).</p>
            ) : fileError ? (
              <p className="p-4">{fileError}</p>
            ) : !file ? (
              <p className="p-4">Carregando a foto da receita…</p>
            ) : file.mimeType === "application/pdf" ? (
              <iframe src={file.url} title={`Receita ${rx.code}`} className="h-[420px] w-full" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={file.url} alt={`Foto da receita ${rx.code}`} className="max-h-[420px] w-full object-contain" />
            )}
          </div>
          {file && (
            <a href={file.url} target="_blank" rel="noopener noreferrer" className="w-fit text-[13px] font-semibold text-accent hover:underline">
              Abrir em tela cheia
            </a>
          )}
          <div className="flex flex-col gap-1">
            <b>{rx.med}</b>
            <span className="text-[13px] text-muted">
              Enviada {timeAgo(rx.createdAt)} · consentimento LGPD registrado{rx.retentionLabel ? ` · ${rx.retentionLabel}` : ""}
            </span>
          </div>
          {error && <Alert variant="red">{error}</Alert>}
          {rx.status === "pending" && canReview && (
            <div className="flex flex-col gap-2">
              <label htmlFor="rxreason" className="text-sm font-medium">
                Motivo da recusa (somente se recusar)
              </label>
              <Select id="rxreason" value={reasonChoice} onChange={(e) => setReasonChoice(e.target.value)}>
                {RX_REJECT_REASONS.map((r) => (
                  <option key={r}>{r}</option>
                ))}
                <option>Outro motivo</option>
              </Select>
              {reasonChoice === "Outro motivo" && (
                <Textarea rows={2} maxLength={300} value={otherReason} onChange={(e) => setOtherReason(e.target.value)} placeholder="Descreva o motivo (obrigatório)" aria-label="Descreva o motivo" />
              )}
            </div>
          )}
          {rx.status === "pending" && !canReview && (
            <Alert variant="soft">Somente farmacêuticos com CRF cadastrado podem validar receitas. Você pode visualizar, mas não aprovar ou recusar.</Alert>
          )}
          {rx.status !== "pending" && (
            <Alert variant="soft">
              Receita {rx.statusLabel.toLowerCase()}
              {rx.reviewedByName ? ` por ${rx.reviewedByName}` : ""}
              {rx.rejectReason ? `. Motivo: ${rx.rejectReason}` : ""}. O entregador recolhe a receita original na entrega.
            </Alert>
          )}
        </>
      )}
    </SidePanel>
  );
}
