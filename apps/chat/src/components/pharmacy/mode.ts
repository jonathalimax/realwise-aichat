// Pharmacy operation mode in the widget. The API sends the EFFECTIVE mode in `business.pharmacy.operationMode`
// (public business info) and in every pharmacy view (`pharmacy.operationMode`). "attendance" = no cart, no
// product cards, no "fazer um pedido": the pharmacist confirms stock and price.

export const ATTENDANCE_WELCOME_CHIPS = ["Falar com o farmacêutico", "Horários e entrega", "Perguntar sobre um produto"];
export const COMMERCE_WELCOME_CHIPS = ["Fazer um pedido", "Falar com o farmacêutico", "Horários e entrega"];

const COMMERCE_ONLY = /carrinho|finalizar|fazer um pedido|acompanhar pedido|continuar comprando|ver outro produto/i;

export function isAttendanceMode(business: { pharmacy?: { operationMode?: string } | null } | null | undefined): boolean {
  return business?.pharmacy?.operationMode === "attendance";
}

/** Welcome chips: the owner's quick chips (commerce ones removed in attendance mode) or the mode's defaults. */
export function welcomeChips(business: { pharmacy?: { operationMode?: string; quickChips?: unknown } | null } | null | undefined): string[] {
  const attendance = isAttendanceMode(business);
  const configured = Array.isArray(business?.pharmacy?.quickChips) ? (business!.pharmacy!.quickChips as unknown[]).filter((c): c is string => typeof c === "string" && c.trim().length > 0) : [];
  const usable = attendance ? configured.filter((c) => !COMMERCE_ONLY.test(c)) : configured;
  if (usable.length > 0) return usable.slice(0, 5);
  return attendance ? ATTENDANCE_WELCOME_CHIPS : COMMERCE_WELCOME_CHIPS;
}

export function welcomeText(businessName: string, attendance: boolean): string {
  return attendance
    ? `Oi! Eu sou o Alex, da ${businessName}. Posso tirar dúvidas sobre horários, entrega e retirada, ou chamar o farmacêutico.`
    : `Oi! Eu sou o Alex, da ${businessName}. Que bom ter você aqui! Posso montar seu pedido ou chamar o farmacêutico.`;
}
