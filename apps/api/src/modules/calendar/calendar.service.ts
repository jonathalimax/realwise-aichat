import { Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { google } from "googleapis";
import { PrismaService } from "../../prisma/prisma.service";
import { encryptSecret, decryptSecret } from "../../common/crypto";
import { AvailabilityService } from "../bookings/availability.service";
import { resolveVisitAppointmentType } from "../bookings/slot-generation";
import type { AppointmentType } from "@realwise/db";

const SCOPES = ["https://www.googleapis.com/auth/calendar"];
const STATE_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class CalendarService {
  // Single-use OAuth state tokens, keyed by the opaque token -> businessId that issued it.
  // In-memory is fine for a single-instance deploy; move to Redis/DB if the API ever scales out.
  private readonly pendingStates = new Map<string, { businessId: string; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
  ) {}

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
        accessToken: encryptSecret(tokens.access_token),
        refreshToken: encryptSecret(tokens.refresh_token),
        calendarId: "primary",
        syncEnabled: true,
      },
      update: {
        accessToken: encryptSecret(tokens.access_token),
        refreshToken: encryptSecret(tokens.refresh_token),
        syncEnabled: true,
        connectedAt: new Date(),
      },
    });
  }

  // Tokens stay encrypted outside this service — callers (e.g. the `status` endpoint) only need
  // connected/syncEnabled, never the raw credentials.
  async getIntegration(businessId: string) {
    return this.prisma.client.calendarIntegration.findUnique({ where: { businessId } });
  }

  private async calendarClient(integration: { accessToken: string; refreshToken: string }) {
    const client = this.oauthClient();
    client.setCredentials({
      access_token: decryptSecret(integration.accessToken),
      refresh_token: decryptSecret(integration.refreshToken),
    });
    return google.calendar({ version: "v3", auth: client });
  }

  // Returns null only when no availability rules exist at all, so callers fall back to free-text
  // date/time entry. Delegates slot expansion (recurring-rule expansion, timezone handling,
  // blackout dates, and existing-Appointment double-booking exclusion) to AvailabilityService —
  // this used to be Google-Calendar-only logic, which meant businesses without a connected
  // calendar never got real slots at all. When Google Calendar IS connected, additionally
  // exclude anything that overlaps a busy block on the owner's calendar.
  async getAvailableSlots(
    businessId: string,
    dateRange: { from: Date; to: Date },
    options: { appointmentType?: AppointmentType; listingId?: string | null } = {},
  ): Promise<{ start: string; end: string }[] | null> {
    const business = await this.prisma.client.business.findUnique({ where: { id: businessId } });
    // Same public-access rule as the chat widget itself (getBySlug) — only live businesses are
    // queryable, so this endpoint can't be used to probe/spam arbitrary/dead IDs.
    if (!business || business.status !== "live") return [];

    // Visits used to be hardcoded to "presencial" here while the scripted flow used "visita_local",
    // so a business that configured only one of them silently got no slots on the other path.
    const appointmentType =
      options.appointmentType ?? resolveVisitAppointmentType(await this.availability.configuredAppointmentTypes(businessId));
    const { configured, slots } = await this.availability.computeSlots(businessId, {
      appointmentType,
      listingId: options.listingId ?? null,
      from: dateRange.from,
      to: dateRange.to,
    });
    if (!configured) return null;
    if (slots.length === 0) return [];

    let busy: { start?: string | null; end?: string | null }[] = [];
    if (this.isConfigured()) {
      const integration = await this.prisma.client.calendarIntegration.findUnique({ where: { businessId } });
      if (integration?.syncEnabled) {
        const calendar = await this.calendarClient(integration);
        const freebusy = await calendar.freebusy.query({
          requestBody: {
            timeMin: dateRange.from.toISOString(),
            timeMax: dateRange.to.toISOString(),
            timeZone: business.timezone,
            items: [{ id: integration.calendarId }],
          },
        });
        busy = freebusy.data.calendars?.[integration.calendarId]?.busy ?? [];
      }
    }

    return slots
      .filter((slot) => {
        if (busy.length === 0) return true;
        const slotStart = new Date(slot.startsAt).getTime();
        const slotEnd = new Date(slot.endsAt).getTime();
        return !busy.some((b) => {
          const bStart = new Date(b.start ?? 0).getTime();
          const bEnd = new Date(b.end ?? 0).getTime();
          return slotStart < bEnd && slotEnd > bStart;
        });
      })
      .map((slot) => ({ start: slot.startsAt, end: slot.endsAt }));
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
