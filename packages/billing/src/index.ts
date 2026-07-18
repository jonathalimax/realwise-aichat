export type BillingSessionKind = "CHECKOUT" | "PORTAL";

export type BillingActivation = "IMPLEMENTED_NOT_VERIFIED" | "READY_FOR_EXTERNAL_ACTIVATION";

export function stripeActivationState(secretKey?: string, webhookSecret?: string): BillingActivation {
  return secretKey && webhookSecret ? "READY_FOR_EXTERNAL_ACTIVATION" : "IMPLEMENTED_NOT_VERIFIED";
}

export function buildMockBillingSession(input: { tenantId: string; kind: BillingSessionKind; sessionId: string }) {
  return {
    id: input.sessionId,
    tenantId: input.tenantId,
    kind: input.kind,
    url: `/app?billing_session=${input.sessionId}`,
    status: "MOCK_CREATED" as const,
  };
}
