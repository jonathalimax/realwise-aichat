import { prisma } from "../src/index";

async function main() {
  // Restructured to 2 tiers (from 3) — differentiated by things an owner actually feels (WhatsApp
  // lines, calendar sync, branding/domain, support priority), not raw conversation-count quotas.
  await prisma.plan.upsert({
    where: { code: "essencial" },
    update: {
      name: "Essencial",
      priceBrlCents: 29700,
      setupFeeBrlCents: 9900,
      conversationQuota: 100,
      documentQuota: 10,
      whatsappNumberQuota: 1,
      features: { analytics: "basic", calendarSync: false, branding: false, customDomain: false, prioritySupport: false },
      stripeSetupPriceId: "price_1UMGJrRo53xwsjMq3nSGDjUb",
      isActive: true,
    },
    create: {
      code: "essencial",
      name: "Essencial",
      priceBrlCents: 29700,
      setupFeeBrlCents: 9900,
      conversationQuota: 100,
      documentQuota: 10,
      whatsappNumberQuota: 1,
      features: { analytics: "basic", calendarSync: false, branding: false, customDomain: false, prioritySupport: false },
      stripePriceId: "price_1ULfqwRo53xwsjMqTLbkA197",
      stripeSetupPriceId: "price_1UMGJrRo53xwsjMq3nSGDjUb",
    },
  });

  await prisma.plan.upsert({
    where: { code: "profissional" },
    update: {
      name: "Profissional",
      priceBrlCents: 69700,
      setupFeeBrlCents: 99700,
      conversationQuota: 5000,
      documentQuota: 999999,
      whatsappNumberQuota: 5,
      features: { analytics: "full", calendarSync: true, branding: true, customDomain: true, prioritySupport: true },
      stripePriceId: "price_1UM9NXRo53xwsjMqll4VKSKN",
      stripeSetupPriceId: "price_1UM9NYRo53xwsjMqcR8Mx3h0",
      isActive: true,
    },
    create: {
      code: "profissional",
      name: "Profissional",
      priceBrlCents: 69700,
      setupFeeBrlCents: 99700,
      conversationQuota: 5000,
      documentQuota: 999999,
      whatsappNumberQuota: 5,
      features: { analytics: "full", calendarSync: true, branding: true, customDomain: true, prioritySupport: true },
      stripePriceId: "price_1UM9NXRo53xwsjMqll4VKSKN",
      stripeSetupPriceId: "price_1UM9NYRo53xwsjMqcR8Mx3h0",
    },
  });

  // Retired as a standalone tier (consolidated into the new Profissional) — kept inactive, not
  // deleted, so existing subscribers on this plan (if any) keep a valid foreign-key reference.
  await prisma.plan.upsert({
    where: { code: "studio" },
    update: { isActive: false },
    create: {
      code: "studio",
      name: "Studio",
      priceBrlCents: 119700,
      setupFeeBrlCents: 199700,
      conversationQuota: 4000,
      documentQuota: 999999,
      whatsappNumberQuota: 10,
      features: { analytics: "full", branding: true, customDomain: true },
      stripePriceId: "price_1ULfr1Ro53xwsjMq2jtiANbN",
      stripeSetupPriceId: "price_1ULfr2Ro53xwsjMqAPh14Ywo",
      isActive: false,
    },
  });

  console.log("Seeded plans: essencial, profissional (studio retired/inactive)");

  const adminPhone = process.env.SEED_ADMIN_PHONE;
  if (adminPhone) {
    await prisma.adminUser.upsert({
      where: { phone: adminPhone },
      update: {},
      create: { phone: adminPhone, name: process.env.SEED_ADMIN_NAME ?? "Founder", role: "superadmin" },
    });
    console.log(`Seeded admin user: ${adminPhone}`);
  } else {
    console.log("SEED_ADMIN_PHONE not set — skipping admin user seed. Set it in .env to log into apps/admin.");
  }
}

main().finally(() => prisma.$disconnect());
