import { prisma } from "../src/index";

async function main() {
  await prisma.plan.upsert({
    where: { code: "essencial" },
    update: {},
    create: {
      code: "essencial",
      name: "Essencial",
      priceBrlCents: 29700,
      setupFeeBrlCents: 49700,
      conversationQuota: 300,
      documentQuota: 10,
      whatsappNumberQuota: 1,
      features: { analytics: "basic" },
      stripePriceId: "price_essencial_placeholder",
      stripeSetupPriceId: "price_essencial_setup_placeholder",
    },
  });

  await prisma.plan.upsert({
    where: { code: "profissional" },
    update: {},
    create: {
      code: "profissional",
      name: "Profissional",
      priceBrlCents: 59700,
      setupFeeBrlCents: 99700,
      conversationQuota: 1200,
      documentQuota: 50,
      whatsappNumberQuota: 3,
      features: { analytics: "full", branding: true },
      stripePriceId: "price_profissional_placeholder",
      stripeSetupPriceId: "price_profissional_setup_placeholder",
    },
  });

  await prisma.plan.upsert({
    where: { code: "studio" },
    update: {},
    create: {
      code: "studio",
      name: "Studio",
      priceBrlCents: 119700,
      setupFeeBrlCents: 199700,
      conversationQuota: 4000,
      documentQuota: 999999,
      whatsappNumberQuota: 10,
      features: { analytics: "full", branding: true, customDomain: true },
      stripePriceId: "price_studio_placeholder",
      stripeSetupPriceId: "price_studio_setup_placeholder",
    },
  });

  console.log("Seeded plans: essencial, profissional, studio");
}

main().finally(() => prisma.$disconnect());
