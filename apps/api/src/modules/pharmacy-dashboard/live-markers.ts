import { hasPermission } from "@realwise/shared";
import type { MemberContext } from "../access/member-context";

/**
 * Cheap change markers for the dashboard's live refresh (GET /notifications/live). Each marker is an opaque hash of the
 * newest rows of ONE list (ids + status/timestamps only, never any text), returned only for sections the member may view.
 * The page refetches only when its marker changed. `latest` carries the newest item's NON-health label for the toast.
 */
type Client = { $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<any> };

export interface LiveMarkers {
  at: string;
  orders?: { marker: string; latest: { code: string; at: string } | null };
  prescriptions?: { marker: string; latest: { code: string; at: string } | null };
  handoffs?: { marker: string; latest: { id: string; at: string } | null };
  conversations?: { marker: string };
  clients?: { marker: string };
  /** Hash of every marker above: the Início KPIs / charts depend on all of them. */
  overview?: { marker: string };
}

const one = async (p: Promise<any[]>) => (await p)[0] as { marker: string | null; latest_id?: string | null; latest_code?: string | null; latest_at?: Date | null } | undefined;
const latest = (r: { latest_code?: string | null; latest_at?: Date | null } | undefined) => (r?.latest_code && r.latest_at ? { code: r.latest_code, at: r.latest_at.toISOString() } : null);

export async function computeLiveMarkers(prisma: Client, m: MemberContext): Promise<LiveMarkers> {
  const b = m.businessId;
  const out: LiveMarkers = { at: new Date().toISOString() };
  const can = (s: any) => hasPermission(m.permissions, s, "view");
  const parts: string[] = [];

  if (can("pedidos")) {
    const r = m.ownDeliveriesOnly
      ? await one(prisma.$queryRaw`SELECT md5(count(*)::text || coalesce(string_agg(x.id || x.status::text || x."updatedAt"::text, ',' ORDER BY x.id), '')) AS marker, (array_agg(x.code ORDER BY x."createdAt" DESC))[1] AS latest_code, max(x."createdAt") AS latest_at FROM (SELECT * FROM "Order" WHERE "businessId" = ${b} AND "courierMemberId" = ${m.memberId} ORDER BY "createdAt" DESC LIMIT 300) x`)
      : await one(prisma.$queryRaw`SELECT md5(count(*)::text || coalesce(string_agg(x.id || x.status::text || x."updatedAt"::text, ',' ORDER BY x.id), '')) AS marker, (array_agg(x.code ORDER BY x."createdAt" DESC))[1] AS latest_code, max(x."createdAt") AS latest_at FROM (SELECT * FROM "Order" WHERE "businessId" = ${b} ORDER BY "createdAt" DESC LIMIT 300) x`);
    out.orders = { marker: r?.marker ?? "0", latest: latest(r) };
    parts.push(out.orders.marker);
  }
  if (can("receitas")) {
    const r = await one(prisma.$queryRaw`SELECT md5(count(*)::text || coalesce(string_agg(x.id || x.status::text || coalesce(x."reviewedAt"::text, ''), ',' ORDER BY x.id), '')) AS marker, (array_agg(x.number ORDER BY x."createdAt" DESC))[1]::text AS latest_code, max(x."createdAt") AS latest_at FROM (SELECT * FROM "PrescriptionUpload" WHERE "businessId" = ${b} ORDER BY "createdAt" DESC LIMIT 300) x`);
    out.prescriptions = { marker: r?.marker ?? "0", latest: r?.latest_code && r.latest_at ? { code: `RX-${r.latest_code}`, at: r.latest_at.toISOString() } : null };
    parts.push(out.prescriptions.marker);
  }
  if (can("atendimento")) {
    const r = await one(prisma.$queryRaw`SELECT md5(count(*)::text || coalesce(string_agg(x.id || x.status::text || coalesce(x."answeredAt"::text, '') || coalesce(x.brief->'inProgress'->>'at', ''), ',' ORDER BY x.id), '')) AS marker, (array_agg(x.id ORDER BY x."createdAt" DESC))[1] AS latest_id, max(x."createdAt") AS latest_at FROM (SELECT * FROM "PharmacistHandoff" WHERE "businessId" = ${b} ORDER BY "createdAt" DESC LIMIT 300) x`);
    out.handoffs = { marker: r?.marker ?? "0", latest: r?.latest_id && r.latest_at ? { id: r.latest_id, at: r.latest_at.toISOString() } : null };
    parts.push(out.handoffs.marker);
  }
  if (can("conversas")) {
    const r = await one(prisma.$queryRaw`SELECT md5(count(*)::text || coalesce(string_agg(x.id || x."lastMessageAt"::text || x."messageCount"::text || x.status::text, ',' ORDER BY x.id), '')) AS marker FROM (SELECT id, "lastMessageAt", "messageCount", status FROM "Conversation" WHERE "businessId" = ${b} ORDER BY "lastMessageAt" DESC LIMIT 200) x`);
    out.conversations = { marker: r?.marker ?? "0" };
    parts.push(out.conversations.marker);
  }
  if (can("clientes")) {
    const r = await one(prisma.$queryRaw`SELECT md5(count(*)::text || coalesce(string_agg(x.id || x."lastSeenAt"::text, ',' ORDER BY x.id), '')) AS marker FROM (SELECT id, "lastSeenAt" FROM "Lead" WHERE "businessId" = ${b} ORDER BY "lastSeenAt" DESC LIMIT 300) x`);
    out.clients = { marker: r?.marker ?? "0" };
    parts.push(out.clients.marker);
  }
  if (can("inicio")) out.overview = { marker: parts.join("|") };
  return out;
}
