// Typed client for the pharmacy REST contract (docs/pharmacy/API.md). Field names match the contract exactly.
// Everything goes through `request` (credentials: include) so a 401 sends the user to /login and a 403 surfaces
// as ApiError { status: 403, code: "PERMISSION_DENIED" } which pages render as "Sem acesso".
import type { OperationModeInfo, PermissionLevel, PermissionSection } from "@realwise/shared";
import { request, requestForm } from "./api";

const qs = (params: Record<string, string | number | boolean | null | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};
const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });

// ---------------------------------------------------------------- shared types
export type Tone = "green" | "amber" | "gray" | "red" | "blue" | "soft";
export type PermissionMap = Record<PermissionSection, PermissionLevel>;
export interface Branding {
  primaryColor: string;
  secondaryColor: string;
  tertiaryColor: string;
}

export interface Me {
  member: { id: string; name: string; email: string | null; crf: string | null };
  role: { id: string; key: string | null; name: string; requiresCrf: boolean; ownDeliveriesOnly: boolean };
  permissions: PermissionMap;
  visibleSections: PermissionSection[];
  canPerformPharmacistActions: boolean;
  business: {
    id: string;
    name: string;
    slug: string;
    niche: "imobiliaria" | "concessionaria" | "farmacia";
    status: string;
    logoUrl: string | null;
    branding: Branding;
    brandingIsCustom: boolean;
    /** Pharmacy only: chosen + effective operation mode and the plan rule (null for other niches / older API). */
    operationMode?: OperationModeInfo | null;
  };
}

export const getAuthMe = (): Promise<Me> => request("/auth/me");
export const memberLogin = (email: string, password: string, businessSlug?: string): Promise<Me> =>
  request("/auth/member/login", json("POST", { email, password, businessSlug }));
export const forgotPassword = (email: string, businessSlug?: string) =>
  request("/auth/member/forgot-password", json("POST", { email, businessSlug }));
export const resetPassword = (token: string, password: string): Promise<Me> =>
  request("/auth/member/reset-password", json("POST", { token, password }));

// ---------------------------------------------------------------- notifications / alerts
export interface NotificationsSummary {
  orders?: { new: number; waitingOverMinutes: number };
  handoffs?: { open: number; urgent: number };
  prescriptions?: { pending: number };
  sheet?: { stale: boolean; ageHours: number | null };
}
export const getNotificationsSummary = (): Promise<NotificationsSummary> => request("/notifications/summary");
export interface BusinessAlert {
  id: string;
  type: string;
  severity: "info" | "warning" | "critical";
  message: string;
  actionLabel?: string | null;
  actionHref?: string | null;
  createdAt: string;
}
export const getAlerts = (): Promise<BusinessAlert[]> => request("/alerts");
export const dismissAlert = (id: string) => request(`/alerts/${id}/dismiss`, json("POST"));

// ---------------------------------------------------------------- dashboard summary / analytics
export interface Kpi {
  key: string;
  label: string;
  value: number;
  display: string;
  note?: string | null;
}
export interface ChartBucket {
  label: string;
  orders?: number;
  revenueCents?: number;
  delivery?: number;
  pickup?: number;
}
export type Range = "today" | "7d" | "30d";
export interface DashboardSummary {
  range: Range;
  generatedAt: string;
  /** Effective operation mode ("attendance": no orders, stock or catalog numbers). */
  mode?: "commerce" | "attendance";
  roleFocus: "orders" | "handoffs" | "deliveries";
  kpis: Kpi[];
  stock: { asOf: string | null; ageHours: number | null; maxAgeHours: number; stale: boolean; display: string } | null;
  needsAction: {
    orderId: string;
    code: string;
    customerName: string;
    totalCents: number;
    kindLabel: string;
    statusLabel: string;
    badge: Tone;
    reason: "new" | "validate_rx" | "stale_stock";
    waitingMinutes: number;
  }[];
  handoffs: { id: string; who: string; tag: string; badge: Tone; summary: string; createdAt: string }[];
  chart: { title: string; buckets: ChartBucket[] } | null;
  funnel: { conversations: number; carts: number; orders: number; conversionRate: number } | null;
  insights: { id: string; title: string; description: string; cta?: { label: string; href: string } | null }[];
}
export const getDashboardSummary = (range: Range): Promise<DashboardSummary> => request(`/dashboard/summary${qs({ range })}`);

