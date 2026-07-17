import { describe, expect, it } from "vitest";
import { fakeAssistantDecision } from "./index";
import type { NormalizedMessage } from "@realwise/contracts";

const baseMessage: NormalizedMessage = {
  tenantId: "t1",
  connectionId: "c1",
  provider: "WHATSAPP",
  externalEventId: "e1",
  externalMessageId: "m1",
  externalContactId: "contact",
  direction: "INBOUND",
  origin: "META_CUSTOMER",
  text: "Quero agendar uma aula experimental",
  attachments: [],
  occurredAt: new Date().toISOString(),
};

describe("fakeAssistantDecision", () => {
  it("asks for preference instead of confirming appointments", () => {
    const decision = fakeAssistantDecision(baseMessage, [{ id: "s1", title: "Horários" }], { humanActive: false, aiEnabled: true });
    expect(decision.action).toBe("ASK_CLARIFYING_QUESTION");
    expect(decision.response).toContain("confirma");
  });

  it("hands off when user asks for a human", () => {
    const decision = fakeAssistantDecision({ ...baseMessage, text: "quero falar com atendente" }, [], { humanActive: false, aiEnabled: true });
    expect(decision.action).toBe("HANDOFF");
  });
});
