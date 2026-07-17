import { Body, Controller, Get, Post } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { leads } from "@realwise/database";
import { DatabaseProvider } from "./database.provider";
import { TenantContext, type RequestTenantContext } from "./tenant-context";

const createLeadSchema = z.object({
  contactName: z.string().min(1),
  service: z.string().optional(),
  preferredTime: z.string().optional(),
  notes: z.string().optional(),
});

@Controller("leads")
export class LeadsController {
  constructor(private readonly databaseProvider: DatabaseProvider) {}

  @Get()
  async list(@TenantContext() context: RequestTenantContext) {
    const db = this.databaseProvider.optional();
    if (!db) {
      return [
        {
          id: "lead-1",
          tenantId: "demo-academia",
          contactName: "Marina Souza",
          service: "Muay Thai",
          preferredTime: "Terça à noite",
          notes: "Quer aula experimental; precisa confirmação humana.",
          status: "REQUESTED_APPOINTMENT",
          createdAt: new Date().toISOString(),
        },
      ];
    }
    return db.select().from(leads).where(eq(leads.tenantId, context.tenantId));
  }

  @Post()
  async create(@TenantContext() context: RequestTenantContext, @Body() body: unknown) {
    const input = createLeadSchema.parse(body);
    const db = this.databaseProvider.require();
    const [lead] = await db.insert(leads).values({ ...input, tenantId: context.tenantId, status: "NEW" }).returning();
    return lead;
  }
}