export interface PharmacyAnalytics {
  range: Range;
  label: string;
  mode?: "commerce" | "attendance";
  kpis: Kpi[];
  chart: { buckets: ChartBucket[] };
  triage: { key: string; label: string; count: number; percent: number }[];
  topProducts: { productId: string; name: string; units: number; revenueCents: number }[];
  unmetDemand: { productId: string; name: string; requests: number }[];
}
export const getPharmacyAnalytics = (range: Range): Promise<PharmacyAnalytics> => request(`/analytics/pharmacy/overview${qs({ range })}`);

// ---------------------------------------------------------------- orders
export type OrderTab = "new" | "confirmed" | "out" | "done" | "canceled";
export interface OrderList {
  id: string;
  code: string;
  customer: { id: string; name: string };
  itemCount: number;
  totalCents: number;
  fulfillment: "delivery" | "pickup";
  kindLabel: string;
  hasPrescription: boolean;
  rxPending: boolean;
  status: string;
  statusLabel: string;
  statusBadge: Tone;
  tab: OrderTab;
  autoConfirmed: boolean;
  originLabel: string;
  createdAt: string;
  waitingMinutes: number;
  stale: boolean;
  addressDiffersFromSaved: boolean;
  needsAction: boolean;
}
export interface OrderDetail extends OrderList {
  customer: { id: string; name: string; phone: string | null; phoneFormatted: string | null; email: string | null };
  conversationId: string | null;
  address: {
    label: string;
    cep: string;
    street: string;
    number: string;
    complement: string | null;
    reference: string | null;
    district: string;
    city: string;
    state: string;
  } | null;
  items: {
    id: string;
    productId: string;
    name: string;
    qty: number;
    unitPriceCents: number;
    lineTotalCents: number;
    saleClass: string;
    classLabel: string;
    classBadge: Tone;
  }[];
  subtotalCents: number;
  deliveryFeeCents: number;
  paymentMethod: string;
  paymentLabel: string;
  notes: string | null;
  prescriptions: { id: string; code: string; status: RxStatus; statusLabel: string }[];
  stockSheet: { asOf: string | null; ageHours: number | null; stale: boolean } | null;
  courier: { id: string; name: string } | null;
  statusReason: string | null;
  timeline: { status: string; label: string; at: string; byName: string }[];
  allowedActions: ("confirm" | "out" | "done" | "cancel")[];
  actionLabels: Partial<Record<"confirm" | "out" | "done" | "cancel", string>>;
  cancelReasons: { code: CancelReason; label: string }[];
}
export type CancelReason = "out_of_stock" | "outside_area" | "customer_request" | "other";
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
export const getOrders = (p: { status?: OrderTab; fulfillment?: string; q?: string; cursor?: string; limit?: number }): Promise<Page<OrderList> & { counts: Record<OrderTab, number> }> =>
  request(`/orders${qs(p)}`);
export const getOrder = (id: string): Promise<OrderDetail> => request(`/orders/${id}`);
export const orderAction = (id: string, action: "confirm" | "out" | "done"): Promise<OrderDetail> => request(`/orders/${id}/${action}`, json("POST"));
export const cancelOrder = (id: string, reasonCode: CancelReason, note?: string): Promise<OrderDetail> =>
  request(`/orders/${id}/cancel`, json("POST", { reasonCode, note: note || undefined }));
export const getCouriers = (): Promise<{ items: { id: string; name: string }[] }> => request("/orders/couriers");
export const assignCourier = (id: string, memberId: string | null): Promise<OrderDetail> => request(`/orders/${id}/courier`, json("PUT", { memberId }));

