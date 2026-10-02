import { prisma } from "@realwise/db";
import { hasActivePaidSubscription } from "@realwise/shared";
import { sendEmail } from "../email";

const REMINDER_WINDOW_DAYS = 2;

export async function processTrialWatch() {
  const now = new Date();
  const reminderCutoff = new Date(now.getTime() + REMINDER_WINDOW_DAYS * 24 * 3600 * 1000);

  // 2 days out: send a one-time reminder that the public link stops working when the trial ends.
  const needsReminder = await prisma.business.findMany({
    where: {
      trialEndsAt: { lte: reminderCutoff, gt: now },
      trialReminderSentAt: null,
      deletedAt: null,
    },
    include: { subscription: true },
  });

  for (const business of needsReminder) {
    if (hasActivePaidSubscription(business)) continue;
    if (!business.email) {
      console.warn(`[trial-watch] ${business.id} (${business.name}) has no email on file — cannot send trial reminder`);
      continue;
    }
    const daysLeft = Math.ceil((business.trialEndsAt!.getTime() - now.getTime()) / (24 * 3600 * 1000));
    await sendEmail(
      business.email,
      `Seu teste grátis na Realwise termina em ${daysLeft} dias`,
      `<p>Oi, ${business.ownerName || business.name}!</p>
       <p>Seu período de teste grátis da Realwise termina em <strong>${daysLeft} dias</strong>
       (${business.trialEndsAt!.toLocaleDateString("pt-BR")}). Depois disso, o link de atendimento
       da ${business.name} vai parar de funcionar até que você assine um plano.</p>
       <p>Para continuar sem interrupção, escolha um plano no painel: Plano e cobrança.</p>`,
    );
    await prisma.business.update({ where: { id: business.id }, data: { trialReminderSentAt: now } });
  }

  // Trial expired with no paid subscription: suspend — the public chat link (getBySlug) already
  // refuses anything that isn't status "live", so suspending is what actually turns the link off.
  const expired = await prisma.business.findMany({
    where: {
      trialEndsAt: { lte: now },
      status: { in: ["live", "pending_review", "onboarding"] },
      deletedAt: null,
    },
    include: { subscription: true },
  });

  for (const business of expired) {
    if (hasActivePaidSubscription(business)) continue;
    await prisma.business.update({ where: { id: business.id }, data: { status: "suspended" } });
    console.log(`[trial-watch] suspended ${business.id} (${business.name}) — trial expired with no paid subscription`);
  }

  console.log(`[trial-watch] reminders sent: ${needsReminder.filter((b) => !hasActivePaidSubscription(b) && b.email).length}, suspended: ${expired.filter((b) => !hasActivePaidSubscription(b)).length}`);
}
