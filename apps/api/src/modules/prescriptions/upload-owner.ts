/**
 * Who may upload a prescription into a conversation, and which lead it is attached to.
 *
 * A pharmacy visitor asking for a prescription medicine is asked for the photo BEFORE the checkout
 * asks for the phone number, so the visitor is often still anonymous (no lead). That is allowed as
 * long as the visitor session owns the conversation (anonymous token or lead). The upload is stored
 * with the conversation's lead when one exists (the checkout step may already have identified the
 * customer) or with a null lead; `OrdersService.createFromCart` accepts both and stamps the lead on
 * the prescription when the order is created.
 */
export interface UploadVisitor {
  businessId?: string;
  leadId?: string | null;
  visitorToken?: string | null;
}

export interface UploadConversation {
  id: string;
  leadId: string | null;
  visitorToken: string;
}

export type UploadOwnerVerdict = { ok: true; leadId: string | null } | { ok: false; reason: "no_session" | "not_owner" };

export function resolveUploadOwner(businessId: string, visitor: UploadVisitor | null | undefined, conversation: UploadConversation | null): UploadOwnerVerdict {
  // Anonymous sessions carry only a visitorToken (no businessId); identified ones carry the business they were issued for.
  if (!visitor || (visitor.businessId && visitor.businessId !== businessId) || (!visitor.leadId && !visitor.visitorToken)) return { ok: false, reason: "no_session" };
  if (!conversation) return { ok: false, reason: "not_owner" };
  const owns = (!!visitor.leadId && conversation.leadId === visitor.leadId) || (!!visitor.visitorToken && conversation.visitorToken === visitor.visitorToken);
  if (!owns) return { ok: false, reason: "not_owner" };
  return { ok: true, leadId: visitor.leadId ?? conversation.leadId ?? null };
}