// ---------------------------------------------------------------- prescriptions
export type RxStatus = "pending" | "approved" | "rejected";
export interface RxList {
  id: string;
  code: string;
  patientName: string | null;
  med: string;
  orderId: string | null;
  orderCode: string | null;
  createdAt: string;
  status: RxStatus;
  statusLabel: string;
  badge: Tone;
}
export interface RxDetail extends RxList {
  mimeType: string;
  fileUrl: string;
  fileAvailable: boolean;
  reviewedAt: string | null;
  reviewedByName: string | null;
  rejectReason: string | null;
  retentionDeleteAt: string | null;
  retentionLabel: string | null;
}
export const getPrescriptions = (p: { status?: RxStatus; q?: string; cursor?: string; limit?: number }): Promise<Page<RxList> & { counts: Record<RxStatus, number> }> =>
  request(`/prescriptions${qs(p)}`);
export const getPrescription = (id: string): Promise<RxDetail> => request(`/prescriptions/${id}`);
export const approvePrescription = (id: string): Promise<RxDetail> => request(`/prescriptions/${id}/approve`, json("POST"));
export const rejectPrescription = (id: string, reason: string): Promise<RxDetail> => request(`/prescriptions/${id}/reject`, json("POST", { reason }));
/** Same-origin-less fetch of the protected file as a blob (cookie auth). The caller must URL.revokeObjectURL. */
export async function fetchPrescriptionFile(fileUrl: string): Promise<{ url: string; mimeType: string }> {
  const { API_BASE_URL } = await import("./api");
  // fileUrl is returned as "/api/prescriptions/<id>/file"; API_BASE_URL already ends in /api.
  const path = fileUrl.startsWith("/api/") ? fileUrl.slice(4) : fileUrl;
  const res = await fetch(`${API_BASE_URL}${path}`, { credentials: "include", cache: "no-store" });
  if (res.status === 410) throw Object.assign(new Error("A foto desta receita já foi apagada."), { status: 410 });
  if (!res.ok) throw Object.assign(new Error("Não consegui abrir a foto da receita."), { status: res.status });
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), mimeType: blob.type };
}

// ---------------------------------------------------------------- handoffs
export type HandoffStatus = "open" | "answered" | "closed";
export interface HandoffList {
  id: string;
  who: string;
  customerName: string | null;
  urgent: boolean;
  tag: string;
  tagBadge: Tone;
  reason: string;
  reasonLabel: string;
  summary: string;
  status: HandoffStatus;
  createdAt: string;
  waitingMinutes: number;
  conversationId: string | null;
  /** "Em atendimento": someone started the hand-over (still status open). */
  inProgress?: { at: string; byMemberId: string | null; byName: string; byRole: string; channel: "whatsapp" | "chat" } | null;
  hasPhone?: boolean;
  /** Clinical handoff: only a member with a CRF can handle it. Availability checks (out of stock, product request) can be handled by any member with Atendimento edit. */
  requiresPharmacist?: boolean;
  /** Whether the current member may reply/start/close this handoff. */
  canHandle?: boolean;
}
export interface WhatsappDraft {
  customerFirstName: string | null;
  /** E.164 digits, e.g. 5541991112233. Only returned to members who can start an atendimento. */
  phone: string;
  message: string;
  /** Visitor resume link to the web chat (already the last line of `message`). */
  resumeLink?: string | null;
  maxChars: number;
  webUrl: string;
  appUrl: string;
}
export interface HandoffDetail extends HandoffList {
  contact?: { firstName: string | null; phone: string | null; phoneMasked: string | null; hasPhone: boolean };
  brief: Record<string, unknown>;
  /** The visitor accepted the health-data consent and the brief carries what they told us (false for "Só chamar o farmacêutico" and urgent red flags). */
  healthConsent?: boolean;
  briefRows: { label: string; value: string }[];
  suggestion: { label: string; text: string; products: { productId: string; name: string; reason: string; inStock: boolean; priceCents: number }[] } | null;
  conversationLink: string | null;
  answer: { text: string; at: string; byName: string; byRole: string } | null;
}
export const getHandoffs = (p: { status?: HandoffStatus; cursor?: string }): Promise<Page<HandoffList> & { counts: { open: number; answered: number; urgent: number } }> =>
  request(`/handoffs${qs(p)}`);
