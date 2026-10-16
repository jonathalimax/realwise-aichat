export type FieldWeight = "required" | "recommended" | "optional";

export type FieldType = "text" | "number" | "phone" | "hours" | "price";

export interface NicheFieldDef {
  key: string;
  label: string;
  weight: FieldWeight;
  type?: FieldType;
}

export interface InterviewQuestion {
  id: string;
  prompt: string;
  fillsField: string;
}

export interface ChipGraphNode {
  state: string;
  chips: string[];
}

export interface FixedFlow {
  id: string;
  label: string;
  triggerIntents: string[];
}

/** Keep in sync with the Prisma `Niche` enum (a type-level check lives in apps/api). */
export type NicheKey = "imobiliaria" | "concessionaria" | "farmacia";

export interface NicheTemplate {
  niche: NicheKey;
  version: string;
  fields: NicheFieldDef[];
  interviewQuestions: InterviewQuestion[];
  defaultChips: string[];
  chipGraph: ChipGraphNode[];
  fixedFlows: FixedFlow[];
  evalQuestions: string[];
}
