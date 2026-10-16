// Deterministic dashboard insights (docs/pharmacy/API.md 10.1). Rules over already-aggregated numbers;
// the wording is final. (An optional model rewrite was deliberately not built: this text is the fallback and the product.)

export interface InsightInput {
  days: number;
  topUnmet?: { name: string; requests: number } | null;
  peakHour?: { hour: number; share: number } | null; // share 0..1 of orders in the window
  unclassifiedCount?: number;
  slowConfirm?: { avgMinutes: number; reminderMinutes: number; orders: number } | null;
  staleSheet?: { ageHours: number; maxAgeHours: number } | null;
  can: { catalogo: boolean; classes: boolean; importar: boolean; analises: boolean; pedidos: boolean };
}

export interface Insight {
  id: string;
  title: string;
  description: string;
  cta: { label: string; href: string };
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function buildInsights(i: InsightInput): Insight[] {
  const out: Insight[] = [];
  if (i.staleSheet && i.can.importar) {
    out.push({
      id: "stale-sheet",
      title: "Estoque desatualizado",
      description: `A planilha tem ${i.staleSheet.ageHours}h (limite ${i.staleSheet.maxAgeHours}h). Novos pedidos passam pelo farmacêutico até você importar uma planilha nova.`,
      cta: { label: "Importar planilha", href: "/catalogo/importar" },
    });
  }
  if (i.topUnmet && i.topUnmet.requests > 0 && i.can.catalogo && i.can.analises) {
    out.push({
      id: "stock-out-top",
      title: `${i.topUnmet.name} sem estoque`,
      description: `${i.topUnmet.requests} ${plural(i.topUnmet.requests, "cliente pediu", "clientes pediram")} nos últimos ${i.days} dias e não ${plural(i.topUnmet.requests, "pôde", "puderam")} comprar.`,
      cta: { label: "Abrir catálogo", href: "/catalogo?stock=out" },
    });
  }
  if ((i.unclassifiedCount ?? 0) > 0 && i.can.classes) {
    const n = i.unclassifiedCount as number;
    out.push({
      id: "unclassified",
      title: `${n} ${plural(n, "produto sem classe", "produtos sem classe")}`,
      description: "Produtos sem classe não podem ser vendidos no chat até o farmacêutico revisar.",
      cta: { label: "Revisar classes", href: "/catalogo/classes" },
    });
  }
  if (i.slowConfirm && i.slowConfirm.orders >= 3 && i.slowConfirm.avgMinutes > i.slowConfirm.reminderMinutes && i.can.pedidos) {
    out.push({
      id: "slow-confirm",
      title: "Pedidos demoram para ser confirmados",
      description: `Em média ${Math.round(i.slowConfirm.avgMinutes)} min para confirmar (lembrete configurado em ${i.slowConfirm.reminderMinutes} min).`,
      cta: { label: "Ver pedidos", href: "/pedidos" },
    });
  }
  if (i.peakHour && i.peakHour.share >= 0.2 && i.can.analises) {
    out.push({
      id: "peak-hour",
      title: `Pico de pedidos às ${i.peakHour.hour}h`,
      description: `${Math.round(i.peakHour.share * 100)}% dos pedidos chegam entre ${i.peakHour.hour}h e ${(i.peakHour.hour + 1) % 24}h. Deixe a equipe pronta nesse horário.`,
      cta: { label: "Ver análises", href: "/analises" },
    });
  }
  return out.slice(0, 5);
}

export function peakHourOf(hours: number[]): { hour: number; share: number } | null {
  if (hours.length < 5) return null;
  const counts = new Map<number, number>();
  for (const h of hours) counts.set(h, (counts.get(h) ?? 0) + 1);
  const [hour, n] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  return { hour, share: n / hours.length };
}
