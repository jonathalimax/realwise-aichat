import { prisma } from "@realwise/db";
import { buildWaMeLink, buildColdLeadReengagementMessage } from "@realwise/shared";
import { sendEmail, escapeHtml } from "../email";

const COOLING_WINDOW_HOURS = 24;

function describeSinceLastSeen(lastSeenAt: Date, now: Date): string {
  const hours = Math.floor((now.getTime() - lastSeenAt.getTime()) / 3600_000);
  if (hours < 48) return `${hours}h sem atividade`;
  return `${Math.floor(hours / 24)} dias sem atividade`;
}

export async function processColdLeadDigest() {
  const now = new Date();
  const since24h = new Date(now.getTime() - COOLING_WINDOW_HOURS * 3600 * 1000);

  const businesses = await prisma.business.findMany({
    where: {
      email: { not: null },
      deletedAt: null,
      status: { in: ["live", "pending_review", "onboarding"] },
    },
    select: { id: true, name: true, email: true },
  });

  let digestsSent = 0;

  for (const business of businesses) {
    // Same cooling-lead criteria as LeadsService.getCoolingLeads (hot/warm, quiet 24h+, no appointment/escalation
    // follow-up) — reimplemented here because the worker process has no access to the NestJS DI container.
    const allCooling = await prisma.lead.findMany({
      where: {
        businessId: business.id,
        scoreBand: { in: ["hot", "warm"] },
        lastSeenAt: { lte: since24h },
        appointments: { none: {} },
        conversations: { none: { escalatedAt: { not: null } } },
      },
      select: { id: true, name: true, phone: true, lastSeenAt: true, scoreBand: true, lastDigestNotifiedAt: true },
      orderBy: { lastSeenAt: "asc" },
    });

    // Anti-spam: only (re-)include a lead if it's never been digested, or it went cold again
    // (new activity recorded) after the last digest that mentioned it.
    const coolingLeads = allCooling.filter(
      (lead) => !lead.lastDigestNotifiedAt || lead.lastSeenAt > lead.lastDigestNotifiedAt,
    );

    if (coolingLeads.length === 0) continue;

    const rows = coolingLeads
      .map((lead) => {
        const label = escapeHtml(lead.name || lead.phone);
        const since = describeSinceLastSeen(lead.lastSeenAt, now);
        const message = buildColdLeadReengagementMessage(lead.name ?? "", business.name);
        const link = buildWaMeLink(lead.phone, message);
        return `<li><strong>${label}</strong> (${lead.scoreBand}) — ${since}.
          <a href="${link}">Chamar no WhatsApp</a></li>`;
      })
      .join("\n");

    await sendEmail(
      business.email!,
      `${coolingLeads.length} lead(s) esfriando — ${business.name}`,
      `<p>Oi, ${escapeHtml(business.name)}!</p>
       <p>Esses leads estavam quentes/mornos mas ficaram quietos nas últimas ${COOLING_WINDOW_HOURS}h
       sem agendamento nem resposta direta. Vale dar uma chamada antes que esfriem de vez:</p>
       <ul>${rows}</ul>`,
    );

    await prisma.lead.updateMany({
      where: { id: { in: coolingLeads.map((l) => l.id) } },
      data: { lastDigestNotifiedAt: now },
    });

    digestsSent += 1;
  }

  console.log(`[cold-lead-digest] digests sent: ${digestsSent}`);
}
