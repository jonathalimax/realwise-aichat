// Shared types of the pharmacy chat engine: persisted conversation state, ports, UI payloads.

export type SaleClass = "unclassified" | "otc" | "prescription" | "controlled";
export type Fulfillment = "delivery" | "pickup";
export type Lane = "otc" | "rx" | "controlled" | "symptom" | "general" | "red_flag";
export type CheckoutStep = "contact" | "fulfillment" | "address" | "review" | "done";

/** The Product columns the engine needs (structural, so tests/ports need not import Prisma types). */
export interface ProductRow {
  id: string;
  businessId: string;
  name: string;
  presentation: string | null;
  manufacturer: string | null;
  activeIngredient: string | null;
  category?: string | null;
  ean?: string | null;
  priceCents: number;
  stockQty: number | null;
  stockAsOf: Date | null;
  saleClass: SaleClass;
  classConfirmedAt: Date | null;
  pharmacistRequired: boolean;
  maxQtyPerOrder: number | null;
  equivalentGroup: string | null;
  active: boolean;
  imageKey?: string | null;
  updatedAt?: Date | null;
}

export interface DeliveryArea {
  type: "district" | "cep_prefix";
  value: string;
}

export interface OpeningHoursEntry {
  key: string;
  label?: string;
  open: boolean;
  from?: string;
  to?: string;
}

/** PharmacySettings with defaults applied (a business without a row behaves like the schema defaults). */
export interface PharmacySettingsView {
  legalName: string | null;
  cnpj: string | null;
  pharmacistName: string | null;
  pharmacistCrf: string | null;
  deliveryAreas: DeliveryArea[];
  deliveryFeeCents: number;
  minOrderCents: number;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  autoConfirmEnabled: boolean;
  stockMaxAgeHours: number;
  openingHours: OpeningHoursEntry[];
  paymentMethods: string[];
  exchangePolicy: string | null;
  maxQtyPerItemDefault: number | null;
  quickChips: string[];
}

export interface CartLine {
  productId: string;
  qty: number;
  /** Set when the visitor picked an equivalent of an out-of-stock product: the pharmacist must confirm the swap. */
  viaEquivalentOf?: string;
}

export interface AddressSnapshot {
  cep: string;
  street: string;
  number: string;
  complement?: string | null;
  reference?: string | null;
  district: string;
  city: string;
  state: string;
}

export type Awaiting =
  | { kind: "product_name" }
  | { kind: "qty"; productId: string }
  | { kind: "phone" }
  | { kind: "name" }
  | { kind: "email" }
  | { kind: "contact_consent" }
  | { kind: "saved_address" }
  | { kind: "cep" }
  | { kind: "street_manual" }
  | { kind: "number" }
  | { kind: "complement" }
  | { kind: "reference" }
  | { kind: "fulfillment" }
  | { kind: "order_confirm" }
  | { kind: "symptom_consent" }
  | { kind: "symptom_answer"; step: SymptomStep }
  | { kind: "symptom_phone" }
  | { kind: "symptom_name" }
  | { kind: "product_request" }
  | { kind: "product_request_consent" }
  | { kind: "rx_upload" }
  /** "Falar com atendente": the next free text is a non-clinical question for the staff (general_question handoff). */
  | { kind: "attendant_question" }
  | { kind: "question_phone" }
  | { kind: "question_name" };

export type SymptomStep =
  | "symptom"
  | "duration"
  | "severity"
  | "for_whom"
  | "age"
  | "pregnancy"
  | "allergies"
  | "other_medicines"
  | "already_tried";

export interface SymptomAnswers {
  symptom?: string;
  duration?: string;
  severity?: string;
  forWhom?: string;
  age?: string;
  pregnancy?: string;
  allergies?: string;
  otherMedicines?: string;
  alreadyTried?: string;
}

export interface HumanJoined {
  memberId: string;
  name: string;
  roleName: string;
}

