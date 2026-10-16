import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Post, UseGuards } from "@nestjs/common";
import type { VisitorSessionClaims } from "@realwise/auth";
import { CurrentVisitor } from "../../common/decorators/current-business.decorator";
import { AuthRateLimitGuard, RateLimitGuard } from "../../common/guards/rate-limit.guard";
import { VisitorSessionGuard } from "../../common/guards/visitor-session.guard";
import { CustomerProfileService, type SaveAddressInput } from "./customer-profile.service";

// Public (visitor-facing) customer-profile endpoints used by the chat widget. See docs/pharmacy/API.md.
@Controller("customers/:businessId")
@UseGuards(VisitorSessionGuard)
export class CustomersController {
  constructor(private readonly profile: CustomerProfileService) {}

  /** Phone-first recognition. Reveals only the first name + masked default address. Creates nothing. */
  @UseGuards(AuthRateLimitGuard)
  @Post("lookup")
  lookup(@Param("businessId") businessId: string, @Body("phone") phone: string) {
    return this.profile.recognizeByPhone(businessId, phone);
  }

  /** CEP -> street / district / city / state with ViaCEP then BrasilAPI fallback. */
  @UseGuards(RateLimitGuard)
  @Get("cep/:cep")
  async cep(@Param("cep") cep: string) {
    const outcome = await this.profile.lookupCep(cep);
    if (outcome.status === "invalid") throw new BadRequestException({ statusCode: 400, error: "Bad Request", code: "CEP_INVALID", message: "CEP inválido." });
    return outcome.status === "ok" ? { status: "ok", ...outcome.result } : { status: outcome.status };
  }

  /** The identified visitor's saved default address, masked (street number hidden). */
  @UseGuards(RateLimitGuard)
  @Get("me/address")
  async myAddress(@Param("businessId") businessId: string, @CurrentVisitor() visitor: VisitorSessionClaims & { visitorToken?: string }) {
    const leadId = this.requireLead(visitor, businessId);
    return { default: await this.profile.getMaskedDefault(businessId, leadId) };
  }

  /** Save an address (never silently overwrites the default; see CustomerProfileService.saveAddress). */
  @UseGuards(RateLimitGuard)
  @Post("me/addresses")
  async saveAddress(
    @Param("businessId") businessId: string,
    @CurrentVisitor() visitor: VisitorSessionClaims & { visitorToken?: string },
    @Body() body: SaveAddressInput,
  ) {
    const leadId = this.requireLead(visitor, businessId);
    const { address, isDefault, reused, differsFromSaved } = await this.profile.saveAddress(businessId, leadId, body ?? ({} as SaveAddressInput));
    return { address, isDefault, reused, differsFromSaved };
  }

  private requireLead(visitor: VisitorSessionClaims | undefined, businessId: string): string {
    if (!visitor?.leadId || visitor.businessId !== businessId) {
      throw new ForbiddenException({ statusCode: 403, error: "Forbidden", code: "VISITOR_NOT_IDENTIFIED", message: "Informe seu telefone primeiro." });
    }
    return visitor.leadId;
  }
}
