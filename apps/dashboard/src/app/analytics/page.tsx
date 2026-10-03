"use client";

import { useEffect, useState } from "react";
import { getTopQuestions } from "../../lib/api";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../../components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../../components/ui/table";

export default function AnalyticsPage() {
  const [questions, setQuestions] = useState<any[]>([]);

  useEffect(() => {
    getTopQuestions().then(setQuestions).catch(() => setQuestions([]));
  }, []);

  return (
    <div>
      <h1 className="mb-5 font-serif text-2xl text-ink">Perguntas sem resposta</h1>
      <Card>
        <CardHeader>
          <CardTitle>Perguntas sem resposta</CardTitle>
          <CardDescription>Perguntas que a Clara não conseguiu responder, mais repetidas primeiro — ótimo ponto de partida para completar sua base de conhecimento.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {questions.length === 0 ? (
            <div className="rounded-card border border-border px-4 py-8 text-center text-sm text-ink-soft">
              Ainda sem dados suficientes.
            </div>
          ) : (
            <>
              <div className="hidden lg:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Pergunta</TableHead>
                      <TableHead className="text-right">Ocorrências</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {questions.map((q) => (
                      <TableRow key={q.id}>
                        <TableCell>{q.questionText}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{q.occurrenceCount}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex flex-col gap-2 lg:hidden">
                {questions.map((q) => (
                  <div key={q.id} className="rounded-lg border border-border bg-bg-2 p-3">
                    <div className="text-sm text-ink">{q.questionText}</div>
                    <div className="mt-2 text-xs text-ink-soft">Ocorrências: {q.occurrenceCount}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
