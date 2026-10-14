import "./support/pharmacy-env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { OnboardingService } from "../src/modules/onboarding/onboarding.service";

function setup(planCode: "essencial" | "profissional") {
  let profile: any = null;
  const proposals: Array<[string, string]> = [];
  const prisma: any = {
    client: {
      business: { findUnique: async () => ({ id: "b1", niche: "farmacia", name: "Farmácia X", slug: "farmacia-x", confidenceScore: 0 }) },
      businessProfile: {
        findUnique: async () => profile,
        upsert: async ({ update, create }: any) => (profile = profile ? { ...profile, ...update } : create),
      },
      knowledgeDocument: { findMany: async () => [] },
      pharmacySettings: { findUnique: async () => null },
      subscription: { findUnique: async () => ({ plan: { code: planCode } }) },
    },
  };
  const pharmacySettings: any = { proposeFromField: async (_b: string, key: string, value: string) => proposals.push([key, value]) };
  return { service: new OnboardingService(prisma, pharmacySettings), proposals, get profile() { return profile; } };
}

test("a plan with commerce is asked which mode it wants, with both options named", async () => {
  const { service } = setup("profissional");
  const q = await service.interviewChat("b1", []);
  assert.match(q.reply, /"Modo de operação"/);
  assert.match(q.reply, /Comércio/);
  assert.match(q.reply, /Atendimento/);
});

test("the answer is classified and saved; an unclear answer is not saved", async () => {
  const t = setup("profissional");
  const q = await t.service.interviewChat("b1", []);
  const unclear = await t.service.interviewChat("b1", [{ role: "clara", content: q.reply }, { role: "owner", content: "não sei" }]);
  assert.match(unclear.reply, /Não ficou claro/);
  assert.equal(t.profile?.data?.modo_operacao, undefined);
  const ok = await t.service.interviewChat("b1", [{ role: "clara", content: q.reply }, { role: "owner", content: "quero atendimento, só a IA" }]);
  assert.match(ok.reply, /modo atendimento/i);
  assert.equal(t.profile.data.modo_operacao, "atendimento");
  assert.match(ok.reply, /Razão social e CNPJ/);
});

test("a plan without commerce is told the only available mode and moves on (nothing to ask)", async () => {
  const t = setup("essencial");
  const q = await t.service.interviewChat("b1", []);
  assert.match(q.reply, /modo Atendimento/);
  assert.match(q.reply, /plano Profissional/);
  assert.doesNotMatch(q.reply, /Responda "comércio"/);
  assert.equal(t.profile.data.modo_operacao, "atendimento");
  assert.match(q.reply, /Pode me contar sobre/);
});
