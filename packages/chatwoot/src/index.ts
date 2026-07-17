export type ChatwootInstallation = {
  tenantId: string;
  accountId: string;
  inboxId: string;
  status: "MOCK_PROVISIONED" | "READY_FOR_EXTERNAL_ACTIVATION" | "PRODUCTION_VERIFIED";
};

export type ChatwootClientConfig = {
  baseUrl: string;
  platformToken: string;
};

export function chatwootActivationState(config: Partial<ChatwootClientConfig>) {
  return config.baseUrl && config.platformToken ? "READY_FOR_EXTERNAL_ACTIVATION" : "IMPLEMENTED_NOT_VERIFIED";
}

export function buildMockChatwootInstallation(tenantId: string): ChatwootInstallation {
  const safeTenant = tenantId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 12) || "tenant";
  return {
    tenantId,
    accountId: `mock-account-${safeTenant}`,
    inboxId: `mock-inbox-${safeTenant}`,
    status: "MOCK_PROVISIONED",
  };
}
