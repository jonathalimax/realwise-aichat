import "./support/pharmacy-env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStarterPermissions } from "@realwise/shared";
import { computeLiveMarkers } from "../src/modules/pharmacy-dashboard/live-markers";

function client() {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  return {
    queries,
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      queries.push({ sql: strings.join("?"), values });
      return [{ marker: "m", latest_code: "1017", latest_id: "h1", latest_at: new Date("2026-10-15T10:00:00Z") }];
    },
  };
}
const member = (roleKey: string, over: any = {}) => ({ memberId: "m1", businessId: "b1", ownDeliveriesOnly: false, permissions: buildStarterPermissions("farmacia", roleKey as any), ...over }) as any;

test("live markers: every query is scoped by businessId and returns only hashes and non-health labels", async () => {
  const c = client();
  const out: any = await computeLiveMarkers(c, member("owner"));
  assert.ok(c.queries.length >= 4);
  for (const q of c.queries) assert.ok(q.values.includes("b1"), "scoped by business");
  assert.equal(out.orders.marker, "m");
  assert.equal(out.orders.latest.code, "1017");
  assert.equal(out.handoffs.latest.id, "h1");
  assert.ok(out.overview.marker.includes("m|m"));
  const sql = c.queries.map((q) => q.sql).join(" ");
  assert.ok(!/summary|symptoms|answerText|content|"name"/.test(sql), "no text columns are read");
});

test("live markers: only the sections the member may view are returned; couriers see only their own orders", async () => {
  const c = client();
  const out: any = await computeLiveMarkers(c, member("owner", { permissions: {} }));
  assert.deepEqual(Object.keys(out), ["at"]);
  const owner: any = await computeLiveMarkers(client(), member("owner"));
  const att: any = await computeLiveMarkers(client(), member("attendant"));
  for (const k of ["orders", "prescriptions", "handoffs", "conversations", "clients"]) assert.ok(owner[k], k);
  assert.ok(att.handoffs && att.conversations);
  const own = client();
  await computeLiveMarkers(own, member("owner", { ownDeliveriesOnly: true }));
  assert.ok(own.queries.some((q) => q.values.includes("m1")), "courier scope applied");
});
