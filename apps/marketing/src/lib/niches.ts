export interface ChatMessage {
  from: "bot" | "user";
  text: string;
}

export interface NicheConfig {
  slug: string;
  label: string;
  heroPre: string;
  heroEm: string;
  heroSub: string;
  heroBusinessName: string;
  heroBusinessInitials: string;
  heroMessages: ChatMessage[];
  heroChips: string[];
  problemIntro: string;
  solutionCard1Title: string;
  solutionCard1Desc: string;
  solutionCard1Messages: ChatMessage[];
  solutionCard2Title: string;
  solutionCard2Desc: string;
  solutionCard2Messages: ChatMessage[];
  capabilities: { title: string; desc: string }[];
  faqExtra: [string, string];
  earlyAccess?: boolean;
}

const CAPABILITY_ICON_PATHS = [
  "M12 10h24M12 20h24M12 30h16M8 6h32a2 2 0 012 2v32a2 2 0 01-2 2H8a2 2 0 01-2-2V8a2 2 0 012-2z",
  "M10 8h28a2 2 0 012 2v28a2 2 0 01-2 2H10a2 2 0 01-2-2V10a2 2 0 012-2zM8 18h32M16 4v8M32 4v8M18 26l4 4 8-8",
  "M24 4a10 10 0 00-10 10c0 7 10 18 10 18s10-11 10-18A10 10 0 0024 4zm0 14a4 4 0 110-8 4 4 0 010 8z",
  "M24 42a18 18 0 100-36 18 18 0 000 36zM24 24V10M24 24l10 6",
];

export { CAPABILITY_ICON_PATHS };

