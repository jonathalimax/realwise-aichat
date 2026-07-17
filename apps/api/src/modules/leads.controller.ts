import { Controller, Get } from "@nestjs/common";

@Controller("leads")
export class LeadsController {
  @Get()
  list() {
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
}