export const getHandoff = (id: string): Promise<HandoffDetail> => request(`/handoffs/${id}`);
export interface SuggestionItem {
  productId: string;
  name: string;
  presentation: string | null;
  priceCents: number;
  inStock: boolean;
  maxQty: number;
  imageUrl: string | null;
  placeholderIcon: "pill" | "bottle" | "box";
  requiresPrescription: boolean;
}
export const replyHandoff = (id: string, body: string | { text?: string; productIds?: string[]; note?: string }): Promise<HandoffDetail> =>
  request(`/handoffs/${id}/reply`, json("POST", typeof body === "string" ? { text: body } : body));
/** Listable products only (active, in stock, confirmed OTC / prescription). `ids` powers the "Usar sugestão" chips. */
export const searchSuggestableProducts = (p: { q?: string; ids?: string[] }): Promise<{ items: SuggestionItem[] }> =>
  request(`/handoffs/products/search${qs({ q: p.q, ids: p.ids?.join(",") })}`);
export const handoffChatLink = (id: string): Promise<{ url: string }> => request(`/handoffs/${id}/chat-link`, json("POST"));
export const closeHandoff = (id: string): Promise<HandoffDetail> => request(`/handoffs/${id}/close`, json("POST"));
export const whatsappDraft = (id: string): Promise<WhatsappDraft> => request(`/handoffs/${id}/whatsapp/draft`, json("POST"));
export const startHandoff = (id: string, channel: "whatsapp" | "chat"): Promise<HandoffDetail> => request(`/handoffs/${id}/start`, json("POST", { channel }));
export const markHandoffAnswered = (id: string): Promise<HandoffDetail> => request(`/handoffs/${id}/mark-answered`, json("POST"));

// ---------------------------------------------------------------- catalog
export type SaleClass = "unclassified" | "otc" | "prescription" | "controlled";
export interface Product {
  id: string;
  name: string;
  presentation: string | null;
  manufacturer: string | null;
  subtitle: string;
  ean: string | null;
  sku: string | null;
  activeIngredient: string | null;
  category: string | null;
  priceCents: number;
  stockQty: number;
  stockAsOf: string | null;
  saleClass: SaleClass;
  classLabel: string;
  classBadge: Tone;
  classProposed: SaleClass | null;
  classProposedBy: string | null;
  classProposedReason: string | null;
  classConfirmedAt: string | null;
  classConfirmedByName: string | null;
  needsReview: boolean;
  pharmacistRequired: boolean;
  maxQtyPerOrder: number | null;
  equivalentGroup: string | null;
  equivalents?: { id: string; name: string; stockQty: number; priceCents: number }[];
  imageUrl: string | null;
  placeholderIcon: "pill" | "bottle" | "box";
  orderable: boolean;
  warning: string;
  active: boolean;
  updatedAt: string;
}
export interface ProductCounts {
  all: number;
  unclassified: number;
  prescription: number;
  controlled: number;
  otc: number;
  outOfStock: number;
  inactive: number;
  /** Whole catalog, ignoring the search box. */
  unclassifiedAll: number;
}
export const getProducts = (p: { class?: string; stock?: string; active?: string; q?: string; cursor?: string; limit?: number; equivalentGroup?: string }): Promise<Page<Product> & { counts: ProductCounts }> =>
  request(`/products${qs(p)}`);
