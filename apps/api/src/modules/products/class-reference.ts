// Versioned, bundled reference list used to PROPOSE a sale class for a product (never to decide).
//
// IMPORTANT: this is a small CURATED EXCERPT of Brazilian regulation, written from general knowledge,
// NOT a legal-complete or legally reviewed list. It exists so a spreadsheet without a "tarja" column
// still gets sensible proposals; a pharmacist must confirm every class ("Revisar classes").
// Bias: when in doubt a product is NOT listed here (it stays unclassified), and a listed controlled
// substance always wins over a less restrictive class coming from the sheet.
//
// Sources the entries are drawn from (cite this version when asked):
//  - Portaria SVS/MS 344/1998 (listas A1, A2, A3, B1, B2, C1, C2, C4, D1) and its updates (RDC 784/2023 consolidates the lists)
//  - RDC 20/2011 (antimicrobianos: venda sob prescrição com retenção de receita)
//  - Tarja vermelha (venda sob prescrição) common substances, ANVISA / CMED bulário

export const CLASS_REFERENCE_VERSION = "ref-2026.10";
export const CLASS_REFERENCE_SOURCE = "Portaria SVS/MS 344/1998 (excerto curado) + RDC 20/2011 + tarja vermelha ANVISA";

/** Portaria 344: controlled substances (A: entorpecentes/psicotrópicos, B: psicotrópicos, C: controle especial, ...). */
export const CONTROLLED_SUBSTANCES: ReadonlyArray<{ name: string; list: string }> = [
  // A1 / A2: opioids and narcotics
  ["morfina", "A1"], ["fentanil", "A1"], ["metadona", "A1"], ["oxicodona", "A1"], ["petidina", "A1"], ["meperidina", "A1"], ["hidromorfona", "A1"],
  ["codeina", "A2"], ["tramadol", "A2"], ["dihidrocodeina", "A2"], ["buprenorfina", "A1"], ["tapentadol", "A1"],
  // A3 / B2: stimulants and anorectics
  ["metilfenidato", "A3"], ["anfetamina", "A3"], ["lisdexanfetamina", "A3"], ["modafinila", "B1"],
  ["femproporex", "B2"], ["anfepramona", "B2"], ["dietilpropiona", "B2"], ["mazindol", "B2"], ["sibutramina", "B2"],
  // B1: benzodiazepines and hypnotics
  ["alprazolam", "B1"], ["bromazepam", "B1"], ["clonazepam", "B1"], ["diazepam", "B1"], ["lorazepam", "B1"], ["midazolam", "B1"],
  ["clobazam", "B1"], ["clordiazepoxido", "B1"], ["cloxazolam", "B1"], ["estazolam", "B1"], ["flunitrazepam", "B1"], ["flurazepam", "B1"],
  ["nitrazepam", "B1"], ["oxazepam", "B1"], ["triazolam", "B1"], ["zolpidem", "B1"], ["zopiclona", "B1"], ["eszopiclona", "B1"],
  ["fenobarbital", "B1"], ["pentobarbital", "B1"],
  // C1: controle especial (antidepressants, antipsychotics, anticonvulsants, others)
  ["fluoxetina", "C1"], ["sertralina", "C1"], ["paroxetina", "C1"], ["citalopram", "C1"], ["escitalopram", "C1"], ["venlafaxina", "C1"],
  ["duloxetina", "C1"], ["amitriptilina", "C1"], ["nortriptilina", "C1"], ["clomipramina", "C1"], ["imipramina", "C1"], ["bupropiona", "C1"],
  ["mirtazapina", "C1"], ["trazodona", "C1"], ["haloperidol", "C1"], ["risperidona", "C1"], ["quetiapina", "C1"], ["olanzapina", "C1"],
  ["clozapina", "C1"], ["aripiprazol", "C1"], ["carbamazepina", "C1"], ["pregabalina", "C1"],
  ["litio", "C1"], ["biperideno", "C1"],
  ["levomepromazina", "C1"], ["clorpromazina", "C1"], ["lisdexanfetamina", "A3"], 
  // C2 / C3 / C4: retinoids, immunomodulators, antiretrovirals
  ["isotretinoina", "C2"], ["acitretina", "C2"], ["talidomida", "C3"], 
].map(([name, list]) => ({ name, list }));

