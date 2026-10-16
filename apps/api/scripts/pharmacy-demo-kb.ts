/**
 * Demo knowledge base of "Farmácia Exemplo": store information only (no dose, no medicine advice, no customer data).
 * Applied by seed-pharmacy.ts (idempotent: a question that already exists is left as it is).
 * Facts agree with the demo settings: Rua das Flores 100 (Água Verde), Seg-Sex 8h-22h, Sáb 8h-20h, Dom/feriados 9h-18h,
 * delivery R$ 6,00 with minimum R$ 25,00, payment Pix / cartão / dinheiro, exchange in 7 days.
 */
export interface DemoQa {
  q: string;
  a: string;
}

export const DEMO_QA: DemoQa[] = [
  { q: "Vocês têm estacionamento?", a: "Não temos estacionamento próprio, mas a Rua das Flores tem vagas de rotativo na frente da loja e há um estacionamento pago a meio quarteirão. Se preferir, a gente leva até você pela entrega." },
  { q: "Quais formas de pagamento vocês aceitam?", a: "Aceitamos Pix, cartão de crédito e débito e dinheiro. Não aceitamos cheque. Na entrega, o pagamento é feito com o entregador, e na retirada, na loja." },
  { q: "Vocês aceitam vale-refeição ou vale-alimentação?", a: "Infelizmente não aceitamos vale-refeição, vale-alimentação nem cartões de benefícios (como Ticket, Alelo, Sodexo e VR). Aceitamos Pix, cartão de crédito e débito e dinheiro." },
  { q: "Vocês trabalham com convênio ou plano de saúde?", a: "Não trabalhamos com convênios nem planos de saúde (como Unimed, Amil, Bradesco Saúde ou SulAmérica) por enquanto. Você pode pagar por Pix, cartão ou dinheiro e guardar a nota fiscal para pedir reembolso ao seu plano, se ele oferecer." },
  { q: "Qual o horário de funcionamento nos feriados?", a: "Nos domingos e feriados abrimos das 9h às 18h. Em feriados como Natal e Ano Novo o horário pode ser reduzido, e avisamos aqui no chat e na porta da loja." },
  { q: "Vocês funcionam 24 horas? Têm plantão?", a: "Não somos 24 horas e não fazemos plantão noturno. Funcionamos de segunda a sexta das 8h às 22h, sábado das 8h às 20h e domingo e feriados das 9h às 18h. Fora desse horário, em caso de urgência, procure uma unidade de pronto atendimento ou ligue 192." },
  { q: "Vocês entregam em condomínio?", a: "Entregamos sim! O entregador deixa o pedido na portaria, e quem recebe precisa se identificar com o nome e o número do pedido. Se o condomínio não deixar o entregador subir, a gente combina com você uma outra forma de entregar." },
  { q: "O entregador sobe até o apartamento?", a: "Por segurança, o entregador entrega na portaria do prédio ou do condomínio. Se a portaria permitir e você preferir, avise no pedido e a gente tenta combinar." },
  { q: "Quanto tempo demora a entrega?", a: "A entrega costuma levar de 30 a 50 minutos depois que o pedido é confirmado. Em horários de chuva ou de muito movimento pode demorar um pouco mais, e a gente avisa você." },
  { q: "Qual o valor da entrega e tem pedido mínimo?", a: "A taxa de entrega é de R$ 6,00 e o pedido mínimo para entrega é de R$ 25,00. Para retirar na loja não tem taxa nem valor mínimo." },
  { q: "Quais bairros vocês atendem na entrega?", a: "Entregamos no Centro, Batel, Água Verde, Bigorrilho e Portão. Se o seu bairro não está na lista, você pode retirar o pedido na loja." },
  { q: "Como funciona a retirada na loja?", a: "É só escolher retirada na hora de finalizar o pedido. Quando ele estiver separado, você recebe o aviso de pronto para retirada e passa na loja com o número do pedido e um documento com foto. O pagamento é feito na loja." },
  { q: "Por quanto tempo guardam meu pedido para retirada?", a: "Guardamos o pedido por 24 horas depois do aviso de pronto para retirada. Passando disso, os itens voltam para a prateleira. Se precisar de mais tempo, é só avisar a gente pelo chat." },
  { q: "Vocês aceitam receita digital?", a: "Aceitamos sim, receita digital com assinatura eletrônica válida, em PDF ou foto nítida. O farmacêutico confere tudo antes de liberar o pedido." },
  { q: "Vocês ficam com a receita original?", a: "Nos medicamentos com retenção de receita, a lei obriga a farmácia a ficar com uma via, e isso é explicado na hora. Nos demais casos, devolvemos a receita ou usamos a cópia que você enviou, conforme o caso." },
  { q: "O que acontece se o produto estiver em falta?", a: "Se um produto estiver em falta, o Alex avisa na hora e, quando existir um equivalente cadastrado, oferece a troca para você escolher. Nada é trocado sem a sua confirmação, e o farmacêutico confere antes de liberar." },
  { q: "Vocês encomendam produtos que não têm em estoque?", a: "Em geral conseguimos encomendar com os nossos fornecedores. Chame a equipe pelo chat com o nome do produto que a gente confirma o prazo e o valor." },
  { q: "Qual a política de troca e devolução?", a: "Fazemos trocas em até 7 dias, com a embalagem lacrada e a nota fiscal. Medicamentos não são trocados depois da entrega, exceto em caso de erro nosso ou produto com defeito." },
  { q: "Recebi um produto errado ou com defeito, o que faço?", a: "Sentimos muito! Fale com a gente pelo chat com o número do pedido, e a equipe resolve com a troca ou o reembolso, sem custo para você." },
  { q: "Vocês têm programa de fidelidade?", a: "Temos o Clube Exemplo: a cada R$ 1,00 em compras você ganha 1 ponto, e 200 pontos viram R$ 10,00 de desconto. O cadastro é grátis e feito no balcão ou pelo chat." },
  { q: "Vocês fazem promoções?", a: "Fazemos promoções toda semana, principalmente em higiene, cuidados com a pele e bebês. As ofertas do dia ficam na entrada da loja e quem é do Clube Exemplo recebe os avisos primeiro." },
  { q: "Vocês medem pressão arterial?", a: "Medimos sim, de graça, no balcão de atendimento, em horário comercial e sem agendamento. A medida não substitui a consulta, e o farmacêutico explica o resultado." },
  { q: "Vocês fazem teste de glicemia?", a: "Fazemos o teste de glicemia capilar na loja, com agendamento ou por ordem de chegada, por R$ 12,00. Pedimos para você vir sem pressa, e o resultado sai na hora." },
  { q: "Vocês aplicam injeção?", a: "Aplicamos injetáveis na loja com receita médica e com o produto em mãos, por R$ 15,00 a aplicação. O farmacêutico confere a receita antes e o serviço é feito em sala reservada." },
  { q: "Vocês aplicam vacinas?", a: "Ainda não aplicamos vacinas na loja. Por enquanto, os serviços que oferecemos são aferição de pressão, teste de glicemia e aplicação de injetáveis com receita." },
  { q: "Como falo com o farmacêutico?", a: "A farmacêutica responsável é a Dra. Carla Menezes, e você fala com ela por aqui: é só pedir para chamar o farmacêutico que eu aviso a equipe e você recebe a resposta neste chat. Na loja, ela atende no balcão em horário comercial." },
  { q: "Vocês guardam meus dados? Como funciona a LGPD?", a: "Guardamos apenas o necessário para atender seu pedido, como nome, telefone e endereço, e só com a sua autorização. Dados de saúde e receitas ficam protegidos e são apagados depois de um prazo. Você pode pedir para ver ou apagar seus dados a qualquer momento falando com a equipe." },
  { q: "Como cancelo meu pedido?", a: "Se o pedido ainda não saiu para entrega, é só avisar aqui no chat com o número do pedido que a equipe cancela. Depois que o entregador saiu, o cancelamento depende do combinado com a loja." },
  { q: "Vocês emitem nota fiscal?", a: "Emitimos nota fiscal em todas as compras, e ela acompanha o pedido na entrega. Se quiser com CPF ou CNPJ, avise na hora da compra." },
  { q: "Vocês vendem produtos para pets?", a: "Temos uma pequena linha de produtos para pets (cachorros e gatos), como shampoos, antipulgas de uso externo e petiscos. Não trabalhamos com ração, e remédios de uso veterinário precisam ser vistos com a equipe." },
  { q: "Vocês vendem fraldas e produtos para bebês?", a: "Vendemos sim: fraldas, lenços umedecidos, pomadas de assadura, shampoos, mamadeiras e chupetas, entre outros itens. A disponibilidade muda, e dá para consultar pelo chat." },
  { q: "Vocês vendem cosméticos e perfumaria?", a: "Sim, temos dermocosméticos, protetor solar, hidratantes, maquiagem básica, perfumes e itens de cuidado com os cabelos, das marcas que mais saem." },
  { q: "Quais marcas vocês trabalham?", a: "Trabalhamos com marcas conhecidas de medicamentos de referência, genéricos e similares, além de linhas de higiene e beleza. Se procura uma marca específica, é só perguntar pelo nome que a equipe confere." },
  { q: "Vocês têm wi-fi para clientes?", a: "Temos wi-fi grátis na loja. A senha fica no balcão de atendimento, é só pedir." },
  { q: "A loja tem acessibilidade para cadeirantes e cadeira de rodas?", a: "Temos rampa de acesso, entrada sem degrau e corredores largos para cadeira de rodas, e a equipe pode ajudar a pegar os produtos. Para quem prefere, também fazemos a entrega." },
  { q: "Qual o endereço e o telefone da farmácia?", a: "Ficamos na Rua das Flores, 100, no bairro Água Verde, em Curitiba. Você também fala com a gente por este chat durante todo o horário de funcionamento." },
  { q: "Posso pagar na entrega?", a: "Pode sim. O pagamento na entrega é feito com o entregador, por Pix, cartão ou dinheiro. Se for pagar em dinheiro e precisar de troco, é só avisar no pedido." },
];

