import { PLAN_CATALOG, PRICING_COPY, formatPlanPriceBrl, planHighlights, type PlanDefinition } from "@realwise/shared";
import { Reveal } from "./Reveal";

// Pricing section shared by the home page and the niche landing pages. Every number and bullet
// comes from the shared plan catalog (packages/shared/src/plans.ts) — don't hardcode prices here.
export function PricingSection({ cta }: { cta: (plan: PlanDefinition) => { href: string; label: string } }) {
  return (
    <section id="precos" className="py-20">
      <Reveal className="mx-auto max-w-5xl px-5 text-center">
        <h2 className="font-serif text-3xl text-ink md:text-4xl">Preço</h2>
        <p className="mx-auto mt-2 max-w-md text-ink-soft">{PRICING_COPY.setupFree}</p>
        <div className="mt-10 grid gap-5 text-left md:grid-cols-3">
          {PLAN_CATALOG.map((plan) => (
            <PlanCard key={plan.code} plan={plan} cta={cta(plan)} />
          ))}
        </div>
        <p className="mx-auto mt-6 max-w-2xl text-sm text-ink-soft">
          {PRICING_COPY.conversationDefinition} {PRICING_COPY.overQuota} {PRICING_COPY.annual}
        </p>
      </Reveal>
    </section>
  );
}

function PlanCard({ plan, cta }: { plan: PlanDefinition; cta: { href: string; label: string } }) {
  const featured = plan.recommended;
  const external = cta.href.startsWith("http");
  return (
    <div
      className={
        featured
          ? "relative flex flex-col rounded-3xl bg-ink p-7 text-bg transition-all duration-300 hover:-translate-y-1.5 hover:shadow-2xl"
          : "flex flex-col rounded-3xl border border-border bg-surface p-7 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg"
      }
    >
      {featured && (
        <span className="absolute -top-3 left-7 rounded-full bg-lime px-3 py-1 text-[0.65rem] font-bold uppercase text-lime-ink">Mais escolhido</span>
      )}
      <h3 className="font-serif text-lg">{plan.name}</h3>
      <div className={`mt-2 text-xs ${featured ? "opacity-60" : "text-muted"}`}>
        {PRICING_COPY.launchPriceLabel}{" "}
        <s aria-label={`De ${formatPlanPriceBrl(plan.listPriceBrlCents)} por mês`}>{formatPlanPriceBrl(plan.listPriceBrlCents)}</s>
      </div>
      <div className={`font-mono text-3xl ${featured ? "" : "text-ink"}`}>
        {formatPlanPriceBrl(plan.priceBrlCents)}
        <span className={`font-sans text-sm ${featured ? "opacity-60" : "text-muted"}`}>/mês</span>
      </div>
      <ul className={`mt-5 flex flex-1 flex-col gap-2 text-sm ${featured ? "opacity-90" : "text-ink-soft"}`}>
        {planHighlights(plan).map((item) => (
          <li key={item}>— {item}</li>
        ))}
      </ul>
      <a
        href={cta.href}
        target={external ? "_blank" : undefined}
        rel={external ? "noopener noreferrer" : undefined}
        className={`mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition-all duration-200 hover:-translate-y-0.5 hover:opacity-85 hover:shadow-lg active:translate-y-0 ${
          featured ? "bg-lime text-lime-ink" : "bg-ink text-lime"
        }`}
      >
        {cta.label}
      </a>
    </div>
  );
}
