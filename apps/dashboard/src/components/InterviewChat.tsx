"use client";

import { useEffect, useRef, useState } from "react";
import { interviewChat } from "../lib/api";
import { Input } from "./ui/input";
import { Button } from "./ui/button";

interface Message {
  role: "owner" | "clara";
  content: string;
}

export function InterviewChat({
  onFieldFilled,
  prefill,
  prefillNonce,
}: {
  onFieldFilled?: () => void;
  // When `prefillNonce` changes, `prefill` is sent as an owner message — used to target a specific
  // field from outside the chat. The nonce lets the same prefill text be re-sent (e.g. clicking
  // "Pedir à Clara" again on the same field).
  prefill?: string;
  prefillNonce?: number;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [allDone, setAllDone] = useState(false);
  const [remainingGaps, setRemainingGaps] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const lastPrefillNonce = useRef<number | undefined>(undefined);

  async function send(history: Message[]) {
    setSending(true);
    try {
      const result = await interviewChat(history);
      setMessages((prev) => [...prev, { role: "clara", content: result.reply }]);
      setAllDone(result.allDone);
      setRemainingGaps(result.remainingGaps);
      if (onFieldFilled) onFieldFilled();
    } catch {
      setMessages((prev) => [...prev, { role: "clara", content: "Tive um problema para continuar — tenta de novo em instantes." }]);
    } finally {
      setSending(false);
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    send([]);
  }, []);

  useEffect(() => {
    if (!prefill || prefillNonce === undefined || prefillNonce === lastPrefillNonce.current) return;
    lastPrefillNonce.current = prefillNonce;
    if (!started.current) started.current = true;
    const next: Message[] = [...messages, { role: "owner", content: prefill }];
    setMessages(next);
    send(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill, prefillNonce]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  async function handleSend() {
    if (!input.trim() || sending) return;
    const next: Message[] = [...messages, { role: "owner", content: input.trim() }];
    setMessages(next);
    setInput("");
    await send(next);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex max-h-96 flex-col gap-2 overflow-y-auto rounded-lg border border-border bg-bg-2 p-3">
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "owner"
                ? "ml-auto max-w-[85%] rounded-xl rounded-br-sm bg-accent px-3 py-2 text-sm text-white"
                : "max-w-[85%] rounded-xl rounded-bl-sm bg-surface px-3 py-2 text-sm text-ink"
            }
          >
            {m.content}
          </div>
        ))}
        {sending && (
          <div className="flex max-w-[60%] items-center gap-1 rounded-xl rounded-bl-sm bg-surface px-3 py-2">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-soft [animation-delay:-0.3s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-soft [animation-delay:-0.15s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-soft" />
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      {!allDone && (
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Digite sua resposta…"
            disabled={sending}
          />
          <Button onClick={handleSend} disabled={sending || !input.trim()}>Enviar</Button>
        </div>
      )}
      {remainingGaps !== null && (
        <p className="text-xs text-ink-soft">
          {allDone ? "Todos os campos foram cobertos." : `${remainingGaps} campo(s) ainda faltando.`}
        </p>
      )}
    </div>
  );
}
