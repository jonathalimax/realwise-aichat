import { Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { google } from "googleapis";
import { PrismaService } from "../../prisma/prisma.service";

const SCOPES = ["https://www.googleapis.com/auth/calendar"];
const STATE_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class CalendarService {
  // Single-use OAuth state tokens, keyed by the opaque token -> businessId that issued it.
  // In-memory is fine for a single-instance deploy; move to Redis/DB if the API ever scales out.
  private readonly pendingStates = new Map<string, { businessId: string; expiresAt: number }>();

  constructor(private readonly prisma: PrismaService) {}

  private issueState(businessId: string): string {
    const token = randomBytes(32).toString("base64url");
    this.pendingStates.set(token, { businessId, expiresAt: Date.now() + STATE_TTL_MS });
    return token;
  }

  // Single-use: consumes (deletes) the state token so a captured/replayed callback URL can't be reused.
  private consumeState(token: string): string {
    const entry = this.pendingStates.get(token);
    this.pendingStates.delete(token);
    if (!entry || entry.expiresAt < Date.now()) {
      throw new UnauthorizedException("Invalid or expired OAuth state");
    }
    return entry.businessId;
  }

  // Credentials are only present once the user configures Google Cloud OAuth — until then every
  // method below returns a clear "not configured" signal instead of touching Google at all.
  private isConfigured() {
    return Boolean(
      process.env.GOOGLE_CALENDAR_CLIENT_ID &&
        process.env.GOOGLE_CALENDAR_CLIENT_SECRET &&
        process.env.GOOGLE_CALENDAR_REDIRECT_URI,
    );
  }

  private oauthClient() {
    return new google.auth.OAuth2(
      process.env.GOOGLE_CALENDAR_CLIENT_ID,
      process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
      process.env.GOOGLE_CALENDAR_REDIRECT_URI,
    );
  }

  getAuthUrl(businessId: string): { configured: false } | { configured: true; url: string } {
    if (!this.isConfigured()) return { configured: false };
    const client = this.oauthClient();
    const url = client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: SCOPES,
      state: this.issueState(businessId),
    });
    return { configured: true, url };
  }

  async handleOAuthCallback(state: string, code: string) {
    if (!this.isConfigured()) throw new NotFoundException("Google Calendar integration not configured");
    const businessId = this.consumeState(state);
    const client = this.oauthClient();
    const { tokens } = await client.getToken(code);
    if (!tokens.access_token || !tokens.refresh_token) {
      throw new NotFoundException("Google did not return usable tokens");
    }

    return this.prisma.client.calendarIntegration.upsert({
      where: { businessId },
      create: {
        businessId,
        provider: "google",
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        calendarId: "primary",
        syncEnabled: true,
      },
      update: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        syncEnabled: true,
        connectedAt: new Date(),
      },
    });
  }

  async getIntegration(businessId: string) {
    return this.prisma.client.calendarIntegration.findUnique({ where: { businessId } });
  }

  private async calendarClient(integration: { accessToken: string; refreshToken: string }) {
    const client = this.oauthClient();
    client.setCredentials({ access_token: integration.accessToken, refresh_token: integration.refreshToken });
    return google.calendar({ version: "v3", auth: client });
  }

  // Returns null when calendar sync isn't connected/enabled so callers fall back to free-text date/time entry.
  async getAvailableSlots(businessId: string, dateRange: { from: Date; to: Date }): Promise<{ start: string; end: string }[] | null> {
    if (!this.isConfigured()) return null;
    const integration = await this.prisma.client.calendarIntegration.findUnique({ where: { businessId } });
    if (!integration || !integration.syncEnabled) return null;

    const business = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    const slotRules = await this.prisma.client.bookingSlot.findMany({ where: { businessId, isBlocked: false, kind: "recurring" } });
    if (!business || slotRules.length === 0) return [];

    const calendar = await this.calendarClient(integration);
    const freebusy = await calendar.freebusy.query({
      requestBody: {
        timeMin: dateRange.from.toISOString(),
        timeMax: dateRange.to.toISOString(),
        timeZone: business.timezone,
        items: [{ id: integration.calendarId }],
      },
    });
    const busy = freebusy.data.calendars?.[integration.calendarId]?.busy ?? [];

    const slots: { start: string; end: string }[] = [];
    for (const rule of slotRules) {
      if (!rule.startTime || !rule.endTime) continue;
      const day = new Date(dateRange.from);
      while (day <= dateRange.to) {
        if (day.getDay() === rule.weekday) {
          const [startH, startM] = rule.startTime.split(":").map(Number);
          const [endH, endM] = rule.endTime.split(":").map(Number);
          let cursor = new Date(day);
          cursor.setHours(startH, startM, 0, 0);
          const dayEnd = new Date(day);
          dayEnd.setHours(endH, endM, 0, 0);
          while (cursor.getTime() + rule.slotDurationMinutes * 60000 <= dayEnd.getTime()) {
            const slotStart = new Date(cursor);
            const slotEnd = new Date(cursor.getTime() + rule.slotDurationMinutes * 60000);
            const overlapsBusy = busy.some((b) => {
              const bStart = new Date(b.start ?? 0).getTime();
              const bEnd = new Date(b.end ?? 0).getTime();
              return slotStart.getTime() < bEnd && slotEnd.getTime() > bStart;
            });
            if (!overlapsBusy && slotStart > new Date()) {
              slots.push({ start: slotStart.toISOString(), end: slotEnd.toISOString() });
            }
            cursor = new Date(cursor.getTime() + rule.slotDurationMinutes * 60000);
          }
        }
        day.setDate(day.getDate() + 1);
      }
    }
    return slots;
  }

  // Additive side-effect of booking — if calendar isn't connected this is a no-op so the existing
  // booking flow is unaffected.
  async createEvent(businessId: string, appointment: { id: string; serviceName: string; startsAt: Date; endsAt: Date }) {
    if (!this.isConfigured()) return null;
    const integration = await this.prisma.client.calendarIntegration.findUnique({ where: { businessId } });
    if (!integration || !integration.syncEnabled) return null;

    const calendar = await this.calendarClient(integration);
    const event = await calendar.events.insert({
      calendarId: integration.calendarId,
      requestBody: {
        summary: appointment.serviceName,
        start: { dateTime: appointment.startsAt.toISOString() },
        end: { dateTime: appointment.endsAt.toISOString() },
      },
    });

    await this.prisma.client.appointment.update({
      where: { id: appointment.id },
      data: { externalCalendarEventId: event.data.id ?? undefined },
    });
    return event.data;
  }
}
