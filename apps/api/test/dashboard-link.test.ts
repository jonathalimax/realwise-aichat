import test from "node:test";
import assert from "node:assert/strict";
import { dashboardLink, dashboardOrigin } from "../src/common/email-links";

function withBase(base: string | undefined, fn: () => void) {
  const prev = process.env.DASHBOARD_URL;
  if (base === undefined) delete process.env.DASHBOARD_URL; else process.env.DASHBOARD_URL = base;
  try { fn(); } finally { if (prev === undefined) delete process.env.DASHBOARD_URL; else process.env.DASHBOARD_URL = prev; }
}

test("dashboardOrigin strips niche prefixes and trailing slashes", () => {
  for (const b of ["https://x.com", "https://x.com/", "https://x.com/imobiliaria/app", "https://x.com/farmacia/app/"]) {
    withBase(b, () => assert.equal(dashboardOrigin(), "https://x.com"));
  }
});

test("dashboardLink adds the niche prefix exactly once", () => {
  for (const b of ["https://x.com", "https://x.com/imobiliaria/app"]) {
    withBase(b, () => {
      assert.equal(dashboardLink("/inbox"), "https://x.com/imobiliaria/app/inbox");
      assert.equal(dashboardLink("/plano", "farmacia"), "https://x.com/farmacia/app/plano");
      assert.equal(dashboardLink("/farmacia/app/pedidos"), "https://x.com/farmacia/app/pedidos");
    });
  }
});
