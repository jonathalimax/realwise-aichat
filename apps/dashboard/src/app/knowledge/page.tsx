"use client";

import { useEffect, useState } from "react";
import { getDocuments, getUnanswered } from "../../lib/api";

export default function KnowledgePage() {
  const [documents, setDocuments] = useState<any[]>([]);
  const [unanswered, setUnanswered] = useState<any[]>([]);

  useEffect(() => {
    getDocuments().then(setDocuments).catch(() => setDocuments([]));
    getUnanswered().then(setUnanswered).catch(() => setUnanswered([]));
  }, []);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="mb-4 font-serif text-2xl text-ink">Base de conhecimento</h1>
        <div className="flex flex-col gap-2">
          {documents.map((doc) => (
            <div key={doc.id} className="flex items-center justify-between rounded-card border border-border bg-surface px-4 py-3 text-sm">
              <span>{doc.filename}</span>
              <span className="text-xs text-muted">{doc.status}</span>
            </div>
          ))}
          {documents.length === 0 && <p className="text-sm text-muted">Nenhum documento enviado ainda.</p>}
        </div>
      </div>

      <div>
        <h2 className="mb-3 font-serif text-xl text-ink">Perguntas não respondidas</h2>
        <div className="flex flex-col gap-2">
          {unanswered.map((q) => (
            <div key={q.id} className="rounded-card border border-border bg-surface px-4 py-3 text-sm">
              <div>{q.questionText}</div>
              <div className="text-xs text-muted">{q.occurrenceCount}x perguntado</div>
            </div>
          ))}
          {unanswered.length === 0 && <p className="text-sm text-muted">Nenhuma pergunta pendente.</p>}
        </div>
      </div>
    </div>
  );
}
