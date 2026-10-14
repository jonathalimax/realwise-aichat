// Demo catalog + people for the LOCAL pharmacy seed (seed-pharmacy.ts) and the sample spreadsheets
// (generate-sample-catalog.ts). Fictional data only. The classes are the demo's own opinion and
// are NOT legally reviewed: a pharmacist must confirm real classes.

export type DemoClass = "otc" | "prescription" | "controlled" | "unclassified";

export interface DemoProduct {
  k: string; // short key used by demo orders
  name: string;
  presentation: string;
  ingredient: string;
  manufacturer: string;
  category: string;
  priceCents: number;
  stock: number | null;
  cls: DemoClass;
  ean: string;
  group?: string;
  /** For unclassified rows: what the sheet / reference proposed (pending pharmacist confirmation). */
  proposed?: { cls: "otc" | "prescription" | "controlled"; by: "sheet" | "ai" | "reference"; reason: string };
  pharmacistRequired?: boolean;
  /** Tile colour of the generated placeholder photo (a few products get a real image). */
  image?: string;
}

const p = (
  k: string, name: string, presentation: string, ingredient: string, manufacturer: string, category: string,
  price: number, stock: number | null, cls: DemoClass, ean: string, extra: Partial<DemoProduct> = {},
): DemoProduct => ({ k, name, presentation, ingredient, manufacturer, category, priceCents: Math.round(price * 100), stock, cls, ean, ...extra });