export const NICHES: Record<string, NicheConfig> = {
  imobiliarias: {
    slug: "imobiliarias",
    label: "para imobiliárias",
    heroPre: "Enquanto você dorme, ",
    heroEm: "o inquilino já desistiu",
    heroSub: "A Realwise explica documentos, fiador e valores às 22h, agenda a visita e te passa o cliente pronto no WhatsApp — antes que ele alugue com a imobiliária ao lado.",
    heroBusinessName: "Imobiliária Vale Real",
    heroBusinessInitials: "VR",
    heroMessages: [
      { from: "bot", text: "Oi! Posso ajudar com documentos, valores ou agendar uma visita." },
      { from: "user", text: "Quais documentos preciso pra alugar?" },
      { from: "bot", text: "RG, CPF, comprovante de renda e fiador ou seguro fiança. Quer agendar uma visita?" },
    ],
    heroChips: ["Ver imóveis disponíveis", "📅 Agendar visita"],
    problemIntro: "Todo dia, um inquilino em potencial desiste de esperar resposta.",
    solutionCard1Title: "Explica documentos na hora, mesmo de madrugada",
    solutionCard1Desc: "Fiador, seguro fiança, comprovante de renda — tudo explicado no segundo, sem o cliente esperar você acordar.",
    solutionCard1Messages: [
      { from: "user", text: "Vocês aceitam seguro fiança?" },
      { from: "bot", text: "Aceitamos sim! Fiador ou seguro fiança, você escolhe." },
    ],
    solutionCard2Title: "Agenda a visita sozinha, sem ida e volta",
    solutionCard2Desc: "Cada conversa vira um lead com nota de temperatura. Você abre o painel e já sabe quem chamar primeiro.",
    solutionCard2Messages: [
      { from: "user", text: "Qual horário funciona pra visita?" },
      { from: "bot", text: "Sábado de manhã" },
      { from: "bot", text: "Fechado! Te mando a confirmação." },
    ],
    capabilities: [
      { title: "Conhece cada imóvel de cor", desc: "Sabe valor, condomínio, documentos e política de pets sem você digitar nada." },
      { title: "Agenda visita sem ida e volta", desc: "Marca a visita direto no chat, sem sair pra outro app." },
      { title: "Te chama na hora certa", desc: "Quando o cliente quer negociar, ela já abre o WhatsApp com a conversa pronta." },
      { title: "Nunca inventa resposta", desc: "Se não sabe algo, admite e te chama — nunca chuta valor ou documento pro seu cliente." },
    ],
    faqExtra: ["Funciona para locação e venda?", "Hoje o foco é locação — onde a papelada e as dúvidas de documentos mais travam o processo. Venda está no radar."],
  },
  concessionarias: {
    slug: "concessionarias",
    label: "para concessionárias",
    heroPre: "Enquanto você dorme, ",
    heroEm: "seu cliente já desistiu",
    heroSub: "A Realwise responde quem pergunta preço às 22h, agenda o test-drive e te passa o cliente pronto no WhatsApp — antes que ele vá pro concorrente.",
    heroBusinessName: "AutoSul Veículos",
    heroBusinessInitials: "AS",
    heroMessages: [
      { from: "bot", text: "Oi! Posso ajudar com estoque, financiamento ou agendar um test-drive." },
      { from: "user", text: "Vocês têm o Corolla 2023?" },
      { from: "bot", text: "Temos! Corolla XEi 2023, automático, 18.400 km, R$ 128.900." },
    ],
    heroChips: ["Simular financiamento", "📅 Test-drive"],
    problemIntro: "Todo dia, um comprador em potencial desiste de esperar resposta.",
    solutionCard1Title: "Responde na hora, mesmo de madrugada",
    solutionCard1Desc: "Preço, estoque, condições de financiamento — tudo respondido no segundo, sem seu cliente esperar você acordar.",
    solutionCard1Messages: [
      { from: "user", text: "Quanto fica a entrada em 48x?" },
      { from: "bot", text: "A partir de R$ 8.900. Quer que eu simule com seu carro na troca?" },
    ],
    solutionCard2Title: "Agenda o test-drive sozinha, sem ida e volta",
    solutionCard2Desc: "Cada conversa vira um lead com nota de temperatura. Você abre o painel e já sabe quem chamar primeiro.",
    solutionCard2Messages: [
      { from: "user", text: "Posso ver o carro hoje à tarde?" },
      { from: "bot", text: "Consigo às 15h ou 17h" },
      { from: "bot", text: "Fechado! Te mando a confirmação." },
    ],
    capabilities: [
      { title: "Conhece seu estoque de cor", desc: "Sabe preço, km, opcionais e condições sem você digitar nada no meio da correria." },
      { title: "Agenda test-drive sem ida e volta", desc: "Marca test-drive ou avaliação de troca direto no chat, sem sair pra outro app." },
      { title: "Te chama na hora certa", desc: "Quando o cliente quer negociar, ela já abre o WhatsApp com a conversa pronta." },
      { title: "Nunca inventa resposta", desc: "Se não sabe algo, admite e te chama — nunca chuta preço ou prazo pro seu cliente." },
    ],
    faqExtra: ["A IA avalia meu carro na troca?", "Ela coleta fotos, km e modelo e já te passa isso pronto — a avaliação final de valor continua sendo sua."],
    earlyAccess: true,
  },
  estetica: {
    slug: "estetica",
    label: "para clínicas de estética",
    heroPre: "Enquanto você atende, ",
    heroEm: "sua próxima cliente desiste",
    heroSub: "A Realwise explica procedimentos, faz a pré-avaliação por foto e agenda a sessão — antes que ela marque na clínica ao lado.",
    heroBusinessName: "Clínica Bellari",
    heroBusinessInitials: "CB",
    heroMessages: [
      { from: "bot", text: "Oi! Posso tirar dúvidas sobre procedimentos ou agendar uma avaliação." },
      { from: "user", text: "Quanto custa o preenchimento labial?" },
      { from: "bot", text: "A partir de R$ 890, depende da quantidade. Quer agendar uma avaliação gratuita?" },
    ],
    heroChips: ["Ver procedimentos", "📅 Agendar avaliação"],
    problemIntro: "Toda semana, uma cliente em potencial desiste de esperar resposta.",
    solutionCard1Title: "Explica procedimentos na hora, mesmo à noite",
    solutionCard1Desc: "Valor, duração, cuidados pós — tudo respondido no segundo, sem a cliente esperar você sair do atendimento.",
    solutionCard1Messages: [
      { from: "user", text: "Dói fazer botox?" },
      { from: "bot", text: "É bem tolerável, a maioria descreve como um desconforto leve. Posso te explicar o pós-procedimento também." },
    ],
    solutionCard2Title: "Agenda a avaliação sozinha, sem ida e volta",
    solutionCard2Desc: "Cada conversa vira um lead com nota de temperatura. Você abre o painel e já sabe quem chamar primeiro.",
    solutionCard2Messages: [
      { from: "user", text: "Tem horário pra essa semana?" },
      { from: "bot", text: "Quinta às 14h ou sexta às 10h" },
      { from: "bot", text: "Fechado! Te mando a confirmação." },
    ],
    capabilities: [
      { title: "Conhece cada procedimento de cor", desc: "Sabe valor, duração e contraindicações sem você digitar nada entre um atendimento e outro." },
      { title: "Agenda avaliação sem ida e volta", desc: "Marca a avaliação direto no chat, sem sair pra outro app." },
      { title: "Te chama na hora certa", desc: "Quando a cliente quer tirar uma dúvida clínica, ela já abre o WhatsApp com a conversa pronta." },
      { title: "Nunca inventa resposta", desc: "Se não sabe algo, admite e te chama — nunca dá indicação clínica no lugar da sua equipe." },
    ],
    faqExtra: ["A IA dá indicação de procedimento?", "Não. Ela explica o que está na sua base e organiza a pré-avaliação — qualquer indicação clínica continua sendo sua, da sua equipe."],
    earlyAccess: true,
  },
};
