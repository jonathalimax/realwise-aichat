import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import Stripe from "stripe";
import { PrismaService } from "../../prisma/prisma.service";
import { isPlanCode } from "@realwise/shared";
import { buildPublicPlans } from "./public-plans";
import {
  MissingStripePriceError,
  UnknownPlanError,
  missingStripePriceEnvVars,
  planCodeForStripePriceId,
  resolveStripePriceId,
} from "./stripe-prices";

// A business in one of these states already has a live Stripe subscription — a second checkout
// would create a second subscription (double billing), so plan changes go through the portal.
const LIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "past_due"]);

@Injectable()
export class BillingService {
  private readonly stripe: Stripe;
  private readonly logger = new Logger(BillingService.name);

  constructor(private readonly prisma: PrismaService) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY must be set");
    this.stripe = new Stripe(key);
    const missing = missingStripePriceEnvVars();
    if (missing.length > 0) {
      this.logger.error(`Stripe plan prices not configured: ${missing.join(", ")} — checkout for those plans will fail until set`);
    }
  }

  async listPlans() {
    const rows = await this.prisma.client.plan.findMany({ select: { code: true, isActive: true } });
    return buildPublicPlans(rows);
  }

  async createCheckoutSession(businessId: string, planCode: string) {
    if (!isPlanCode(planCode)) throw new BadRequestException("Plano inválido");
    const [business, plan, subscription] = await Promise.all([
      this.prisma.client.business.findUnique({ where: { id: businessId } }),
      this.prisma.client.plan.findUnique({ where: { code: planCode } }),
      this.prisma.client.subscription.findUnique({ where: { businessId } }),
    ]);
    if (!business || !plan || !plan.isActive) throw new NotFoundException("Business or plan not found");
    if (subscription && LIVE_SUBSCRIPTION_STATUSES.has(subscription.status)) {
      throw new BadRequestException("Você já tem uma assinatura ativa. Para trocar de plano, use \"Gerenciar assinatura\".");
    }

    let priceId: string;
    try {
      priceId = resolveStripePriceId(plan.code);
    } catch (error) {
      if (error instanceof MissingStripePriceError || error instanceof UnknownPlanError) {
        this.logger.error(error.message);
        throw new ServiceUnavailableException("O pagamento deste plano ainda não está disponível. Fale com a gente para assinar.");
      }
      throw error;
    }

    // Setup is always free: the only line item is the plan's monthly recurring price.
    const session = await this.stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: undefined,
      client_reference_id: businessId,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { metadata: { businessId, planCode } },
      success_url: `${process.env.DASHBOARD_URL}/billing?checkout=success`,
      cancel_url: `${process.env.DASHBOARD_URL}/billing`,
    });

    return { url: session.url };
  }

  async createPortalSession(businessId: string) {
    const subscription = await this.prisma.client.subscription.findUnique({ where: { businessId } });
    if (!subscription) throw new NotFoundException("Nenhuma assinatura encontrada para este negócio");
    try {
      const session = await this.stripe.billingPortal.sessions.create({
        customer: subscription.stripeCustomerId,
        return_url: `${process.env.DASHBOARD_URL}/billing`,
      });
      return { url: session.url };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Stripe.errors.StripeError
          ? `Não foi possível abrir o portal de cobrança: ${error.message}`
          : "Não foi possível abrir o portal de cobrança",
      );
    }
  }

  constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET must be set");
    return this.stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  }

  async handleWebhookEvent(event: Stripe.Event) {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const businessId = session.client_reference_id;
        if (!businessId || !session.subscription || !session.customer) break;

        const subscription = await this.stripe.subscriptions.retrieve(session.subscription as string);
        const planCode = subscription.metadata.planCode;
        const plan = planCode ? await this.prisma.client.plan.findUnique({ where: { code: planCode } }) : null;
        if (!plan) break;

        await this.prisma.client.subscription.upsert({
          where: { businessId },
          update: {
            planId: plan.id,
            stripeCustomerId: session.customer as string,
            stripeSubscriptionId: subscription.id,
            status: "active",
            currentPeriodStart: new Date(subscription.current_period_start * 1000),
            currentPeriodEnd: new Date(subscription.current_period_end * 1000),
          },
          create: {
            businessId,
            planId: plan.id,
            stripeCustomerId: session.customer as string,
            stripeSubscriptionId: subscription.id,
            status: "active",
            currentPeriodStart: new Date(subscription.current_period_start * 1000),
            currentPeriodEnd: new Date(subscription.current_period_end * 1000),
          },
        });
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        // A plan switch made in the Stripe billing portal changes the subscription's price — map
        // it back to our plan via the STRIPE_PRICE_* env vars. Unknown/legacy prices leave planId as is.
        const switchedPlanCode = planCodeForStripePriceId(subscription.items?.data?.[0]?.price?.id);
        const switchedPlan = switchedPlanCode
          ? await this.prisma.client.plan.findUnique({ where: { code: switchedPlanCode } })
          : null;
        await this.prisma.client.subscription.updateMany({
          where: { stripeSubscriptionId: subscription.id },
          data: {
            status: subscription.status as any,
            currentPeriodEnd: new Date(subscription.current_period_end * 1000),
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
            ...(switchedPlan ? { planId: switchedPlan.id } : {}),
          },
        });
        break;
      }
    }
  }
}
