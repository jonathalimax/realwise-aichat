import { LandingPage } from "../../components/LandingPage";
import { NICHES } from "../../lib/niches";

export const metadata = {
  title: "Realwise para Concessionárias — Seu atendimento não dorme",
  description: "Chat de IA que responde estoque, simula financiamento, agenda test-drive e te passa o cliente pronto no WhatsApp. Sem app oficial do WhatsApp, sem taxa por conversa.",
};

export default function ConcessionariasPage() {
  return <LandingPage niche={NICHES.concessionarias} />;
}
