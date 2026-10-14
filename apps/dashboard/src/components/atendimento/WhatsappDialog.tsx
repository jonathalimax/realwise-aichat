"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Alert } from "../ui/alert";
import { Skeleton } from "../ui/skeleton";
import { whatsappDraft, type WhatsappDraft } from "../../lib/pharmacy-api";
import { ApiError } from "../../lib/api";
import { errorMessage } from "../../lib/use-load";

function webUrl(phone: string, text: string) {
  return `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(text)}`;
}
function appUrl(phone: string, text: string) {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

/**
 * "Iniciar atendimento": previews (and lets the attendant edit) the first WhatsApp message, then opens WhatsApp Web
 * in a new tab. The window is opened synchronously from the click so popup blockers allow it; the handoff is marked
 * "em atendimento" by `onStarted` right after.
 */
export function WhatsappDialog({
  handoffId,
  open,
  onOpenChange,
  onStarted,
}: {
  handoffId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStarted: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState<WhatsappDraft | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setDraft(null);
    setError("");
    whatsappDraft(handoffId)
      .then((d) => {
        if (!alive) return;
        setDraft(d);
        setText(d.message);
      })
      .catch((e) => {
        if (!alive) return;
        setError(e instanceof ApiError && e.code === "NO_PHONE" ? "Este cliente não informou o WhatsApp. Responda pelo chat." : errorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, [open, handoffId]);

  const empty = text.trim().length === 0;

  async function started() {
    setBusy(true);
    try {
      await onStarted();
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function openWeb() {
    if (!draft || empty) return;
    window.open(webUrl(draft.phone, text.trim()), "_blank", "noopener,noreferrer");
    void started();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(600px,calc(100vw-32px))]">
        <DialogHeader>
          <DialogTitle>Iniciar atendimento pelo WhatsApp</DialogTitle>
          <DialogDescription>
            Revise a mensagem antes de abrir. Ela traz só o que o cliente contou ao Alex; as sugestões internas nunca vão no texto.
          </DialogDescription>
        </DialogHeader>
        {error && <Alert variant="red">{error}</Alert>}
        {!draft && !error && <Skeleton className="h-40" aria-busy="true" />}
        {draft && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="wa-message" className="text-sm font-medium">
              Mensagem para {draft.customerFirstName ?? "o cliente"}
            </label>
            <Textarea id="wa-message" rows={10} maxLength={draft.maxChars} value={text} onChange={(e) => setText(e.target.value)} />
            <span className="text-xs text-muted">
              {text.length}/{draft.maxChars} caracteres · o WhatsApp Web abre em uma nova aba e você envia a mensagem por lá.
            </span>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          {draft && !empty && (
            <a
              href={appUrl(draft.phone, text.trim())}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => void started()}
              className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-3.5 text-sm font-medium text-ink hover:bg-bg-2"
            >
              Abrir no app
            </a>
          )}
          <Button onClick={openWeb} disabled={!draft || empty || busy}>
            {busy ? "Iniciando…" : "Abrir no WhatsApp Web"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
