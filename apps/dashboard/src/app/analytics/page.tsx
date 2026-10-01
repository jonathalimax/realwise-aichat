"use client";

import { useEffect, useState } from "react";
import { getTopQuestions } from "../../lib/api";

export default function AnalyticsPage() {
  const [questions, setQuestions] = useState<any[]>([]);

  useEffect(() => {
    getTopQuestions().then(setQuestions).catch(() => setQuestions([]));
  }, []);

  return (
    <div>
      <h1 className="mb-5 font-serif text-2xl text-ink">Perguntas mais feitas</h1>
      <table className="w-full text-sm">
        <tbody>
          {questions.map((q) => (
            <tr key={q.id} className="border-t border-border">
              <td className="py-2">{q.questionText}</td>
              <td className="py-2 text-right font-mono">{q.occurrenceCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