export const DEMO_PRODUCTS: DemoProduct[] = [
  // OTC
  p("dipirona", "Dipirona Sódica 500mg", "30 comprimidos", "dipirona", "EMS", "Analgésicos", 12.9, 120, "otc", "7891000100011", { group: "dipirona-500", image: "#0F766E" }),
  p("novalgina", "Novalgina 500mg", "10 comprimidos", "dipirona", "Sanofi", "Analgésicos", 14.5, 0, "otc", "7891000100028", { group: "dipirona-500" }),
  p("dipirona-gotas", "Dipirona Gotas 500mg/ml", "frasco 20ml", "dipirona", "Medley", "Analgésicos", 8.9, 60, "otc", "7891000100035"),
  p("paracetamol750", "Paracetamol 750mg", "20 comprimidos", "paracetamol", "EMS", "Analgésicos", 15.9, 200, "otc", "7891000100042", { group: "paracetamol-750", image: "#2563EB" }),
  p("tylenol", "Tylenol 750mg", "20 comprimidos", "paracetamol", "Janssen", "Analgésicos", 24.9, 35, "otc", "7891000100059", { group: "paracetamol-750" }),
  p("paracetamol500", "Paracetamol 500mg", "20 comprimidos", "paracetamol", "Medley", "Analgésicos", 9.9, 90, "otc", "7891000100066", { group: "paracetamol-500" }),
  p("ibuprofeno", "Ibuprofeno 400mg", "20 comprimidos", "ibuprofeno", "EMS", "Anti-inflamatórios", 18.9, 75, "otc", "7891000100073", { group: "ibuprofeno-400", image: "#B45309" }),
  p("advil", "Advil 400mg", "8 cápsulas", "ibuprofeno", "Pfizer", "Anti-inflamatórios", 17.9, 0, "otc", "7891000100080", { group: "ibuprofeno-400" }),
  p("loratadina", "Loratadina 10mg", "12 comprimidos", "loratadina", "EMS", "Alergia", 11.9, 80, "otc", "7891000100097", { group: "antialergico-10" }),
  p("cetirizina", "Cetirizina 10mg", "12 comprimidos", "cetirizina", "Medley", "Alergia", 13.5, 50, "otc", "7891000100103", { group: "antialergico-10" }),
  p("dorflex", "Dorflex", "10 comprimidos", "dipirona + orfenadrina + cafeína", "Sanofi", "Relaxantes musculares", 12.5, 100, "otc", "7891000100110"),
  p("omeprazol", "Omeprazol 20mg", "28 cápsulas", "omeprazol", "EMS", "Estômago", 19.9, 45, "otc", "7891000100127"),
  p("eno", "Sal de Fruta Eno", "2 envelopes", "bicarbonato de sódio", "GSK", "Estômago", 4.5, 150, "otc", "7891000100134"),
  p("soro", "Soro Fisiológico 0,9%", "frasco 500ml", "cloreto de sódio", "Farmax", "Higiene", 7.9, 40, "otc", "7891000100141"),
  p("vitc", "Vitamina C 1g", "10 comprimidos efervescentes", "ácido ascórbico", "Cimed", "Vitaminas", 14.9, 70, "otc", "7891000100158", { image: "#EA580C" }),
  p("protetor", "Protetor Solar FPS 50", "frasco 120ml", "", "Nivea", "Dermocosméticos", 49.9, 20, "otc", "7891000100165"),
  p("alcoolgel", "Álcool em Gel 70%", "frasco 500ml", "álcool etílico", "Start", "Higiene", 12.9, 90, "otc", "7891000100172"),
  p("vick", "Xarope Vick", "frasco 120ml", "", "Procter", "Tosse e gripe", 28.9, 25, "otc", "7891000100189"),
  p("strepsils", "Strepsils", "12 pastilhas", "", "Reckitt", "Garganta", 11.9, 60, "otc", "7891000100196"),
  p("rinosoro", "Rinosoro", "frasco 30ml", "cloreto de sódio", "Teuto", "Nariz", 11.5, 0, "otc", "7891000100202"),
  p("agua-oxigenada", "Água Oxigenada 10 volumes", "frasco 100ml", "peróxido de hidrogênio", "Farmax", "Curativos", 3.9, 80, "otc", "7891000100219"),
  p("curativo", "Curativo Band-Aid", "40 unidades", "", "Johnson", "Curativos", 12.9, 55, "otc", "7891000100226"),
  p("termometro", "Termômetro Digital", "1 unidade", "", "G-Tech", "Aparelhos", 29.9, 15, "otc", "7891000100233"),
  // Prescription
  p("amoxicilina", "Amoxicilina 500mg", "21 cápsulas", "amoxicilina", "EMS", "Antibióticos", 39.9, 40, "prescription", "7891000200014", { group: "amoxicilina-500" }),
  p("amoxclav", "Amoxicilina + Clavulanato 875/125mg", "14 comprimidos", "amoxicilina + clavulanato", "Medley", "Antibióticos", 79.9, 22, "prescription", "7891000200021"),
  p("azitromicina", "Azitromicina 500mg", "3 comprimidos", "azitromicina", "EMS", "Antibióticos", 34.9, 30, "prescription", "7891000200038"),
  p("losartana", "Losartana Potássica 50mg", "30 comprimidos", "losartana", "EMS", "Pressão", 14.9, 120, "prescription", "7891000200045"),
  p("atenolol", "Atenolol 50mg", "30 comprimidos", "atenolol", "Medley", "Pressão", 12.9, 80, "prescription", "7891000200052"),
  p("metformina", "Metformina 850mg", "30 comprimidos", "metformina", "EMS", "Diabetes", 13.9, 90, "prescription", "7891000200069"),
  p("sinvastatina", "Sinvastatina 20mg", "30 comprimidos", "sinvastatina", "Medley", "Colesterol", 17.9, 60, "prescription", "7891000200076"),
  p("cefalexina", "Cefalexina 500mg", "8 cápsulas", "cefalexina", "EMS", "Antibióticos", 32.5, 0, "prescription", "7891000200083"),
  p("yasmin", "Anticoncepcional Yasmin", "21 comprimidos", "drospirenona + etinilestradiol", "Bayer", "Hormonais", 69.9, 35, "prescription", "7891000200090"),
  // Controlled
  p("clonazepam", "Clonazepam 2mg", "30 comprimidos", "clonazepam", "Roche", "Controlados", 24.9, 25, "controlled", "7891000300017"),
  p("alprazolam", "Alprazolam 0,5mg", "30 comprimidos", "alprazolam", "EMS", "Controlados", 19.9, 18, "controlled", "7891000300024"),
  p("fluoxetina", "Fluoxetina 20mg", "30 cápsulas", "fluoxetina", "EMS", "Controlados", 22.9, 40, "controlled", "7891000300031"),
  p("zolpidem", "Zolpidem 10mg", "30 comprimidos", "zolpidem", "Medley", "Controlados", 27.9, 12, "controlled", "7891000300048"),
  p("ritalina", "Ritalina 10mg", "30 comprimidos", "metilfenidato", "Novartis", "Controlados", 89.9, 6, "controlled", "7891000300055"),
  // Unclassified (waiting for the pharmacist: class review)
  p("omega3", "Ômega 3 1000mg", "60 cápsulas", "óleo de peixe", "Vitafor", "Suplementos", 54.9, 30, "unclassified", "7891000400010", { proposed: { cls: "otc", by: "sheet", reason: 'coluna "Tarja": Venda livre' } }),
  p("melatonina", "Melatonina 0,21mg", "60 comprimidos", "melatonina", "Natu", "Suplementos", 29.9, 22, "unclassified", "7891000400027", { proposed: { cls: "otc", by: "ai", reason: "IA, baixa confiança" } }),
  p("nebacetin", "Nebacetin Pomada", "bisnaga 15g", "neomicina + bacitracina", "Takeda", "Dermatologia", 21.9, 28, "unclassified", "7891000400034", { proposed: { cls: "prescription", by: "reference", reason: "lista tarja vermelha" } }),
  p("dexametasona", "Dexametasona Creme 0,1%", "bisnaga 10g", "dexametasona", "EMS", "Dermatologia", 16.9, 40, "unclassified", "7891000400041", { proposed: { cls: "prescription", by: "reference", reason: "lista tarja vermelha" } }),
];