/** Common brand names of controlled products (folded). */
export const CONTROLLED_BRANDS: readonly string[] = [
  "rivotril", "frontal", "lexotan", "valium", "dormonid", "stilnox", "ritalina", "concerta", "venvanse", "tylex", "dolantina",
  "tramal", "zolpidem", "olcadil", "sibutramina", "reductil", "prozac", "zoloft", "cymbalta", "efexor", "tegretol", "lamictal",
  "gardenal", "neozine", "haldol", "risperdal", "seroquel", "zyprexa", "roacutan", "neotigason",
];

/** Tarja vermelha (prescription required) common substances. */
export const PRESCRIPTION_SUBSTANCES: readonly string[] = [
  // antimicrobials (RDC 20/2011)
  "amoxicilina", "amoxicilina clavulanato", "azitromicina", "cefalexina", "cefadroxila", "cefuroxima", "ciprofloxacino", "levofloxacino",
  "norfloxacino", "claritromicina", "eritromicina", "sulfametoxazol", "trimetoprima", "metronidazol", "tinidazol", "clindamicina", "doxiciclina",
  "tetraciclina", "penicilina", "ampicilina", "gentamicina", "nitrofurantoina", "fluconazol", "cetoconazol", "itraconazol", "terbinafina",
  "aciclovir", "valaciclovir", "oseltamivir",
  // cardiovascular and metabolic
  "losartana", "valsartana", "olmesartana", "candesartana", "enalapril", "captopril", "ramipril", "anlodipino", "nifedipino", "atenolol",
  "propranolol", "metoprolol", "carvedilol", "bisoprolol", "hidroclorotiazida", "clortalidona", "furosemida", "espironolactona", "digoxina",
  "amiodarona", "sinvastatina", "atorvastatina", "rosuvastatina", "pravastatina", "fenofibrato", "genfibrozila", "metformina", "glibenclamida",
  "glimepirida", "gliclazida", "pioglitazona", "sitagliptina", "vildagliptina", "empagliflozina", "dapagliflozina", "insulina", "varfarina",
  "rivaroxabana", "apixabana", "clopidogrel",
  // hormones, corticoids, others
  "levotiroxina", "prednisona", "prednisolona", "dexametasona", "betametasona", "metilprednisolona", "hidrocortisona", "sildenafila", "tadalafila",
  "etinilestradiol", "drospirenona", "desogestrel", "estradiol", "progesterona", "medroxiprogesterona", "alendronato",
  "nimesulida", "celecoxibe", "etoricoxibe", 
  "ciclobenzaprina", "tizanidina", "carisoprodol", "salbutamol", "formoterol", "budesonida", "montelucaste",
  "tansulosina", "dutasterida", "alopurinol", "colchicina", "metotrexato", "azatioprina", "hidroxicloroquina",
  "misoprostol", "cabergolina", "clomifeno", "finasterida", "lamotrigina", "topiramato", "gabapentina", "ondansetrona", "meloxicam", "piroxicam",
].map((s) => s);

export type ReferenceHit = { class: "controlled" | "prescription"; reason: string };

function fold(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function containsWord(haystack: string, needle: string): boolean {
  return ` ${haystack} `.includes(` ${needle} `);
}

/**
 * Looks a product up by name + active ingredient. Whole-word match on the folded text, so
 * "DIAZEPAM 10MG" hits but "diazepamina" would not. `controlled` always wins over `prescription`.
 */
export function lookupReference(name: string, activeIngredient?: string | null): ReferenceHit | null {
  const text = fold(`${name} ${activeIngredient ?? ""}`);
  if (!text) return null;
  for (const s of CONTROLLED_SUBSTANCES) {
    if (containsWord(text, fold(s.name))) return { class: "controlled", reason: `lista Portaria 344 (${s.list})` };
  }
  for (const b of CONTROLLED_BRANDS) {
    if (containsWord(text, b)) return { class: "controlled", reason: "lista Portaria 344 (marca)" };
  }
  for (const s of PRESCRIPTION_SUBSTANCES) {
    // multi-word entries ("loratadina desloratadina" is just two substances) are matched word by word
    const parts = fold(s).split(" ");
    if (parts.some((p) => p.length >= 5 && containsWord(text, p))) return { class: "prescription", reason: "referência ANVISA (tarja vermelha)" };
  }
  return null;
}
