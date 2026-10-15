/**
 * READ-ONLY report: businesses whose slug collides with a reserved route of the shared domain, or has an invalid format.
 * Run it against production BEFORE deploying the /<slug>/chat scheme:
 *
 *   DOTENV_CONFIG_PATH=../../.env pnpm --filter @realwise/api exec tsx -r dotenv/config scripts/check-reserved-slugs.ts
 *
 * Plain-SQL equivalent (lists reserved collisions): see docs/pharmacy/URLS.md.
 */
import { prisma } from "@realwise/db";
import { RESERVED_SLUGS, slugProblem } from "../src/common/slug";

async function main() {
  const rows = await prisma.business.findMany({ select: { id: true, slug: true, name: true, niche: true, status: true } });
  const bad = rows.filter((b) => !b.slug.startsWith("pending-") && slugProblem(b.slug));
  console.log(`${rows.length} businesses checked, ${bad.length} with a problem.`);
  for (const b of bad) console.log(`  ${b.slug}  (${b.name}, ${b.niche}, ${b.status}, ${b.id}): ${slugProblem(b.slug)}`);
  console.log(`reserved list (${RESERVED_SLUGS.size}): ${[...RESERVED_SLUGS].join(", ")}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
