import { Controller, Get, Param, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { CalendarService } from "./calendar.service";
import { BusinessSessionGuard } from "../../common/guards/business-session.guard";
import { CurrentBusiness } from "../../common/decorators/current-business.decorator";
import { RateLimitGuard } from "../../common/guards/rate-limit.guard";
import type { BusinessSessionClaims } from "@realwise/auth";

@Controller("calendar")
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @UseGuards(BusinessSessionGuard)
  @Get(":businessId/auth-url")
  async authUrl(@Param("businessId") businessId: string, @CurrentBusiness() session: BusinessSessionClaims) {
    const result = this.calendar.getAuthUrl(session.businessId ?? businessId);
    if (!result.configured) {
      return { configured: false, message: "Google Calendar integration is not configured yet" };
    }
    return result;
  }

  @UseGuards(BusinessSessionGuard)
  @Get(":businessId/status")
  async status(@CurrentBusiness() session: BusinessSessionClaims) {
    const integration = await this.calendar.getIntegration(session.businessId);
    return { connected: Boolean(integration?.syncEnabled), connectedAt: integration?.connectedAt ?? null };
  }

  // No auth guard here by necessity (Google redirects the browser directly to this URL), so the
  // opaque, single-use `state` token — not the caller — is what proves which business this belongs to.
  @Get("oauth/callback")
  async oauthCallback(@Query("code") code: string, @Query("state") state: string, @Res() res: Response) {
    const dashboardUrl = process.env.DASHBOARD_URL ?? "http://localhost:3003";
    try {
      await this.calendar.handleOAuthCallback(state, code);
      res.redirect(`${dashboardUrl}/agenda?calendar=connected`);
    } catch {
      res.redirect(`${dashboardUrl}/agenda?calendar=error`);
    }
  }

  // Wrapped in an object (never a bare null body) so the client can always parse the JSON response,
  // even when calendar sync isn't connected.
  @UseGuards(RateLimitGuard)
  @Get(":businessId/slots")
  async slots(@Param("businessId") businessId: string, @Query("date") date: string) {
    const from = date ? new Date(date) : new Date();
    const to = new Date(from.getTime() + 14 * 24 * 60 * 60 * 1000);
    const slots = await this.calendar.getAvailableSlots(businessId, { from, to });
    return { slots };
  }
}
