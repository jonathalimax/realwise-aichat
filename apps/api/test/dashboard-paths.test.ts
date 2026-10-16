import test from "node:test";
import assert from "node:assert/strict";
import { dashboardBasePath as sharedBasePath, isWrongDashboardPrefix } from "@realwise/shared";
import { dashboardBasePath, dashboardLink } from "../src/common/email-links";

test("dashboardBasePath: one prefix per niche, real estate is the fallback", () => {
  assert.equal(dashboardBasePath("imobiliaria"), "/imobiliaria/app");
  assert.equal(dashboardBasePath("farmacia"), "/farmacia/app");
  assert.equal(dashboardBasePath("concessionaria"), "/concessionaria/app");
  assert.equal(dashboardBasePath(null), "/imobiliaria/app");
  assert.equal(dashboardBasePath(undefined), "/imobiliaria/app");
  assert.equal(dashboardBasePath("outro"), "/imobiliaria/app");
  assert.equal(dashboardBasePath, sharedBasePath);
});

test("email links (invite, reset, notification) land on the member's own dashboard", () => {
  const prev = process.env.DASHBOARD_URL;
  process.env.DASHBOARD_URL = "https://aichat.realwise.com.br/";
  try {
    assert.equal(dashboardLink(`${dashboardBasePath("concessionaria")}/convite/tok`), "https://aichat.realwise.com.br/concessionaria/app/convite/tok");
    assert.equal(dashboardLink(`${dashboardBasePath("farmacia")}/redefinir-senha?token=t`), "https://aichat.realwise.com.br/farmacia/app/redefinir-senha?token=t");
    assert.equal(dashboardLink(`${dashboardBasePath("imobiliaria")}/convite/tok`), "https://aichat.realwise.com.br/imobiliaria/app/convite/tok");
  } finally {
    if (prev === undefined) delete process.env.DASHBOARD_URL;
    else process.env.DASHBOARD_URL = prev;
  }
});

test("isWrongDashboardPrefix: detects a member on another niche's dashboard", () => {
  assert.equal(isWrongDashboardPrefix("farmacia", "/imobiliaria/app"), true);
  assert.equal(isWrongDashboardPrefix("farmacia", "/farmacia/app"), false);
  assert.equal(isWrongDashboardPrefix("concessionaria", "/imobiliaria/app"), true);
  assert.equal(isWrongDashboardPrefix("concessionaria", "/concessionaria/app/"), false);
  assert.equal(isWrongDashboardPrefix("imobiliaria", "/farmacia/app"), true);
});

test("dashboardRedirect: wrong-prefix login goes to the member's own prefix, right prefix stays in-app", async () => {
  const { dashboardRedirect } = await import("@realwise/shared");
  assert.deepEqual(dashboardRedirect("farmacia", "/inicio", "/imobiliaria/app"), { crossPrefix: true, href: "/farmacia/app/inicio" });
  assert.deepEqual(dashboardRedirect("farmacia", "/inicio", "/farmacia/app"), { crossPrefix: false, href: "/inicio" });
  assert.deepEqual(dashboardRedirect("concessionaria", "/", "/imobiliaria/app"), { crossPrefix: true, href: "/concessionaria/app" });
  assert.deepEqual(dashboardRedirect("concessionaria", "/leads", "/concessionaria/app"), { crossPrefix: false, href: "/leads" });
  assert.deepEqual(dashboardRedirect("imobiliaria", "/onboarding", "/farmacia/app"), { crossPrefix: true, href: "/imobiliaria/app/onboarding" });
});
