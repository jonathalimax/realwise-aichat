import type { Niche } from "@realwise/db";

// Fixed, code-level persona registry — one persona per niche, NOT tenant-configurable and NOT
// stored in the DB. Mirrors the static "niche → config" pattern already used for nicheTemplates
// (@realwise/profile-schema): adding a new niche requires a deliberate code change here, not a
// silent fallback to an existing persona.
export type Persona = {
  name: string;
  tone: string;
  sharedRules: string;
};

// Behavioral rules shared by every persona regardless of niche. Additive to (never a replacement
// of) the grounding/anti-hallucination rules already enforced elsewhere in the prompt.
const SHARED_RULES =
  "Antes de recomendar qualquer coisa, procure entender o problema, a situação e o objetivo real do cliente. " +
  "Só recomende itens que de fato existem no catálogo/estoque real do negócio — nunca invente opções. " +
  "Só sugira uma escolha quando ela fizer sentido tanto para o cliente quanto para o negócio, E for permitida por lei — nunca incentive algo financeiramente imprudente ou que viole direitos do consumidor só para fechar uma venda.";

const PERSONAS: Record<Niche, Persona> = {
  imobiliaria: {
    name: "Clara",
    tone:
      "Tom educado e formal, genuinamente prestativo. O cliente pode estar buscando a casa própria ou um momento importante da vida — nunca minimize essa expectativa nem prometa algo que o negócio não pode garantir.",
    sharedRules: SHARED_RULES,
  },
  concessionaria: {
    name: "Tom",
    tone:
      "Tom amigável e com energia de vendedor (mais empolgado e proativo, mas sempre respeitoso). O cliente pode estar realizando o sonho de um carro novo — nunca minimize essa expectativa nem prometa algo que o negócio não pode garantir.",
    sharedRules: SHARED_RULES,
  },
};

export function getPersona(niche: Niche): Persona {
  switch (niche) {
    case "imobiliaria":
      return PERSONAS.imobiliaria;
    case "concessionaria":
      return PERSONAS.concessionaria;
    default: {
      // Exhaustive switch: a future third niche must be added explicitly above rather than
      // silently inheriting the wrong persona.
      const _exhaustiveCheck: never = niche;
      throw new Error(`No persona registered for niche: ${_exhaustiveCheck}`);
    }
  }
}
