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

export function questionForField(template: NicheTemplate, fieldKey: string): string | undefined {
  return template.interviewQuestions.find((q) => q.fillsField === fieldKey)?.prompt;
}
