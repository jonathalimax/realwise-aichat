// One-off: recompute commitmentScore/scoreBand for every existing lead, since recomputeScore was
// never wired in before this fix and all leads are stuck at the DB default (0/cold). Run once:
//   pnpm --filter @realwise/api exec ts-node -r dotenv/config src/scripts/backfill-lead-scores.ts
import { prisma } from "@realwise/db";
import { computeLeadScore, type LeadSignalInputs } from "../modules/leads/lead-scoring";

const PRICE_KEYWORDS = ["preço", "preco", "valor", "quanto custa", "quanto é", "custo"];
const AVAILABILITY_KEYWORDS = ["disponível", "disponivel", "disponibilidade", "tem vaga", "tem horário"];
const LOCATION_KEYWORDS = ["localização", "localizacao", "endereço", "endereco", "onde fica", "onde é"];
const PAYMENT_KEYWORDS = ["pagamento", "financiamento", "parcelado", "parcelas", "entrada", "à vista"];
const SPECIFIC_ITEM_KEYWORDS = ["esse", "essa", "aquele", "aquela", "modelo", "unidade", "apartamento", "casa", "carro"];

async function main() {
  const leads = await prisma.lead.findMany({ select: { id: true, businessId: true } });
  let updated = 0;

  for (const lead of leads) {
    const [full, conversations, appointments] = await Promise.all([
      prisma.lead.findUniqueOrThrow({ where: { id: lead.id } }),
      prisma.conversation.findMany({ where: { leadId: lead.id }, include: { messages: true } }),
      prisma.appointment.findMany({ where: { leadId: lead.id } }),
    ]);

    const visitorTexts = conversations.flatMap((c) => c.messages.filter((m) => m.role === "visitor").map((m) => m.content.toLowerCase()));
    const messageCount = conversations.reduce((sum, c) => sum + c.messages.length, 0);
    const matchesAny = (keywords: string[]) => visitorTexts.some((t) => keywords.some((kw) => t.includes(kw)));
    const weeksSinceLastActivity = Math.max(0, Math.floor((Date.now() - full.lastSeenAt.getTime()) / (7 * 24 * 3600 * 1000)));

    const inputs: LeadSignalInputs = {
      hasNameAndPhone: Boolean(full.name),
      messageCount,
      askedPrice: matchesAny(PRICE_KEYWORDS),
      askedAvailability: matchesAny(AVAILABILITY_KEYWORDS),
      startedBooking: appointments.length > 0,
      completedBooking: appointments.some((a) => a.status === "completed" || a.status === "confirmed"),
      askedLocation: matchesAny(LOCATION_KEYWORDS),
      askedPaymentOrFinancing: matchesAny(PAYMENT_KEYWORDS),
      requestedEscalation: conversations.some((c) => c.escalatedAt !== null),
      isReturningVisitor: full.sessionCount > 1,
      sentDocument: false,
      askedSpecificItem: matchesAny(SPECIFIC_ITEM_KEYWORDS),
      weeksSinceLastActivity,
    };

    const { score, band, signals } = computeLeadScore(inputs);
    await prisma.lead.update({
      where: { id: lead.id },
      data: { commitmentScore: score, scoreBand: band, scoreSignals: signals as any },
    });
    updated++;
  }

  console.log(`[backfill-lead-scores] updated ${updated}/${leads.length} leads`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