export const getProduct = (id: string): Promise<Product> => request(`/products/${id}`);
export type ProductPatch = Partial<
  Pick<Product, "name" | "presentation" | "manufacturer" | "ean" | "sku" | "activeIngredient" | "category" | "priceCents" | "stockQty" | "pharmacistRequired" | "maxQtyPerOrder" | "equivalentGroup" | "active">
>;
export const updateProduct = (id: string, patch: ProductPatch): Promise<Product> => request(`/products/${id}`, json("PATCH", patch));
export const setProductClass = (id: string, saleClass: SaleClass): Promise<Product> => request(`/products/${id}/class`, json("POST", { saleClass }));
export const uploadProductImage = (id: string, file: File): Promise<{ imageUrl: string }> => {
  const f = new FormData();
  f.append("file", file);
  return requestForm(`/products/${id}/image`, f);
};
export const deleteProductImage = (id: string) => request(`/products/${id}/image`, json("DELETE"));

// class review
export interface ClassGroup {
  key: "controlled" | "prescription" | "otc" | "unclassified";
  title: string;
  short: string;
  badge: Tone;
  hint: string;
  count: number;
  confirmedCount: number;
  done: boolean;
  canConfirm: boolean;
  samples: { id: string; name: string; by: string }[];
}
export const getClassReview = (): Promise<{ progress: { confirmed: number; total: number; percent: number }; groups: ClassGroup[] }> => request("/catalog/class-review");
export const getClassReviewProducts = (key: string, cursor?: string): Promise<Page<{ id: string; name: string; subtitle: string; by: string; classProposed: SaleClass | null; needsReview: boolean }>> =>
  request(`/catalog/class-review/groups/${key}/products${qs({ cursor, limit: 50 })}`);
export const confirmClassGroup = (key: string): Promise<{ confirmed: number }> => request(`/catalog/class-review/groups/${key}/confirm`, json("POST"));

// import
export type ImportField = "name" | "price" | "stock" | "ean" | "sku" | "activeIngredient" | "presentation" | "manufacturer" | "category" | "class" | "equivalentGroup" | "ignore";
export interface CatalogImport {
  id: string;
  filename: string;
  status: "uploaded" | "mapped" | "reviewing" | "applied" | "failed";
  error: string | null;
  createdAt: string;
  appliedAt: string | null;
  stockAsOf: string | null;
  sheetName: string | null;
  headerRow: number | null;
  rowCount: number | null;
  mapping: {
    columns: { sourceColumn: string; example: string; field: ImportField; confidence: "high" | "medium" | "low"; confidenceScore: number }[];
    unmapped: string[];
    modelUsed: boolean;
  } | null;
  previewRows: Record<string, string>[];
  dryRun: { rows: number; toCreate: number; toUpdate: number; skipped: number; classSummary: Record<string, number> } | null;
  stats: { rows: number; created: number; updated: number; skipped: number; unclassified: number; rejected: number } | null;
  createdByName: string | null;
}
export interface ImportSummary {
  id: string;
  filename: string;
  status: CatalogImport["status"];
  createdAt: string;
  appliedAt: string | null;
  stockAsOf: string | null;
  stats: CatalogImport["stats"];
  createdByName: string | null;
}
export const uploadCatalogImport = (file: File): Promise<CatalogImport> => {
  const f = new FormData();
  f.append("file", file);
  return requestForm("/catalog-imports", f);
};
export const getCatalogImports = (): Promise<{ items: ImportSummary[] }> => request("/catalog-imports?limit=10");
export const getCatalogImport = (id: string): Promise<CatalogImport> => request(`/catalog-imports/${id}`);
export const saveImportMapping = (id: string, columns: { sourceColumn: string; field: ImportField }[], headerRow?: number): Promise<CatalogImport> =>
  request(`/catalog-imports/${id}/mapping`, json("POST", { headerRow, columns }));
export const getImportClassProposals = (id: string): Promise<{ groups: { key: string; label: string; count: number; hint: string; samples: { name: string; by: string }[] }[] }> =>
  request(`/catalog-imports/${id}/class-proposals`);
