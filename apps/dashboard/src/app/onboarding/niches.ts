import { Building2, Car, Pill } from "lucide-react";

export const NICHES = [
  {
    value: "imobiliaria",
    label: "Imobiliária",
    description: "Locação e venda de imóveis — a Clara ajuda seus clientes a encontrar o imóvel certo.",
    icon: Building2,
  },
  {
    value: "concessionaria",
    label: "Concessionária",
    description: "Venda de veículos — a Clara ajuda seus clientes a encontrar o carro ideal e agendar test-drives.",
    icon: Car,
  },
  {
    value: "farmacia",
    label: "Farmácia",
    description: "Pedidos de venda livre no chat e encaminhamento ao farmacêutico — o Alex nunca indica remédio.",
    icon: Pill,
  },
] as const;
