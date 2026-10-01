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