export interface PharmacyState {
  v: 1;
  lane: Lane | null;
  cart: CartLine[];
  /** Prescription-class lines waiting for an uploaded prescription (they are NOT in the cart yet). */
  pendingRx: CartLine[];
  checkoutStep: CheckoutStep | null;
  awaiting: Awaiting | null;
  /** Quantity the visitor asked for before having to pick between several matching products ("quero 2 dipirona"). */
  pendingQty?: number;
  contact: {
    phone?: string;
    name?: string;
    email?: string;
    emailSkipped?: boolean;
    consent?: boolean;
    leadId?: string;
    returningFirstName?: string;
  };
  fulfillment?: Fulfillment;
  /** Full address used for the order (the visitor typed it, or confirmed their saved one). */
  address?: AddressSnapshot;
  addressDiffersFromSaved?: boolean;
  /** Saved default (full) offered for confirmation to a recognized customer; never shown unmasked. */
  savedAddressId?: string;
  addressDraft?: Partial<AddressSnapshot> & { replaceDefault?: boolean; needsStreet?: boolean; manual?: boolean };
  order?: { id: string; code: string; status: string; statusUrl: string; totalCents: number } | null;
  symptom?: {
    active: boolean;
    consent: boolean;
    step: SymptomStep;
    answers: SymptomAnswers;
    /** First message of the visitor, held until consent is given (never processed before). */
    pendingText?: string;
    /** Started by a medicine-use question ("posso dar X para meu filho?"), not by a symptom: the intro says so. */
    medQuestion?: boolean;
    /** Started by "quero falar com o farmacêutico" (no symptom told yet): the intro is an invitation, not condolences. */
    directRequest?: boolean;
    startedAt: string;
    /** The WhatsApp question (before the handoff) was asked / the customer chose to stay in the web chat only. */
    contactAsked?: boolean;
    contactDeclined?: boolean;
  };
  handoffId?: string | null;
  /** Attendance mode: what the customer asked about (their own words, max 5), sent to the pharmacist as a product_request handoff. */
  productRequests?: string[];
  /** Attendance mode: text held until the customer agrees to register it. */
  pendingProductRequest?: string;
  redFlagAt?: string | null;
  humanJoined: HumanJoined[];
  /** Consent purposes the visitor already granted (this conversation and, once recognized, their lead): never asked twice. */
  consents?: string[];
  /** Address confirmed in this conversation: reused by later checkouts instead of asking again. */
  knownAddress?: { address: AddressSnapshot; masked: boolean; differsFromSaved: boolean } | null;
  /** Cart line the visitor edits by text ("mais um", "tira um", "só 1"): the focused product or the last one added. */
  lastAddedId?: string | null;
  /** Latest pharmacist suggestion message already turned into a cart (so "Fazer um pedido" goes back to the catalog). */
  suggestionHandledId?: string | null;
  /** Open general_question handoff waiting for the visitor's phone/name (non-clinical question for the staff). */
  questionHandoffId?: string | null;
  /** The visitor chose to receive the team's answer only in the chat (no phone asked again). */
  questionContactDeclined?: boolean;
  /** The WhatsApp offer for a team question was already made in this conversation (never asked twice). */
  questionPhoneAsked?: boolean;
  /** Product under discussion: drives "Adicionar ao carrinho" and the pharmacist follow-up chips. */
  focus?: { productId: string; kind: "otc" | "controlled" | "unclassified" | "pharmacist_required" | "out_of_stock" } | null;
  /** Equivalents offered (flagged by the pharmacy) for an out-of-stock product: choosing one forces pharmacist confirmation. */
  equivalentOffer?: { forProductId: string; ids: string[] } | null;
  /** The address shown in the review was a saved one the visitor only saw masked: keep it masked there too. */
  addressMasked?: boolean;
}

export function emptyState(): PharmacyState {
  return {
    v: 1,
    lane: null,
    cart: [],
    pendingRx: [],
    checkoutStep: null,
    awaiting: null,
    contact: {},
    humanJoined: [],
  };
}

