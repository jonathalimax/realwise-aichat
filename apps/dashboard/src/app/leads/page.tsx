"use client";

import { useEffect, useState } from "react";
import { getLeads, getLeadWhatsappLink } from "../../lib/api";
import { Card, CardContent } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../../components/ui/table";

const BAND_VARIANT: Record<string, "negative" | "warning" | "neutral"> = {
  hot: "negative",
  warm: "warning",
  cold: "neutral",
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
      <Card>
        <CardContent className="p-5">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Temperatura</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.map((lead) => (
                <TableRow key={lead.id}>
                  <TableCell>{lead.name ?? "—"}</TableCell>
                  <TableCell className="font-mono">{lead.phone}</TableCell>
                  <TableCell>
                    <Badge variant={BAND_VARIANT[lead.scoreBand]}>{BAND_LABELS[lead.scoreBand]}</Badge>
                  </TableCell>
                  <TableCell>
                    <Button size="sm" className="bg-[#25D366] hover:opacity-90" onClick={() => callOnWhatsapp(lead.id)}>
                      WhatsApp
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
