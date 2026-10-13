import { LandingPage } from "../../components/LandingPage";
import { NICHES } from "../../lib/niches";

export const metadata = {
  title: "Realwise para Farmácias — Pedidos no chat, farmacêutico no controle",
  description: "Assistente virtual com IA que monta pedidos de venda livre, recebe receitas e encaminha sintomas ao farmacêutico. Nunca indica remédio.",
};

export default function FarmaciasPage() {
  return <LandingPage niche={NICHES.farmacias} />;
}