export interface CartItemDto {
  productId: string;
  name: string;
  qty: number;
  unitPriceCents: number;
  lineTotalCents: number;
  imageUrl: string | null;
  /** Per-order limit of the product (the widget's "+" stops there). */
  maxQty?: number;
}

export interface CartDto {
  items: CartItemDto[];
  itemCount: number;
  subtotalCents: number;
  requiresPrescription: boolean;
}

export interface ConsentCard {
  purpose: string;
  version: string;
  text: string;
  required: boolean;
}

export type UiPayload = Record<string, unknown> & { type: string };

export interface OutMessage {
  text: string;
  ui?: UiPayload | null;
}

export interface PharmacyView {
  /** Effective operation mode: "attendance" = no cart/products in the widget. */
  operationMode?: "commerce" | "attendance";
  lane: Lane | null;
  cart: CartDto;
  checkoutStep: CheckoutStep | null;
  orderCode: string | null;
  statusUrl: string | null;
  humanJoined: HumanJoined[];
  /** A handoff (pharmacist or team question) is waiting for an answer: the widget keeps polling for the reply. */
  handoffOpen?: boolean;
}

export interface PharmacyTurnResult {
  message: any;
  messages: any[];
  suggestions?: string[];
  pharmacy: PharmacyView;
  escalated: false;
}

// ---------------------------------------------------------------------------------------------
// Ports (narrow interfaces; Prisma-direct default implementations live in ports.ts).
// ---------------------------------------------------------------------------------------------

export interface CreateOrderInput {
  businessId: string;
  leadId: string;
  conversationId: string;
  fulfillment: Fulfillment;
  items: { productId: string; qty: number; viaEquivalentOf?: string }[];
  address?: AddressSnapshot;
  prescriptionIds?: string[];
  notes?: string;
  /** The chat decided this order must wait for the pharmacist (equivalent chosen, address outside area, ...). */
  requirePharmacist?: boolean;
  /** Reason codes explaining requirePharmacist (stored in notes, never health data). */
  requireReasons?: string[];
  addressDiffersFromSaved?: boolean;
}

export interface CreatedOrder {
  id: string;
  code: string;
  number: number;
  status: "confirmed" | "pending_pharmacist";
  statusToken: string;
  autoConfirmed: boolean;
  hasPrescription: boolean;
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  /** true when the catalog sheet was older than stockMaxAgeHours (or unknown) at order time. */
  staleSheet: boolean;
  /** Why the order was not auto-confirmed (empty when it was). */
  pendingReasons: string[];
}

/** What 2b's `OrdersService.createFromCart` must satisfy (API.md 8.3) for the chat to swap implementations. */
export interface PharmacyOrdersPort {
  createFromCart(input: CreateOrderInput): Promise<CreatedOrder>;
  /** true when the implementation already writes alerts/notifications itself (2b's OrdersService does). */
  readonly handlesNotifications?: boolean;
}

export interface CreateHandoffInput {
  businessId: string;
  conversationId: string;
  leadId?: string | null;
  reason: "symptom" | "rx" | "controlled" | "out_of_stock" | "product_request" | "general_question" | "other";
  urgent: boolean;
  summary: string;
  brief: Record<string, unknown>;
}

export interface PharmacyHandoffsPort {
  create(input: CreateHandoffInput): Promise<{ id: string; reused: boolean }>;
}

export type PharmacyEvent =
  | { type: "new_order"; businessId: string; orderCode: string; status: string }
  | { type: "new_handoff"; businessId: string; handoffId: string; urgent: boolean; reason: string };

export interface PharmacyNotifierPort {
  notify(event: PharmacyEvent): Promise<void>;
}

export const PHARMACY_ORDERS_PORT = Symbol("PHARMACY_ORDERS_PORT");
export const PHARMACY_HANDOFFS_PORT = Symbol("PHARMACY_HANDOFFS_PORT");
export const PHARMACY_NOTIFIER_PORT = Symbol("PHARMACY_NOTIFIER_PORT");