export interface DemoDoc {
  filename: string;
  content: string;
}

export const DEMO_DOCS: DemoDoc[] = [
  {
    filename: "Política de trocas e devoluções.txt",
    content: `Política de trocas e devoluções da Farmácia Exemplo

Prazo: aceitamos trocas em até 7 dias corridos a partir da data da compra ou do recebimento do pedido.

Condições: o produto precisa estar com a embalagem lacrada, sem uso, e com a nota fiscal. Produtos de higiene e cosméticos abertos não podem ser trocados.

Medicamentos: por segurança sanitária, medicamentos não são trocados nem devolvidos depois da entrega ao cliente. A exceção é erro da farmácia (produto diferente do pedido) ou defeito de fabricação, caso em que a troca é feita sem custo.

Como pedir: fale com a equipe pelo chat informando o número do pedido (PED-0000) e o motivo. Para trocas por defeito, mande uma foto do produto e do lote. A equipe responde no mesmo dia útil.

Reembolso: quando a troca não é possível, o valor é devolvido na mesma forma de pagamento. Pagamentos por Pix são devolvidos por Pix em até 2 dias úteis.`,
  },
  {
    filename: "Serviços farmacêuticos.txt",
    content: `Serviços farmacêuticos da Farmácia Exemplo

Aferição de pressão arterial: gratuita, no balcão, em horário comercial, sem agendamento.

Teste de glicemia capilar: R$ 12,00, por ordem de chegada ou com agendamento pelo chat. O resultado sai na hora.

Aplicação de injetáveis: R$ 15,00 por aplicação. É necessário trazer a receita médica e o produto. O farmacêutico confere a receita e a aplicação é feita em sala reservada.

Vacinas: ainda não oferecemos aplicação de vacinas.

Atendimento do farmacêutico: a Dra. Carla Menezes (CRF-PR 12345) atende no balcão de segunda a sábado em horário comercial e responde pelo chat durante o horário de funcionamento. Dúvidas sobre uso de remédios, doses e sintomas são sempre tratadas diretamente pelo farmacêutico.`,
  },
  {
    filename: "Entrega e retirada.txt",
    content: `Entrega e retirada na Farmácia Exemplo

Bairros atendidos: Centro, Batel, Água Verde, Bigorrilho e Portão.

Taxa e pedido mínimo: a entrega custa R$ 6,00 e exige pedido mínimo de R$ 25,00. A retirada na loja não tem taxa nem valor mínimo.

Prazo: de 30 a 50 minutos depois da confirmação do pedido, podendo variar com chuva e movimento.

Condomínios e prédios: o entregador deixa o pedido na portaria. Quem recebe confirma o nome e o número do pedido. Se o condomínio não permitir a entrada do entregador, combinamos outro ponto de entrega.

Pagamento na entrega: Pix, cartão ou dinheiro, direto com o entregador. Avise no pedido se precisar de troco.

Retirada: o cliente recebe o aviso de pronto para retirada e leva um documento com foto e o número do pedido. O pedido fica reservado por 24 horas.

Medicamentos com receita: o pedido só é liberado depois da conferência do farmacêutico, tanto na entrega quanto na retirada.`,
  },
];