export const applyCatalogImport = (id: string, stockAsOf: string): Promise<CatalogImport> =>
  request(`/catalog-imports/${id}/apply`, json("POST", { stockAsOf, stockUpToDateConfirmed: true }));

// ---------------------------------------------------------------- customers
export interface CustomerList {
  id: string;
  name: string;
  initials: string;
  phone: string | null;
  phoneFormatted: string | null;
  email: string | null;
  ordersCount: number;
  lastActivityAt: string | null;
  addressLabel: string | null;
}
export interface CustomerDetail extends CustomerList {
  consent: { grantedAt: string; purposes: string[]; version: string } | null;
  addresses: { id: string; label: string; isDefault: boolean; createdAt: string; supersededAt: string | null }[];
  orders: { id: string; code: string; createdAt: string; totalCents: number; status: string; statusLabel: string }[];
}
export const getCustomers = (p: { q?: string; cursor?: string }): Promise<Page<CustomerList> & { total: number }> => request(`/customers${qs(p)}`);
export const getCustomer = (id: string): Promise<CustomerDetail> => request(`/customers/${id}`);

// ---------------------------------------------------------------- conversations (read-only mirror)
// Backed by the existing inbox read endpoints (conversas:view). Pharmacy messages additionally carry
// `kind` ("human_joined" system banner) and `authorName/authorRole` for people (Message columns).
export interface MirrorConversation {
  id: string;
  status: string;
  lastMessageAt: string;
  escalatedAt: string | null;
  referenceCode: string | null;
  messageCount: number;
  lead: { id: string; name: string | null; phone: string | null } | null;
  unread: boolean;
  preview: string;
}
export interface MirrorMessage {
  id: string;
  role: "visitor" | "assistant" | "owner" | "system";
  content: string;
  createdAt: string;
  kind?: "standard" | "human_joined" | null;
  authorName?: string | null;
  authorRole?: string | null;
}
export interface MirrorThread {
  id: string;
  status: string;
  personaName: string;
  referenceCode: string | null;
  messages: MirrorMessage[];
  lead: { id: string; name: string | null; phone: string | null; email: string | null } | null;
}
export const getConversations = (filter?: "all" | "escalated"): Promise<MirrorConversation[]> => request(`/inbox/conversations${qs({ filter })}`);
export const getConversationThread = (id: string): Promise<MirrorThread> => request(`/inbox/conversations/${id}`);

// ---------------------------------------------------------------- pharmacy settings
export interface PharmacySettings {
  legalName: string | null;
  cnpj: string | null;
  afeNumber: string | null;
  pharmacistName: string | null;
  pharmacistCrf: string | null;
  deliveryEnabled: boolean;
  deliveryFeeCents: number;
  minOrderCents: number;
  deliveryAreas: { type: "district" | "cep_prefix"; value: string }[];
  pickupEnabled: boolean;
  pickupNotice?: string | null;
  maxQtyPerItemDefault: number;
  autoConfirmEnabled: boolean;
  stockMaxAgeHours: number;
  openingHours: { key: string; label: string; open: boolean; from?: string; to?: string }[];
  paymentMethods: string[];
  exchangePolicy: string | null;
  prescriptionRetentionDays: number;
  orderReminderMinutes: number;
  quickChips: string[];
  /** Mode the owner chose; the effective one is `PharmacySettingsDto.mode.effective`. */
  operationMode?: "commerce" | "attendance";
  operationModeChosenAt?: string | null;
}
export interface SettingsProposal {
  fieldKey: string;
  label: string;
  rawAnswer: string;
  proposed: Partial<PharmacySettings>;
  status: "pending" | "confirmed" | "dismissed";
  proposedAt: string;
  confirmedAt: string | null;
}
export interface PharmacySettingsDto {
  settings: PharmacySettings;
  mode?: OperationModeInfo;
  proposals: Record<string, SettingsProposal>;
  sheet: { stockAsOf: string | null; ageHours: number | null; maxAgeHours: number; stale: boolean } | null;
  banner: string;
}
export const getPharmacySettings = (): Promise<PharmacySettingsDto> => request("/pharmacy/settings");
export const savePharmacySettings = (patch: Partial<PharmacySettings>): Promise<PharmacySettingsDto> => request("/pharmacy/settings", json("PUT", patch));
export const confirmProposal = (fieldKey: string, values?: Record<string, unknown>): Promise<PharmacySettingsDto> =>
  request(`/pharmacy/settings/proposals/${fieldKey}/confirm`, json("POST", values ? { values } : {}));
