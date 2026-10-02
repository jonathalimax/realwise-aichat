-- Prevent duplicate active/idle conversations per (businessId, visitorToken) under concurrent requests.
CREATE UNIQUE INDEX IF NOT EXISTS "Conversation_business_visitor_active_idx"
  ON "Conversation" ("businessId", "visitorToken")
  WHERE "status" IN ('active', 'idle');
