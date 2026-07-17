# API Contracts

```typescript
type ApiError = {
  code: string;
  message: string;
  supportCode: string;
  fieldErrors?: Record<string, string[]>;
};

type NormalizedMessage = {
  tenantId: string;
  connectionId: string;
  provider: "WHATSAPP" | "INSTAGRAM" | "FACEBOOK";
  externalEventId: string;
  externalMessageId: string;
  externalConversationId?: string;
  externalContactId: string;
  direction: "INBOUND" | "OUTBOUND";
  origin:
    | "META_CUSTOMER"
    | "META_WHATSAPP_APP_HUMAN"
    | "CHATWOOT_HUMAN"
    | "REALWISE_AI"
    | "REALWISE_SYSTEM";
  text: string | null;
  attachments: Array<{
    type: string;
    externalId?: string;
    mimeType?: string;
    size?: number;
  }>;
  occurredAt: string;
};
```

All APIs use versioned schemas, tenant authorization, correlation IDs, bounded pagination, and safe errors. Valid webhooks return quickly after durable acceptance.