export const DEMO_MEMBERS = [
  { key: "owner", name: "Helena Duarte", email: "dono@farmaciaexemplo.test", crf: null as string | null },
  { key: "pharmacist", name: "Dra. Carla Menezes", email: "farmaceutica@farmaciaexemplo.test", crf: "CRF-PR 12345" },
  { key: "manager", name: "Rafael Gomes", email: "gerente@farmaciaexemplo.test", crf: null },
  { key: "attendant", name: "Camila Torres", email: "atendente@farmaciaexemplo.test", crf: null },
  { key: "courier", name: "Marcos Silva", email: "entregador@farmaciaexemplo.test", crf: null },
] as const;

export const DEMO_PASSWORD = "Farmacia@2026";

export interface DemoCustomer {
  k: string;
  name: string;
  phone: string; // canonical +55...
  email: string | null;
  address: { cep: string; street: string; number: string; complement: string | null; reference: string | null; district: string; city: string; state: string };
}

export const DEMO_CUSTOMERS: DemoCustomer[] = [
  { k: "maria", name: "Maria Souza", phone: "+5541999990001", email: "maria.souza@example.test", address: { cep: "80620010", street: "Rua das Flores", number: "120B", complement: "ap 31", reference: "portão azul", district: "Água Verde", city: "Curitiba", state: "PR" } },
  { k: "joao", name: "João Pereira", phone: "+5541999990002", email: null, address: { cep: "80010000", street: "Rua XV de Novembro", number: "800", complement: null, reference: null, district: "Centro", city: "Curitiba", state: "PR" } },
  { k: "ana", name: "Ana Lima", phone: "+5541999990003", email: "ana.lima@example.test", address: { cep: "80420000", street: "Avenida Batel", number: "1500", complement: "sala 4", reference: "prédio espelhado", district: "Batel", city: "Curitiba", state: "PR" } },
  { k: "carlos", name: "Carlos Mendes", phone: "+5541999990004", email: null, address: { cep: "80730000", street: "Rua Bispo Dom José", number: "S/N", complement: null, reference: "casa amarela", district: "Bigorrilho", city: "Curitiba", state: "PR" } },
  { k: "beatriz", name: "Beatriz Rocha", phone: "+5541999990005", email: "bia.rocha@example.test", address: { cep: "81030000", street: "Rua Principal", number: "45", complement: null, reference: null, district: "Boqueirão", city: "Curitiba", state: "PR" } },
];

export const DEMO_AREAS = [
  { type: "district", value: "Centro" },
  { type: "district", value: "Batel" },
  { type: "district", value: "Água Verde" },
  { type: "district", value: "Bigorrilho" },
  { type: "district", value: "Portão" },
];

export const DEMO_HOURS = [
  { key: "weekdays", label: "Segunda a sexta", open: true, from: "08:00", to: "22:00" },
  { key: "saturday", label: "Sábado", open: true, from: "08:00", to: "20:00" },
  { key: "sunday", label: "Domingo e feriados", open: true, from: "09:00", to: "18:00" },
];
