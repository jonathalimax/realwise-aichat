import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addressDiffersFromSaved,
  canonicalPhone,
  firstName,
  maskAddress,
  normalizeAddressNumber,
  normalizeCep,
  sameAddress,
} from "../src/modules/customers/address-utils";
import { BrasilApiCepLookup, FallbackCepLookup, ViaCepLookup, type FetchLike } from "../src/modules/customers/cep-lookup";
import { CustomerProfileService } from "../src/modules/customers/customer-profile.service";

// ---------- number / phone / cep normalization ----------

test("address number normalization: 12, 12B, n/a, s/n -> S/N", () => {
  assert.equal(normalizeAddressNumber("12"), "12");
  assert.equal(normalizeAddressNumber(" 12b "), "12B");
  assert.equal(normalizeAddressNumber("12 B"), "12B");
  assert.equal(normalizeAddressNumber("012"), "12");
  for (const none of ["n/a", "N/A", "na", "s/n", "S/N", "sn", "s/nº", "sem número", "sem numero", "S / N"]) {
    assert.equal(normalizeAddressNumber(none), "S/N", none);
  }
  for (const bad of ["", "  ", "abc", "12 34 56 78 90", "12BC", "1234567", "rua 5"]) {
    assert.throws(() => normalizeAddressNumber(bad), /Número inválido/, bad);
  }
});

test("canonical phone matches the widget E.164 form", () => {
  assert.equal(canonicalPhone("(41) 99812-3344"), "+5541998123344");
  assert.equal(canonicalPhone("41998123344"), "+5541998123344");
  assert.equal(canonicalPhone("+5541998123344"), "+5541998123344");
  assert.equal(canonicalPhone("4133334444"), "+554133334444");
  assert.equal(canonicalPhone("123"), null);
  assert.equal(firstName("  João da Silva "), "João");
  assert.equal(firstName(null), null);
});

test("cep normalization", () => {
  assert.equal(normalizeCep("80250-000"), "80250000");
  assert.equal(normalizeCep("8025000"), null);
});

// ---------- masking / diff ----------

const saved = { id: "a1", isDefault: true, cep: "80250000", street: "Rua das Flores", number: "120B", complement: "ap 31", reference: "portão azul", district: "Água Verde", city: "Curitiba", state: "PR" };

test("masked address hides number, complement and reference", () => {
  const m = maskAddress(saved);
  assert.equal(m.label, "Rua das Flores, nº •••, Água Verde");
  assert.equal(m.cepMasked, "80250-•••");
  assert.equal(JSON.stringify(m).includes("120B"), false);
  assert.equal(JSON.stringify(m).includes("ap 31"), false);
  assert.equal(JSON.stringify(m).includes("portão"), false);
});

test("differs-from-saved flag", () => {
  const same = { ...saved };
  assert.equal(addressDiffersFromSaved(same, saved), false);
  assert.equal(addressDiffersFromSaved({ ...saved, street: "RUA DAS FLORES" }, saved), false); // case / accent insensitive
  assert.equal(addressDiffersFromSaved({ ...saved, number: "121" }, saved), true);
  assert.equal(addressDiffersFromSaved({ ...saved, complement: "ap 32" }, saved), true);
  assert.equal(addressDiffersFromSaved({ ...saved, cep: "80250999" }, saved), true);
  assert.equal(addressDiffersFromSaved(saved, null), false); // nothing saved
  assert.equal(addressDiffersFromSaved(null, saved), false); // pickup order
  assert.equal(sameAddress(saved, { ...saved, reference: "outro" }), true); // reference does not count
});

// ---------- CEP providers with fake fetch ----------

function fakeFetch(routes: Record<string, { status?: number; body?: unknown; throws?: boolean }>): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (url: string) => {
    calls.push(url);
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) throw new Error("no route " + url);
    const r = routes[key];
    if (r.throws) throw new Error("network");
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body };
  }) as FetchLike & { calls: string[] };
  fn.calls = calls;
  return fn;
}
const VIA_OK = { logradouro: "Rua X", bairro: "Água Verde", localidade: "Curitiba", uf: "PR" };
const BR_OK = { street: "Rua X", neighborhood: "Água Verde", city: "Curitiba", state: "PR" };

