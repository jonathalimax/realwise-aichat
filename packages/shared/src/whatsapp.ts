export function normalizePhoneE164(phone: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.startsWith("55")) return `+${digits}`;
  return `+55${digits}`;
}

export function buildWaMeLink(phone: string, message: string): string {
  const normalized = normalizePhoneE164(phone).replace("+", "");
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

export function generateReferenceCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function buildCustomerEscalationMessage(businessName: string, topic: string, referenceCode: string): string {
  return `Oi! Vim pelo atendimento online da ${businessName}. Estava vendo sobre ${topic}. Código: ${referenceCode}`;
}

export function buildOwnerOutreachMessage(leadName: string, businessName: string, topic: string): string {
  return `Oi ${leadName}, aqui é da ${businessName}! Vi que você perguntou sobre ${topic} no nosso atendimento. Posso te ajudar a fechar?`;
}
