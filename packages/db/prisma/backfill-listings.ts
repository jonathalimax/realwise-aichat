import { prisma } from "../src/index";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3006";
const INTERNAL_TOKEN = process.env.INFERENCE_GATEWAY_TOKEN;

// One-shot backfill: find all Studio-plan businesses with >=1 processed KnowledgeDocument and
// run listing extraction for each SERIALLY (CPU-inference-bound, not safe to parallelize).
async function main() {
  if (!INTERNAL_TOKEN) {
    throw new Error("INFERENCE_GATEWAY_TOKEN must be set to call the internal extraction endpoint");
  }

  const businesses = await prisma.business.findMany({
    where: {
      subscription: { plan: { code: "studio" } },
      documents: { some: { status: "processed" } },
    },
    select: { id: true, name: true },
  });

  console.log(`backfill-listings: found ${businesses.length} studio-plan business(es) with processed documents`);

  for (const business of businesses) {
    console.log(`backfill-listings: extracting for ${business.name} (${business.id})...`);
    try {
      const res = await fetch(`${API_URL}/internal/businesses/${business.id}/listings/extract`, {
        method: "POST",
        headers: { "x-internal-token": INTERNAL_TOKEN },
      });
      if (!res.ok) {
        console.error(`backfill-listings: ${business.name} failed with status ${res.status}`);
        continue;
      }
      const result = await res.json();
      console.log(`backfill-listings: ${business.name} -> created ${result.created}, updated ${result.updated}, retired ${result.retired}`);
    } catch (error) {
      console.error(`backfill-listings: ${business.name} failed`, error);
    }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