test("ViaCEP ok / erro:true / 400", async () => {
  const ok = await new ViaCepLookup(fakeFetch({ "viacep.com.br": { body: VIA_OK } })).lookup("80250000");
  assert.deepEqual(ok, { cep: "80250000", street: "Rua X", district: "Água Verde", city: "Curitiba", state: "PR", provider: "viacep" });
  assert.equal(await new ViaCepLookup(fakeFetch({ "viacep.com.br": { body: { erro: true } } })).lookup("99999999"), null);
  assert.equal(await new ViaCepLookup(fakeFetch({ "viacep.com.br": { status: 400, body: {} } })).lookup("99999999"), null);
  await assert.rejects(new ViaCepLookup(fakeFetch({ "viacep.com.br": { status: 503, body: {} } })).lookup("80250000"));
});

test("BrasilAPI maps fields", async () => {
  const ok = await new BrasilApiCepLookup(fakeFetch({ "brasilapi.com.br": { body: BR_OK } })).lookup("80250000");
  assert.equal(ok?.provider, "brasilapi");
  assert.equal(ok?.district, "Água Verde");
  assert.equal(await new BrasilApiCepLookup(fakeFetch({ "brasilapi.com.br": { status: 404, body: {} } })).lookup("80250000"), null);
});

test("fallback: ViaCEP down -> BrasilAPI answers; both down -> unavailable; not found wins over a failure", async () => {
  const f1 = fakeFetch({ "viacep.com.br": { throws: true }, "brasilapi.com.br": { body: BR_OK } });
  const out1 = await new FallbackCepLookup([new ViaCepLookup(f1), new BrasilApiCepLookup(f1)]).lookup("80250-000");
  assert.equal(out1.status, "ok");
  assert.equal(out1.status === "ok" && out1.result.provider, "brasilapi");

  const f2 = fakeFetch({ "viacep.com.br": { throws: true }, "brasilapi.com.br": { status: 500, body: {} } });
  assert.deepEqual(await new FallbackCepLookup([new ViaCepLookup(f2), new BrasilApiCepLookup(f2)]).lookup("80250000"), { status: "unavailable" });

  const f3 = fakeFetch({ "viacep.com.br": { throws: true }, "brasilapi.com.br": { status: 404, body: {} } });
  assert.deepEqual(await new FallbackCepLookup([new ViaCepLookup(f3), new BrasilApiCepLookup(f3)]).lookup("80250000"), { status: "not_found" });

  assert.deepEqual(await new FallbackCepLookup([new ViaCepLookup(f3)]).lookup("123"), { status: "invalid" });
  const f4 = fakeFetch({ "viacep.com.br": { body: VIA_OK }, "brasilapi.com.br": { body: BR_OK } });
  await new FallbackCepLookup([new ViaCepLookup(f4), new BrasilApiCepLookup(f4)]).lookup("80250000");
  assert.equal(f4.calls.length, 1); // the second provider is not called when the first answers
});

// ---------- service with fake prisma ----------

function fakeDb() {
  const rows: any[] = [];
  let seq = 0;
  const leads = [{ id: "L1", businessId: "B", name: "João Silva" }];
  const match = (r: any, where: any) => Object.entries(where).every(([k, v]) => (v === null ? r[k] == null : r[k] === v));
  const customerAddress = {
    findFirst: async ({ where }: any) => rows.filter((r) => match(r, where)).sort((a, b) => b.createdAt - a.createdAt)[0] ?? null,
    findMany: async ({ where }: any) => rows.filter((r) => match(r, where)).sort((a, b) => b.createdAt - a.createdAt),
    create: async ({ data }: any) => { const r = { id: `A${++seq}`, supersededAt: null, createdAt: seq, ...data }; rows.push(r); return r; },
    update: async ({ where, data }: any) => Object.assign(rows.find((r) => r.id === where.id), data),
  };
  const client: any = {
    lead: {
      findUnique: async ({ where }: any) => (where.businessId_phoneNormalized.phoneNormalized === "+5541998123344" ? leads[0] : null),
      findFirst: async ({ where }: any) => leads.find((l) => l.id === where.id && l.businessId === where.businessId) ?? null,
    },
    customerAddress,
    $transaction: async (fn: any) => fn({ customerAddress }),
  };
  return { rows, svc: (cep: any) => new CustomerProfileService({ client } as any, cep) };
}
const okCep = () => new FallbackCepLookup([{ name: "t", lookup: async (c) => ({ cep: c, street: "Rua das Flores", district: "Água Verde", city: "Curitiba", state: "PR", provider: "viacep" as const }) }]);
const downCep = () => new FallbackCepLookup([{ name: "t", lookup: async () => { throw new Error("down"); } }]);

