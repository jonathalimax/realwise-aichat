import { LandingPage } from "../../components/LandingPage";
import { NICHES } from "../../lib/niches";

export const metadata = {
  title: "Realwise para Imobiliárias — Seu atendimento não dorme",
  description: "Chat de IA que explica documentos, agenda visitas e te passa o inquilino pronto no WhatsApp. Sem app oficial do WhatsApp, sem taxa por conversa.",
};

export default function ImobiliariasPage() {
  return <LandingPage niche={NICHES.imobiliarias} />;
}
