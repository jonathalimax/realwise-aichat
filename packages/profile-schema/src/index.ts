export * from "./types";
export { imobiliariaTemplate } from "./niches/imobiliaria";
export { concessionariaTemplate } from "./niches/concessionaria";
export { farmaciaTemplate, farmaciaSettingsFieldMap } from "./niches/farmacia";

import { imobiliariaTemplate } from "./niches/imobiliaria";
import { concessionariaTemplate } from "./niches/concessionaria";
import { farmaciaTemplate } from "./niches/farmacia";
import type { NicheKey, NicheTemplate } from "./types";

// Exhaustive on purpose: a new niche without a template is a compile error here.
export const nicheTemplates: Record<NicheKey, NicheTemplate> = {
  imobiliaria: imobiliariaTemplate,
  concessionaria: concessionariaTemplate,
  farmacia: farmaciaTemplate,
};

export function questionForField(template: NicheTemplate, fieldKey: string): string | undefined {
  return template.interviewQuestions.find((q) => q.fillsField === fieldKey)?.prompt;
}
