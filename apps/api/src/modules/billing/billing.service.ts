import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import Stripe from "stripe";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class BillingService {
  private readonly stripe: Stripe;

  constructor(private readonly prisma: PrismaService) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY must be set");
    this.stripe = new Stripe(key);
  }

  async listPlans() {
    return this.prisma.client.plan.findMany({ where: { isActive: true } });
  }

  async createCheckoutSession(businessId: string, planCode: string) {
    const [business, plan] = await Promise.all([
      this.prisma.client.business.findUnique({ where: { id: businessId } }),
      this.prisma.client.plan.findUnique({ where: { code: planCode } }),
    ]);
    if (!business || !plan) throw new NotFoundException("Business or plan not found");

    const session = await this.stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: undefined,
      client_reference_id: businessId,
      line_items: [
        { price: plan.stripeSetupPriceId, quantity: 1 },
        { price: plan.stripePriceId, quantity: 1 },
      ],
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
            stripeCustomerId: session.customer as string,
            stripeSubscriptionId: subscription.id,
            status: "active",
            currentPeriodStart: new Date(subscription.current_period_start * 1000),
            currentPeriodEnd: new Date(subscription.current_period_end * 1000),
            setupFeePaidAt: new Date(),
          },
          create: {
            businessId,
            planId: plan.id,
            stripeCustomerId: session.customer as string,
            stripeSubscriptionId: subscription.id,
            status: "active",
            currentPeriodStart: new Date(subscription.current_period_start * 1000),
            currentPeriodEnd: new Date(subscription.current_period_end * 1000),
            setupFeePaidAt: new Date(),
          },
        });
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await this.prisma.client.subscription.updateMany({
          where: { stripeSubscriptionId: subscription.id },
          data: {
            status: subscription.status as any,
            currentPeriodEnd: new Date(subscription.current_period_end * 1000),
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
          },
        });
        break;
      }
    }
  }
}
