"use client";

import { useEffect, useState } from "react";
import { getDocuments, getUnanswered } from "../../lib/api";
import { Card, CardContent } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";

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
            <Card key={doc.id}>
              <CardContent className="flex items-center justify-between p-4 text-sm">
                <span className="text-ink">{doc.filename}</span>
                <Badge variant={doc.status === "processed" ? "positive" : doc.status === "failed" ? "negative" : "neutral"}>
                  {doc.status}
                </Badge>
              </CardContent>
            </Card>
          ))}
          {documents.length === 0 && <p className="text-sm text-ink-soft">Nenhum documento enviado ainda.</p>}
        </div>
      </div>

      <div>
        <h2 className="mb-3 font-serif text-xl text-ink">Perguntas não respondidas</h2>
        <div className="flex flex-col gap-2">
          {unanswered.map((q) => (
            <Card key={q.id}>
              <CardContent className="p-4 text-sm">
                <div className="text-ink">{q.questionText}</div>
                <div className="mt-1 text-xs text-ink-soft">{q.occurrenceCount}x perguntado</div>
              </CardContent>
            </Card>
          ))}
          {unanswered.length === 0 && <p className="text-sm text-ink-soft">Nenhuma pergunta pendente.</p>}
        </div>
      </div>
    </div>
  );
}
