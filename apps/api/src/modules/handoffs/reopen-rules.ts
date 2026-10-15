// When does a new customer message bring an ANSWERED handoff back to "open"? Pure and deterministic.
// Only a genuinely new question or clinical message does; thanks, buy intent, cart / checkout / consent / card taps do not.

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9?\s]/g, " ").replace(/\s+/g, " ").trim();

const ACK = /^(ok|okay|blz|beleza|valeu|vlw|obrigad[oa]s?|brigad[oa]|muito obrigad[oa]|show|certo|entendi|entendido|combinado|perfeito|otimo|legal|tudo bem|tchau|ate mais|sim|nao|isso|isso mesmo|pode ser|pode|fechado|de nada)( .{0,12})?$/;
const BUY = /\b(quero (comprar|esse|essa|ese|o|a|um|uma|levar|pedir|finalizar|fechar)|vou (querer|levar|comprar)|queria (comprar|esse|essa|levar)|comprar|adicion\w*|carrinho|finaliz\w*|fechar (o )?pedido|fazer (o |um )?pedido|checkout|usar sugestao|aceito|concordo|confirmo|retirar|retirada|entrega|endereco|cep|pagamento|pix|cartao)\b/;

export function isNewQuestion(content: string): boolean {
  const t = fold(content);
  if (t.length < 3) return false;
  if (ACK.test(t)) return false;
  if (BUY.test(t) && !t.includes("?")) return false;
  const words = t.split(" ").filter(Boolean).length;
  return t.includes("?") || words >= 4;
}