export const dismissProposal = (fieldKey: string): Promise<PharmacySettingsDto> => request(`/pharmacy/settings/proposals/${fieldKey}/dismiss`, json("POST"));

export interface BrandingDto {
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  tertiaryColor: string;
  stored: { primaryColor: string | null; secondaryColor: string | null; tertiaryColor: string | null };
  isCustom: boolean;
}
export const getBranding = (): Promise<BrandingDto> => request("/businesses/me/branding");
export const saveBranding = (patch: Partial<Record<"primaryColor" | "secondaryColor" | "tertiaryColor", string | null>> & { logoUrl?: string | null }): Promise<BrandingDto> =>
  request("/businesses/me/branding", json("PUT", patch));
export const uploadLogo = (file: File): Promise<{ logoUrl: string }> => {
  const f = new FormData();
  f.append("file", file);
  return requestForm("/businesses/me/branding/logo", f);
};

// ---------------------------------------------------------------- team and access
export interface Member {
  id: string;
  name: string;
  email: string | null;
  initials: string;
  crf: string | null;
  status: "active" | "invited" | "disabled";
  statusLabel: string;
  role: { id: string; key: string | null; name: string; isStarter: boolean };
  lastAccessAt: string | null;
  invitedAt: string | null;
  locked: boolean;
}
export interface Role {
  id: string;
  key: string | null;
  name: string;
  description: string | null;
  isStarter: boolean;
  requiresCrf: boolean;
  ownDeliveriesOnly: boolean;
  permissions: PermissionMap;
  memberCount: number;
}
export interface LogEntry {
  id: string;
  createdAt: string;
  memberId: string | null;
  memberName: string | null;
  action: string;
  category: string;
  target: string | null;
  summary: string;
}
export interface RoleInput {
  name: string;
  description?: string;
  requiresCrf: boolean;
  permissions: Partial<PermissionMap>;
  ownDeliveriesOnly?: boolean;
}
export const getMembers = (p: { status?: string; q?: string } = {}): Promise<{ items: Member[]; counts: { active: number; invited: number; disabled: number } }> => request(`/team/members${qs(p)}`);
export const inviteMember = (b: { email: string; name?: string; roleId?: string }): Promise<{ member: Member; inviteUrl?: string }> => request("/team/members/invite", json("POST", b));
export const resendInvite = (id: string) => request(`/team/members/${id}/resend-invite`, json("POST"));
export const updateMember = (id: string, b: { name?: string; roleId?: string; crf?: string | null }): Promise<Member> => request(`/team/members/${id}`, json("PATCH", b));
export const disableMember = (id: string): Promise<Member> => request(`/team/members/${id}/disable`, json("POST"));
export const enableMember = (id: string): Promise<Member> => request(`/team/members/${id}/enable`, json("POST"));
export const deleteMember = (id: string) => request(`/team/members/${id}`, json("DELETE"));
export const getRoles = (): Promise<{ items: Role[] }> => request("/team/roles");
export const getPermissionSections = (): Promise<{ sections: { key: PermissionSection; label: string; note?: string | null; crfOnly: boolean; readOnly: boolean }[] }> =>
  request("/team/roles/permission-sections");
