import * as bcrypt from "bcrypt";
import { PLAN_CATALOG } from "@realwise/shared";
import { prisma } from "../src/index";

async function main() {
  // Plans come from the shared catalog (packages/shared/src/plans.ts) — edit numbers there, not
  // here. Setup is always free and Stripe price IDs are read from STRIPE_PRICE_* env at checkout,
  // so the legacy non-null columns are written as neutral values: setupFeeBrlCents 0,
  // stripePriceId/stripeSetupPriceId "" (kept, not dropped, to avoid a migration).
  for (const plan of PLAN_CATALOG) {
    const data = {
      name: plan.name,
      priceBrlCents: plan.priceBrlCents,
      setupFeeBrlCents: 0,
      conversationQuota: plan.conversationQuota,
      documentQuota: plan.documentQuota,
      whatsappNumberQuota: plan.whatsappNumberQuota,
      features: { ...plan.features },
      stripePriceId: "",
      stripeSetupPriceId: "",
      isActive: true,
      llmMonthlyBudgetUsdCents: plan.llmMonthlyBudgetUsdCents,
    };
    await prisma.plan.upsert({ where: { code: plan.code }, update: data, create: { code: plan.code, ...data } });
  }

  console.log(`Seeded plans: ${PLAN_CATALOG.map((p) => p.code).join(", ")}`);

  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (adminEmail && adminPassword) {
    const passwordHash = await bcrypt.hash(adminPassword, 10);
    await prisma.adminUser.upsert({
      where: { email: adminEmail },
      update: { passwordHash },
      create: { email: adminEmail, passwordHash, name: process.env.SEED_ADMIN_NAME ?? "Founder", role: "superadmin" },
    });
    console.log(`Seeded admin user: ${adminEmail}`);
  } else {
    console.log("SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD not set — skipping admin user seed. Set them in .env to log into apps/admin.");
  }
}

main().finally(() => prisma.$disconnect());
