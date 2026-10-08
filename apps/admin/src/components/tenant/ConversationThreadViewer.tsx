"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { getTenantConversationThread } from "../../lib/api";
import { MessageMirror } from "../conversations/MessageMirror";

// Full-thread "mirror" view for a single conversation — same real assistant-message rendering
// (markdown + listing cards + simulation cards + persona label) as apps/chat/ChatScreen.tsx, via
// MessageMirror. Modal/table pattern mirrors ListingPreview.tsx + ListingsSection.tsx.
export function ConversationThreadViewer({
  tenantId,
  conversationId,
  open,
  onOpenChange,
}: {
  tenantId: string;
  conversationId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [thread, setThread] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !conversationId) {
      setThread(null);
      return;
    }
    setLoading(true);
    getTenantConversationThread(tenantId, conversationId)
      .then(setThread)
      .catch(() => setThread(null))
      .finally(() => setLoading(false));
  }, [open, tenantId, conversationId]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-card bg-bg-2 p-4 shadow-xl outline-none">
          <Dialog.Close className="absolute right-3 top-3 rounded-lg p-1.5 text-ink-soft hover:bg-surface">
            <X className="h-5 w-5" />
            <span className="sr-only">Fechar</span>
          </Dialog.Close>
          <Dialog.Title className="mb-1 text-sm font-semibold text-ink">Como o cliente viu esta conversa</Dialog.Title>
          <Dialog.Description className="mb-3 text-xs text-ink-soft">
            Espelho exato do que foi exibido no chat — exatamente o que foi enviado ou não.
          </Dialog.Description>

          {loading && <p className="text-ink-soft">Carregando…</p>}

          {!loading && thread && (
            <div className="flex-1 space-y-3 overflow-y-auto pr-1">
              {thread.messages.map((m: any) => (
                <div
                  key={m.id}
                  className={m.role === "visitor" ? "ml-auto max-w-[80%]" : "max-w-[90%]"}
                >
                  {m.role === "owner" && <div className="mb-1 text-xs font-semibold text-accent">{thread.businessName}</div>}
                  {m.role === "assistant" ? (
                    <MessageMirror message={m} personaName={thread.personaName} niche={thread.niche} />
                  ) : (
                    <div
                      className={
                        m.role === "visitor"
                          ? "rounded-2xl rounded-br-sm bg-accent px-4 py-3 text-sm text-white break-words"
                          : "rounded-2xl rounded-bl-sm border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-ink break-words"
                      }
                    >
                      {m.content}
                    </div>
                  )}
                </div>
              ))}
              {thread.messages.length === 0 && <p className="text-ink-soft">Sem mensagens nesta conversa.</p>}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
