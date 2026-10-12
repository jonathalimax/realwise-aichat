import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@realwise/db";
import { PrismaService } from "../../prisma/prisma.service";
import { LeadsService } from "./leads.service";
import {
  applyEngagementEvent,
  coerceEngagementState,
  renderTeamSummary,
  type EngagementEvent,
  type TeamSummary,
} from "./engagement-summary";

// Persists engagement events into Conversation.engagementState, re-renders the team summary on
// every event, and mirrors it onto the linked Lead (summary, intent, ranked interests, waitingFor)
// so a human can pick the conversation up with full context from the dashboard.
//
// Callers fire-and-forget (`record(...)` never throws) — the summary must never slow down or fail
// the visitor-facing reply. Writes for the same conversation are serialized through an in-process
// promise chain so two events landing together (e.g. a budget mention and an escalation in the
// same turn) can't overwrite each other's read-modify-write. This assumes a single API process,
// which matches the current deployment (one api container).
@Injectable()
export class TeamSummaryService {
  private readonly logger = new Logger(TeamSummaryService.name);
  private readonly chains = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly leads: LeadsService,
  ) {}

  record(businessId: string, conversationId: string, events: EngagementEvent[]): Promise<void> {
    if (events.length === 0) return Promise.resolve();
    const previous = this.chains.get(conversationId) ?? Promise.resolve();
    const next = previous
      .then(() => this.apply(businessId, conversationId, events))
      .catch((error) => {
        this.logger.warn(`team summary update failed for conversation ${conversationId}: ${error instanceof Error ? error.message : String(error)}`);
      });
    this.chains.set(conversationId, next);
    void next.finally(() => {
      if (this.chains.get(conversationId) === next) this.chains.delete(conversationId);
    });
    return next;
  }

  async getState(businessId: string, conversationId: string) {
    const conversation = await this.prisma.client.conversation.findFirst({
      where: { id: conversationId, businessId },
      select: { engagementState: true },
    });
    return coerceEngagementState(conversation?.engagementState);
  }

  private async apply(businessId: string, conversationId: string, events: EngagementEvent[]) {
    const conversation = await this.prisma.client.conversation.findFirst({
      where: { id: conversationId, businessId },
      select: { id: true, leadId: true, engagementState: true },
    });
    if (!conversation) return;

    const now = new Date();
    let state = coerceEngagementState(conversation.engagementState);
    for (const event of events) state = applyEngagementEvent(state, event, now);
    const summary = renderTeamSummary(state, now);

    await this.prisma.client.conversation.update({
      where: { id: conversationId },
      data: {
        engagementState: state as unknown as Prisma.InputJsonValue,
        teamSummary: summary as unknown as Prisma.InputJsonValue,
        teamSummaryUpdatedAt: now,
      },
    });

    if (conversation.leadId) {
      await this.syncLead(businessId, conversation.leadId, conversationId, summary);
      if (events.some((e) => e.type === "visit_scheduled")) {
        await this.leads.advanceStatus(businessId, conversation.leadId, "visit_scheduled");
      }
    }
  }

  private async syncLead(businessId: string, leadId: string, conversationId: string, summary: TeamSummary) {
    const lead = await this.prisma.client.lead.findFirst({ where: { id: leadId, businessId }, select: { id: true, sourceConversationId: true } });
    if (!lead) return;
    await this.prisma.client.lead.update({
      where: { id: leadId },
      data: {
        summary: summary as unknown as Prisma.InputJsonValue,
        summaryUpdatedAt: new Date(summary.updatedAt),
        ...(summary.intent ? { intent: summary.intent } : {}),
        interestListingIds: summary.rankedListings.map((l) => l.id),
        waitingFor: summary.waitingFor,
        ...(lead.sourceConversationId ? {} : { sourceConversationId: conversationId }),
      },
    });
    await this.leads.recomputeScoreForLead(businessId, leadId);
  }

  // Called right after a visitor identifies (name/WhatsApp/email captured) — the conversation's
  // summary was built while it was still anonymous, so copy it onto the freshly linked lead.
  syncLeadFromLatestConversation(businessId: string, leadId: string): Promise<void> {
    return (async () => {
      const conversation = await this.prisma.client.conversation.findFirst({
        where: { businessId, leadId, teamSummary: { not: Prisma.DbNull } },
        orderBy: { lastMessageAt: "desc" },
        select: { id: true, teamSummary: true },
      });
      if (!conversation?.teamSummary) return;
      await this.syncLead(businessId, leadId, conversation.id, conversation.teamSummary as unknown as TeamSummary);
    })().catch((error) => {
      this.logger.warn(`lead summary sync failed for lead ${leadId}: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
}