test("recognition by phone: first name + masked address only; unknown phone not recognized", async () => {
  const { svc, rows } = fakeDb();
  const s = svc(okCep());
  assert.deepEqual(await s.recognizeByPhone("B", "(41) 90000-0000"), { recognized: false });
  await s.saveAddress("B", "L1", { cep: "80250-000", number: "120b", complement: "ap 31", reference: "portão azul" });
  const rec: any = await s.recognizeByPhone("B", "(41) 99812-3344");
  assert.equal(rec.recognized, true);
  assert.equal(rec.firstName, "João");
  assert.equal(rec.address.label, "Rua das Flores, nº •••, Água Verde");
  assert.equal(JSON.stringify(rec).includes("120B"), false);
  assert.equal(rows.length, 1);
  await assert.rejects(s.recognizeByPhone("B", "12"), /Telefone inválido/);
});

test("first address becomes default; a different address does NOT silently replace it", async () => {
  const { svc, rows } = fakeDb();
  const s = svc(okCep());
  const first = await s.saveAddress("B", "L1", { cep: "80250000", number: "120" });
  assert.equal(first.isDefault, true);
  const other = await s.saveAddress("B", "L1", { cep: "80250000", number: "999" });
  assert.equal(other.isDefault, false);
  assert.equal(other.differsFromSaved, true);
  assert.equal(rows.length, 2);
  assert.equal(rows.filter((r) => r.isDefault).length, 1);
  assert.equal(rows.find((r) => r.isDefault).number, "120"); // default untouched
  assert.equal(rows.every((r) => r.supersededAt === null), true);
});

test("explicit replaceDefault supersedes the old default and keeps it as history; same address is reused", async () => {
  const { svc, rows } = fakeDb();
  const s = svc(okCep());
  await s.saveAddress("B", "L1", { cep: "80250000", number: "120" });
  const upd = await s.saveAddress("B", "L1", { cep: "80250000", number: "55A", replaceDefault: true });
  assert.equal(upd.isDefault, true);
  assert.equal(rows.length, 2);
  const old = rows.find((r) => r.number === "120");
  assert.equal(old.isDefault, false);
  assert.ok(old.supersededAt);
  assert.equal(rows.filter((r) => r.isDefault).length, 1);
  const again = await s.saveAddress("B", "L1", { cep: "80250000", number: "55a" });
  assert.equal(again.reused, true);
  assert.equal(again.differsFromSaved, false);
  assert.equal(rows.length, 2);
  // promoting the previous entry back keeps history intact
  const back = await s.saveAddress("B", "L1", { cep: "80250000", number: "120", replaceDefault: true });
  assert.equal(back.reused, true);
  assert.equal(back.isDefault, true);
  assert.equal(rows.filter((r) => r.isDefault).length, 1);
  assert.equal(rows.length, 2);
});

test("s/n numbers, invalid numbers, not found and provider-down fallbacks", async () => {
  const { svc } = fakeDb();
  const s = svc(okCep());
  assert.equal((await s.saveAddress("B", "L1", { cep: "80250000", number: "s/n" })).snapshot.number, "S/N");
  await assert.rejects(s.saveAddress("B", "L1", { cep: "80250000", number: "abc" }), /Número inválido/);
  await assert.rejects(s.saveAddress("B", "L1", { cep: "123", number: "1" }), /CEP inválido/);
  const notFound = svc(new FallbackCepLookup([{ name: "t", lookup: async () => null }]));
  await assert.rejects(notFound.saveAddress("B", "L1", { cep: "99999999", number: "1" }), /CEP não encontrado/);
  // provider down: manual fields are accepted, otherwise a precise error is returned
  const down = svc(downCep());
  await assert.rejects(down.saveAddress("B", "L1", { cep: "80250000", number: "1" }), (e: any) => e.getResponse().code === "CEP_UNAVAILABLE");
  const manual = await down.saveAddress("B", "L1", { cep: "80250000", number: "1", street: "Rua Manual", district: "Centro", city: "Curitiba", state: "pr" });
  assert.equal(manual.snapshot.street, "Rua Manual");
  assert.equal(manual.snapshot.state, "PR");
});

test("a visitor can never save for a lead of another business", async () => {
  const { svc } = fakeDb();
  await assert.rejects(svc(okCep()).saveAddress("OTHER", "L1", { cep: "80250000", number: "1" }), /Cliente não encontrado/);
});
