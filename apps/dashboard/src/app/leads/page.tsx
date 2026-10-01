"use client";

import { useEffect, useState } from "react";
import { getLeads, getLeadWhatsappLink } from "../../lib/api";

const BAND_STYLES: Record<string, string> = {
  hot: "bg-negative-soft text-negative",
  warm: "bg-warning-soft text-warning",
  cold: "bg-bg-2 text-muted",
};

const BAND_LABELS: Record<string, string> = { hot: "🔥 Quente", warm: "🌤 Morno", cold: "❄️ Frio" };

export default function LeadsPage() {
  const [leads, setLeads] = useState<any[]>([]);

  useEffect(() => {
    getLeads().then(setLeads).catch(() => setLeads([]));
  }, []);

  async function callOnWhatsapp(leadId: string) {
    const { url } = await getLeadWhatsappLink(leadId, "o que você perguntou");
    window.open(url, "_blank");
  }

  return (
    <div>
      <h1 className="mb-5 font-serif text-2xl text-ink">Leads</h1>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[0.7rem] uppercase tracking-wide text-muted">
            <th className="pb-2">Nome</th>
            <th className="pb-2">Telefone</th>
            <th className="pb-2">Temperatura</th>
            <th className="pb-2" />
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => (
            <tr key={lead.id} className="border-t border-border">
              <td className="py-2">{lead.name ?? "—"}</td>
              <td className="py-2 font-mono">{lead.phone}</td>
              <td className="py-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${BAND_STYLES[lead.scoreBand]}`}>
                  {BAND_LABELS[lead.scoreBand]}
                </span>
              </td>
              <td className="py-2">
                <button
                  onClick={() => callOnWhatsapp(lead.id)}
                  className="rounded-lg bg-[#25D366] px-3 py-1 text-xs font-bold text-white"
                >
                  WhatsApp
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
