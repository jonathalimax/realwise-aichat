import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from "@nestjs/common";
import { BusinessSessionGuard } from "../../common/guards/business-session.guard";
import { InternalTokenGuard } from "../../common/guards/internal-token.guard";
import { RateLimitGuard } from "../../common/guards/rate-limit.guard";
import { CurrentMember } from "../../common/decorators/current-business.decorator";
import { PermissionsGuard } from "../access/permissions.guard";
import { RequirePermission } from "../access/permission.decorator";
import type { MemberContext } from "../access/member-context";
import { OrdersService } from "./orders.service";

@Controller("orders")
@UseGuards(BusinessSessionGuard, PermissionsGuard)
@RequirePermission("pedidos", "view")
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@CurrentMember() m: MemberContext, @Query() q: { status?: string; fulfillment?: string; q?: string; limit?: string; cursor?: string }) {
    return this.orders.list(m, q);
  }

  // Declared before ":id" so "couriers" is never read as an order id.
  @Get("couriers")
  couriers(@CurrentMember() m: MemberContext) {
    return this.orders.couriers(m.businessId);
  }

  @Get(":id")
  get(@CurrentMember() m: MemberContext, @Param("id") id: string) {
    return this.orders.get(m, id);
  }

  @RequirePermission("pedidos", "edit")
  @Post(":id/confirm")
  confirm(@CurrentMember() m: MemberContext, @Param("id") id: string) {
    return this.orders.transition(m, id, "confirm");
  }

  @RequirePermission("pedidos", "edit")
  @Post(":id/out")
  out(@CurrentMember() m: MemberContext, @Param("id") id: string) {
    return this.orders.transition(m, id, "out");
  }

  @RequirePermission("pedidos", "edit")
  @Post(":id/done")
  done(@CurrentMember() m: MemberContext, @Param("id") id: string) {
    return this.orders.transition(m, id, "done");
  }

  @RequirePermission("pedidos", "edit")
  @Post(":id/cancel")
  cancel(@CurrentMember() m: MemberContext, @Param("id") id: string, @Body() body: { reasonCode?: string; note?: string }) {
    return this.orders.transition(m, id, "cancel", body ?? {});
  }

  @RequirePermission("pedidos", "edit")
  @Put(":id/courier")
  courier(@CurrentMember() m: MemberContext, @Param("id") id: string, @Body("memberId") memberId: string | null) {
    return this.orders.assignCourier(m, id, memberId ?? null);
  }
}

/** Customer-facing status page data. The unguessable token (24 random bytes) is the only credential. */
@Controller("public/orders")
export class PublicOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @UseGuards(RateLimitGuard)
  @Get(":statusToken")
  get(@Param("statusToken") statusToken: string) {
    return this.orders.publicStatus(statusToken);
  }
}

/** Called by apps/worker. */
@Controller("internal/pharmacy")
@UseGuards(InternalTokenGuard)
export class PharmacyOrderJobsController {
  constructor(private readonly orders: OrdersService) {}

  @Post("order-reminders")
  reminders() {
    return this.orders.runReminders();
  }

  @Post("stale-sheet")
  staleSheet() {
    return this.orders.runStaleSheetCheck();
  }
}
