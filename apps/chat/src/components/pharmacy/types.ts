// Pharmacy chat payload types (docs/pharmacy/API.md 8.1 / 8.2). Everything is optional-ish on
// purpose: the renderers validate what they need and degrade to plain text when a payload is
// malformed or its `type` is unknown.

export interface MaskedAddress {
  id: string;
  label: string;
  street?: string;
  numberMasked?: string;
  district?: string;
  city?: string;
  state?: string;
  cepMasked?: string;
  isDefault?: boolean;
}

export interface ConsentCardData {
  purpose: "pharmacy_triage" | "prescription_upload" | "order_contact" | "pharmacy_contact";
  version?: string;
  text: string;
  required?: boolean;
}

export interface CartItem {
  productId: string;
  name: string;
  qty: number;
  unitPriceCents: number;
  lineTotalCents: number;
  imageUrl?: string | null;
}

export interface CartDto {
  items: CartItem[];
  itemCount: number;
  subtotalCents: number;
  requiresPrescription?: boolean;
}

export interface PharmacyHumanJoined {
  memberId?: string;
  name: string;
  roleName?: string;
}

export interface PharmacyState {
  /** Effective operation mode; "attendance" = no cart or product cards. */
  operationMode?: "commerce" | "attendance";
  lane?: "otc" | "rx" | "controlled" | "symptom" | "general" | null;
  cart?: CartDto | null;
  checkoutStep?: null | "contact" | "fulfillment" | "address" | "review" | "done";
  orderCode?: string | null;
  statusUrl?: string | null;
  humanJoined?: PharmacyHumanJoined[];
  handoffOpen?: boolean;
}

export interface MessageAuthor {
  memberId?: string;
  name: string;
  roleName?: string;
}

export type PharmacyUiPayload = { type: string; [key: string]: any };

export interface PharmacyActionResult {
  ok: boolean;
  error?: string;
}

export interface PharmacyUiContext {
  businessId: string;
  conversationId: string | null;
  // Forms are only live on the most recent card of their kind; older ones render disabled.
  interactive: boolean;
  busy: boolean;
  // Sends a structured visitor action. `echo` is the visitor bubble shown for the tap.
  onAction: (action: { type: string; [key: string]: unknown }, echo?: string) => Promise<PharmacyActionResult>;
  onRxUploaded: (code: string) => void;
}
