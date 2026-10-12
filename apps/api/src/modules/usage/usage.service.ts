import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

// Fallback used when a business has no active subscription/plan yet (e.g. still trialing).
const DEFAULT_CONVERSATION_QUOTA = 100;

@Injectable()
export class UsageService {
  constructor(private readonly prisma: PrismaService) {}

  async countConversationsThisMonth(businessId: string): Promise<number> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return this.prisma.client.conversation.count({
      where: { businessId, startedAt: { gte: startOfMonth } },
    });
  }

  async getConversationQuota(businessId: string): Promise<number> {
    const subscription = await this.prisma.client.subscription.findUnique({
      where: { businessId },
      include: { plan: true },
    });
    return subscription?.plan?.conversationQuota ?? DEFAULT_CONVERSATION_QUOTA;
  }
}
