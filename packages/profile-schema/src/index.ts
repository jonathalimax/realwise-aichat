export * from "./types";
export { imobiliariaTemplate } from "./niches/imobiliaria";
export { concessionariaTemplate } from "./niches/concessionaria";

import { imobiliariaTemplate } from "./niches/imobiliaria";
import { concessionariaTemplate } from "./niches/concessionaria";
import type { NicheTemplate } from "./types";

export const nicheTemplates: Record<string, NicheTemplate> = {
  imobiliaria: imobiliariaTemplate,
  concessionaria: concessionariaTemplate,
};
