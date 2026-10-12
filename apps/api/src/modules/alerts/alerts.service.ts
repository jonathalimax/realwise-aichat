import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

export interface CreateAlertInput {
  type: string;
  severity?: "info" | "warning" | "critical";
  message: string;
  actionLabel?: string;
  actionHref?: string;
}

@Injectable()
export class AlertsService {
  constructor(private readonly prisma: PrismaService) {}

  async listActive(businessId: string) {
    return this.prisma.client.businessAlert.findMany({
      where: { businessId, dismissedAt: null },
      orderBy: { createdAt: "desc" },
    });
  }

  async dismiss(businessId: string, alertId: string) {
    const alert = await this.prisma.client.businessAlert.findUnique({ where: { id: alertId } });
    if (!alert) throw new NotFoundException("Alert not found");
    if (alert.businessId !== businessId) throw new ForbiddenException("Alert does not belong to this business");
    return this.prisma.client.businessAlert.update({ where: { id: alertId }, data: { dismissedAt: new Date() } });
  }

  // Generic — any module can raise an alert. Skips creating a duplicate if an active one of the
  // same type already exists, so repeated checks (e.g. per-conversation quota checks) don't spam.
  async createAlert(businessId: string, input: CreateAlertInput) {
    const existing = await this.prisma.client.businessAlert.findFirst({
      where: { businessId, type: input.type, dismissedAt: null },
    });
    if (existing) return existing;

    return this.prisma.client.businessAlert.create({
      data: {
        businessId,
        type: input.type,
        severity: input.severity ?? "warning",
        message: input.message,
        actionLabel: input.actionLabel,
        actionHref: input.actionHref,
      },
    });
  }
}