export const createRole = (b: RoleInput): Promise<Role> => request("/team/roles", json("POST", b));
export const updateRole = (id: string, b: Partial<RoleInput>): Promise<Role> => request(`/team/roles/${id}`, json("PATCH", b));
export const deleteRole = (id: string) => request(`/team/roles/${id}`, json("DELETE"));
export const getAccessLog = (p: { memberId?: string; category?: string; cursor?: string; limit?: number } = {}): Promise<Page<LogEntry>> => request(`/team/access-log${qs(p)}`);
export interface InvitePreview {
  business: { name: string; logoUrl: string | null; branding: Branding };
  email: string;
  name?: string | null;
  role: { name: string; description: string | null; requiresCrf: boolean };
  expiresAt: string;
}
export const getInvite = (token: string): Promise<InvitePreview> => request(`/team/invites/${encodeURIComponent(token)}`);
export const acceptInvite = (b: { token: string; name: string; password: string; crf?: string; acceptTerms: true }): Promise<Me> => request("/team/invites/accept", json("POST", b));

// credentials for owners that logged in by phone (adds e-mail login)
export const setCredentials = (b: { email: string; password: string; currentPassword?: string }) => request("/auth/me/credentials", json("PUT", b));

// ---------------------------------------------------------------- live refresh
export interface LiveSnapshot {
  at: string;
  orders?: { marker: string; latest: { code: string; at: string } | null };
  prescriptions?: { marker: string; latest: { code: string; at: string } | null };
  handoffs?: { marker: string; latest: { id: string; at: string } | null };
  conversations?: { marker: string };
  clients?: { marker: string };
  overview?: { marker: string };
}
export const getLiveSnapshot = (): Promise<LiveSnapshot> => request("/notifications/live");

// ---------------------------------------------------------------- knowledge base (Base de conhecimento)
export type SearchMode = "semantic" | "keyword" | "mixed" | "pending";
export interface KbQa {
  id: string;
  question: string;
  answer: string;
  createdAt: string;
  searchMode: SearchMode;
}
export interface KbDocument {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: "uploaded" | "processing" | "processed" | "failed";
  processingError: string | null;
  createdAt: string;
  searchMode: SearchMode;
}
export interface KbOpenQuestion {
  id: string;
  question: string;
  createdAt: string;
}
export interface KbTestSource {
  kind: "qa" | "document";
  name: string;
  excerpt: string;
  used: boolean;
}
export interface KbTestResult {
  question: string;
  outcome: "answer" | "team" | "pharmacist";
  answer: string | null;
  answerFrom?: "qa" | "document" | "excerpt";
  message: string | null;
  sources: KbTestSource[];
}
export const getKbQa = (): Promise<{ items: KbQa[]; max: number }> => request("/knowledge/qa");
export const createKbQa = (question: string, answer: string): Promise<KbQa> => request("/knowledge/qa", json("POST", { question, answer }));
export const updateKbQa = (id: string, question: string, answer: string): Promise<KbQa> => request(`/knowledge/qa/${id}`, json("PATCH", { question, answer }));
export const deleteKbQa = (id: string): Promise<{ ok: true }> => request(`/knowledge/qa/${id}`, json("DELETE"));
export const getKbDocuments = (): Promise<KbDocument[]> => request("/knowledge/documents");
export const uploadKbDocument = (file: File): Promise<KbDocument> => {
  const f = new FormData();
  f.append("file", file);
  return requestForm("/knowledge/documents/upload", f);
};
export const deleteKbDocument = (id: string) => request(`/knowledge/documents/${id}`, json("DELETE"));
export const testKbAlex = (question: string): Promise<KbTestResult> => request("/knowledge/test", json("POST", { question }));
export const getKbOpenQuestions = (): Promise<{ items: KbOpenQuestion[] }> => request("/knowledge/open-questions");
export const answerKbOpenQuestion = (id: string, body: { answer: string; question?: string; saveToKb: boolean }): Promise<{ saved: KbQa | null }> =>
  request(`/handoffs/${id}/answer-and-save`, json("POST", body));
