"use client";

import { useEffect, useState } from "react";
import { getTopQuestions } from "../../lib/api";
import { Card, CardContent } from "../../components/ui/card";
import { Table, TableBody, TableRow, TableCell } from "../../components/ui/table";

export default function AnalyticsPage() {
  const [questions, setQuestions] = useState<any[]>([]);

  useEffect(() => {
    getTopQuestions().then(setQuestions).catch(() => setQuestions([]));
  }, []);

  return (
    <div>
      <h1 className="mb-5 font-serif text-2xl text-ink">Perguntas mais feitas</h1>
      <Card>
        <CardContent className="p-5">
          <Table>
            <TableBody>
              {questions.map((q) => (
                <TableRow key={q.id}>
                  <TableCell>{q.questionText}</TableCell>
                  <TableCell className="text-right font-mono">{q.occurrenceCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {questions.length === 0 && <p className="text-sm text-ink-soft">Ainda sem dados suficientes.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
