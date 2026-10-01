const WHATSAPP_NUMBER = "5585992265544";
const WHATSAPP_MSG = encodeURIComponent("Oi! Vi o site da RealWise e quero saber mais.");
const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}?text=${WHATSAPP_MSG}`;

function WhatsAppCTA({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return (
    <a
      href={WHATSAPP_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-6 py-3.5 text-sm font-semibold text-white transition hover:opacity-90 ${className}`}
    >
      {children}
    </a>
  );
}

export default function MarketingHome() {
  return (
    <div className="bg-bg text-ink">
      {/* NAV */}
      <header className="sticky top-0 z-30 border-b border-border bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent font-serif text-sm font-bold text-white">R</div>
            <span className="font-serif text-lg font-bold">RealWise</span>
          </div>
          <nav className="hidden items-center gap-7 text-sm text-ink-soft md:flex">
            <a href="#como-funciona" className="hover:text-ink">Como funciona</a>
            <a href="#nichos" className="hover:text-ink">Nichos</a>
            <a href="#precos" className="hover:text-ink">Preços</a>
            <a href="#faq" className="hover:text-ink">Perguntas</a>
          </nav>
          <WhatsAppCTA className="px-4 py-2 text-xs">Falar no WhatsApp</WhatsAppCTA>
        </div>
      </header>

      {/* HERO */}
      <section className="mx-auto max-w-6xl px-5 pb-14 pt-14 md:pb-20 md:pt-20">
        <div className="grid items-center gap-10 md:grid-cols-2">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-ink-soft">
              <span className="h-1.5 w-1.5 rounded-full bg-positive" /> Feito no Brasil · sem taxa por mensagem
            </div>
            <h1 className="font-serif text-4xl leading-tight text-ink md:text-5xl">
              Seu atendimento não dorme.
            </h1>
            <p className="mt-5 max-w-md text-base text-ink-soft md:text-lg">
              Um link na sua bio do Instagram responde quem pergunta preço às 22h, agenda a visita e te passa o cliente pronto no seu WhatsApp — sem precisar contratar ninguém.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <WhatsAppCTA className="px-6 py-3.5">Falar no WhatsApp</WhatsAppCTA>
              <a
                href="#como-funciona"
                className="inline-flex items-center justify-center rounded-xl border border-border bg-surface px-6 py-3.5 text-sm font-semibold text-ink hover:bg-bg-2"
              >
                Ver como funciona
              </a>
            </div>
            <p className="mt-4 text-xs text-muted">Menos de 15% do custo de uma recepcionista. Primeiro mês, se não trouxer agendamento, a gente devolve.</p>
          </div>

          <div className="mx-auto w-full max-w-[340px] rounded-[2rem] border-[6px] border-ink/90 bg-surface shadow-xl">
            <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft font-serif font-bold text-accent-ink">AS</div>
              <div>
                <div className="text-sm font-semibold">AutoSul Veículos</div>
                <div className="flex items-center gap-1 text-[0.7rem] text-positive">
                  <span className="h-1.5 w-1.5 rounded-full bg-positive" /> Online agora
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-2.5 px-4 py-4">
              <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-bg-2 px-3.5 py-2.5 text-[0.82rem]">
                Oi! Posso ajudar com estoque, financiamento ou agendar um test-drive. O que você precisa?
              </div>
              <div className="ml-auto max-w-[75%] rounded-2xl rounded-br-sm bg-accent px-3.5 py-2.5 text-[0.82rem] text-white">
                Vocês têm o Corolla 2023?
              </div>
              <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-bg-2 px-3.5 py-2.5 text-[0.82rem]">
                Temos! Corolla XEi 2023, automático, 18.400 km, R$ 128.900.
              </div>
              <div className="flex gap-1.5">
                <span className="rounded-full border border-border bg-surface px-2.5 py-1 text-[0.68rem] text-ink-soft">Simular financiamento</span>
                <span className="rounded-full border border-accent bg-accent-soft px-2.5 py-1 text-[0.68rem] font-semibold text-accent-ink">📅 Test-drive</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PAIN */}
      <section className="border-y border-border bg-surface py-14">
        <div className="mx-auto max-w-5xl px-5">
          <h2 className="font-serif text-2xl text-ink md:text-3xl">Quantas mensagens ficaram sem resposta essa semana?</h2>
          <div className="mt-8 grid gap-5 sm:grid-cols-3">
            <div>
              <div className="font-mono text-3xl text-accent-ink">22h47</div>
              <p className="mt-1 text-sm text-ink-soft">é quando chega boa parte das perguntas de preço — bem depois de qualquer um estar na loja.</p>
            </div>
            <div>
              <div className="font-mono text-3xl text-accent-ink">2h</div>
              <p className="mt-1 text-sm text-ink-soft">é o tempo médio pra um lead esfriar. Quem responde em 5 minutos fecha mais.</p>
            </div>
            <div>
              <div className="font-mono text-3xl text-accent-ink">R$ 3.500</div>
              <p className="mt-1 text-sm text-ink-soft">custa uma recepcionista por mês, com encargos — e ela não trabalha domingo às 22h.</p>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="como-funciona" className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="font-serif text-2xl text-ink md:text-3xl">Como funciona</h2>
        <p className="mt-2 max-w-lg text-ink-soft">Quatro passos, a maior parte feita com você numa chamada de 20 minutos.</p>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { t: "Você manda o que já tem", d: "Tabela de preços, foto do quadro de horários, o que estiver à mão. Sem planilha pronta, sem formulário chato." },
            { t: "A IA te entrevista", d: "20 minutos de perguntas simples pra preencher o que falta. Ela já lê o que você mandou e confirma com você." },
            { t: "Você aprova e vê a prontidão", d: "Um medidor de 0 a 100% mostra exatamente o que falta antes de qualquer cliente real conversar com a IA." },
            { t: "Recebe o link e cola na bio", d: "QR code, texto pronto pra bio e um story pronto. Em minutos está no ar." },
          ].map((step, i) => (
            <div key={step.t} className="rounded-card border border-border bg-surface p-5">
              <div className="font-mono text-xs text-muted">Passo {i + 1}</div>
              <h3 className="mt-2 font-serif text-lg text-ink">{step.t}</h3>
              <p className="mt-2 text-sm text-ink-soft">{step.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CONFIDENCE METER */}
      <section className="border-y border-border bg-surface py-16">
        <div className="mx-auto grid max-w-5xl items-center gap-10 px-5 md:grid-cols-2">
          <div>
            <h2 className="font-serif text-2xl text-ink md:text-3xl">Você sabe se seu atendente está pronto. Com número.</h2>
            <p className="mt-3 text-ink-soft">A maioria dos chatbots entrega uma tela em branco e torce pra você preencher sozinho. A gente mostra, em porcentagem, exatamente o que falta antes de publicar — e o que fazer pra chegar lá.</p>
          </div>
          <div className="rounded-card border border-border bg-bg p-6">
            <div className="flex items-center gap-5">
              <div className="font-mono text-4xl text-accent-ink">82%</div>
              <div className="text-xs text-muted">Pronto pra publicar</div>
            </div>
            <div className="mt-4 flex flex-col gap-2 text-xs">
              {[["Campos obrigatórios", 92], ["Profundidade de documentos", 70], ["Teste de perguntas reais", 81], ["Atualidade", 88]].map(([label, val]) => (
                <div key={label as string} className="flex items-center gap-2">
                  <span className="w-40 text-ink-soft">{label}</span>
                  <div className="h-1.5 flex-1 rounded-full bg-bg-2">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${val}%` }} />
                  </div>
                  <span className="w-8 text-right font-mono text-muted">{val}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* NICHES */}
      <section id="nichos" className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="font-serif text-2xl text-ink md:text-3xl">Feito para o seu negócio</h2>
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          <div className="rounded-card border border-accent bg-accent-soft p-6">
            <span className="rounded-full bg-accent px-2 py-0.5 text-[0.65rem] font-bold uppercase text-white">Disponível agora</span>
            <h3 className="mt-3 font-serif text-lg text-accent-ink">Imobiliárias</h3>
            <p className="mt-2 text-sm text-ink">Documentos de locação, fiador ou seguro fiança, agendamento de visita — tudo explicado antes do cliente ligar.</p>
          </div>
          <div className="rounded-card border border-accent bg-accent-soft p-6">
            <span className="rounded-full bg-accent px-2 py-0.5 text-[0.65rem] font-bold uppercase text-white">Disponível agora</span>
            <h3 className="mt-3 font-serif text-lg text-accent-ink">Concessionárias</h3>
            <p className="mt-2 text-sm text-ink">Estoque, simulação de financiamento, avaliação de carro na troca e agendamento de test-drive, direto no chat.</p>
          </div>
          <div className="rounded-card border border-border bg-surface p-6 opacity-70">
            <span className="rounded-full bg-bg-2 px-2 py-0.5 text-[0.65rem] font-bold uppercase text-muted">Em breve</span>
            <h3 className="mt-3 font-serif text-lg text-ink">Academias, clínicas e mais</h3>
            <p className="mt-2 text-sm text-ink-soft">Estamos abrindo um nicho de cada vez pra fazer direito. Me chama no WhatsApp se o seu ainda não está na lista.</p>
          </div>
        </div>
      </section>

      {/* WHATSAPP HANDOFF */}
      <section className="border-y border-border bg-surface py-16">
        <div className="mx-auto grid max-w-5xl items-center gap-10 px-5 md:grid-cols-2">
          <div className="order-2 md:order-1">
            <h2 className="font-serif text-2xl text-ink md:text-3xl">A IA não fecha venda. Ela te entrega o cliente pronto.</h2>
            <p className="mt-3 text-ink-soft">Quando o cliente quer falar com uma pessoa — ou pede algo que só você responde — a IA abre o WhatsApp dele com uma mensagem já escrita, pronta pra enviar. Sem robô mandando mensagem em nome do seu negócio, sem taxa por conversa.</p>
          </div>
          <div className="order-1 mx-auto w-full max-w-[280px] rounded-card border border-border bg-bg p-4 md:order-2">
            <div className="text-xs font-semibold text-ink-soft">Vou te passar pra uma pessoa do time.</div>
            <div className="mt-3 rounded-lg bg-[#25D366] px-4 py-2.5 text-center text-sm font-bold text-white">Abrir no WhatsApp</div>
            <div className="mt-3 text-[0.7rem] text-muted">Código: R7K2 · Oi! Vim pelo atendimento da Imobiliária Vale Real...</div>
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="precos" className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="font-serif text-2xl text-ink md:text-3xl">Preço</h2>
        <p className="mt-2 max-w-lg text-ink-soft">Sem letra miúda. Taxa de setup única pela entrevista guiada, mais a mensalidade.</p>
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          <div className="rounded-card border border-border bg-surface p-6">
            <h3 className="font-serif text-lg">Essencial</h3>
            <div className="mt-2 font-mono text-3xl text-ink">R$297<span className="text-sm font-sans text-muted">/mês</span></div>
            <div className="text-xs text-muted">+ R$497 de setup</div>
            <ul className="mt-5 flex flex-col gap-2 text-sm text-ink-soft">
              <li>— 300 conversas/mês</li>
              <li>— 10 documentos na base</li>
              <li>— Agendamento embutido</li>
              <li>— 1 número de WhatsApp</li>
            </ul>
          </div>
          <div className="relative rounded-card border-2 border-accent bg-surface p-6">
            <span className="absolute -top-3 left-6 rounded-full bg-accent px-3 py-1 text-[0.65rem] font-bold uppercase text-white">Mais escolhido</span>
            <h3 className="font-serif text-lg">Profissional</h3>
            <div className="mt-2 font-mono text-3xl text-ink">R$597<span className="text-sm font-sans text-muted">/mês</span></div>
            <div className="text-xs text-muted">+ R$997 de setup</div>
            <ul className="mt-5 flex flex-col gap-2 text-sm text-ink-soft">
              <li>— 1.200 conversas/mês</li>
              <li>— 50 documentos na base</li>
              <li>— 3 números de WhatsApp</li>
              <li>— Sua marca no chat</li>
              <li>— Revisão trimestral da base</li>
            </ul>
          </div>
          <div className="rounded-card border border-border bg-surface p-6">
            <h3 className="font-serif text-lg">Studio</h3>
            <div className="mt-2 font-mono text-3xl text-ink">R$1.197<span className="text-sm font-sans text-muted">/mês</span></div>
            <div className="text-xs text-muted">+ R$1.997 de setup</div>
            <ul className="mt-5 flex flex-col gap-2 text-sm text-ink-soft">
              <li>— 4.000 conversas/mês</li>
              <li>— Documentos ilimitados</li>
              <li>— 10 números de WhatsApp</li>
              <li>— Domínio próprio</li>
              <li>— Suporte dedicado</li>
            </ul>
          </div>
        </div>
        <p className="mt-5 text-sm text-ink-soft">O que conta como conversa? Uma sessão onde a IA de fato responde algo — perguntas que caem em fluxo fixo (horário, endereço) não contam. Anual sai 2 meses grátis.</p>
      </section>

      {/* SOCIAL PROOF */}
      <section className="border-y border-border bg-surface py-14">
        <div className="mx-auto max-w-3xl px-5 text-center">
          <h2 className="font-serif text-xl text-ink">Estou selecionando os primeiros 5 negócios</h2>
          <p className="mt-3 text-ink-soft">Setup grátis para quem entrar agora, em troca de um depoimento em vídeo depois dos primeiros 30 dias. Prefiro ser honesto: ainda não tenho case publicado — mas o primeiro vai ser seu, se topar entrar junto comigo nessa fase.</p>
          <WhatsAppCTA className="mx-auto mt-6 px-6 py-3">Quero ser um dos primeiros</WhatsAppCTA>
        </div>
      </section>

      {/* FOUNDER */}
      <section className="mx-auto max-w-3xl px-5 py-16 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft font-serif text-xl font-bold text-accent-ink">J</div>
        <p className="mt-4 text-ink-soft">
          Eu sou o Jonatha. Construí a RealWise porque vi demais gente perdendo lead porque ninguém respondia a tempo — e porque todo chatbot que testei exigia que eu mesmo escrevesse as respostas do zero. Se você quiser conversar antes de decidir qualquer coisa, me chama direto.
        </p>
        <WhatsAppCTA className="mt-5 px-6 py-3">Falar comigo no WhatsApp</WhatsAppCTA>
      </section>

      {/* FAQ */}
      <section id="faq" className="border-t border-border bg-surface py-16">
        <div className="mx-auto max-w-3xl px-5">
          <h2 className="font-serif text-2xl text-ink md:text-3xl">Perguntas</h2>
          <div className="mt-8 flex flex-col divide-y divide-border">
            {[
              ["Preciso ter site?", "Não. O link funciona sozinho — você cola na bio do Instagram, no status do WhatsApp ou num QR code impresso no balcão."],
              ["Funciona sem a API oficial do WhatsApp?", "Sim, e é assim de propósito. Sem fila de aprovação da Meta, sem taxa por conversa. A única limitação: a gente não manda mensagem automática pro seu cliente — quando precisa avisar algo, você reenvia o link ou chama direto."],
              ["A IA pode errar o preço?", "Preço, horário e disponibilidade vêm de respostas fixas da sua base, nunca inventadas pela IA. Se ela não souber algo, ela avisa e oferece falar com você — nunca chuta."],
              ["Meus dados e os dos meus clientes estão seguros?", "Sim. Seguimos a LGPD: consentimento explícito antes de guardar qualquer dado, criptografia, e você pode pedir exclusão a qualquer momento pelo próprio painel."],
              ["Quanto tempo leva pra ficar pronto?", "A entrevista guiada leva uns 20 minutos. Com os documentos certos em mãos, dá pra publicar no mesmo dia."],
              ["E se eu mudar meus preços depois?", "Edita na sua base de conhecimento e a IA já responde atualizado. Sem precisar reprogramar nada."],
              ["Posso cancelar quando quiser?", "Sim, sem multa. Se cancelar, seus dados ficam disponíveis pra exportação por um tempo antes de serem apagados."],
              ["Precisa saber mexer em tecnologia?", "Não. Se você sabe usar WhatsApp, sabe usar o painel. E a entrevista inicial pode ser feita junto comigo numa chamada."],
              ["Isso substitui minha recepcionista?", "Substitui a parte repetitiva — preço, horário, documentos, agendamento. Decisão final, negociação e atendimento mais delicado continuam sendo seus ou da sua equipe."],
            ].map(([q, a]) => (
              <details key={q} className="group py-4">
                <summary className="cursor-pointer list-none font-medium text-ink marker:content-none">
                  <span className="flex items-center justify-between">
                    {q}
                    <span className="ml-4 text-muted group-open:rotate-45">+</span>
                  </span>
                </summary>
                <p className="mt-2 text-sm text-ink-soft">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="mx-auto max-w-3xl px-5 py-20 text-center">
        <h2 className="font-serif text-3xl text-ink">Seu cliente já está mandando mensagem. A pergunta é quem responde.</h2>
        <div className="mt-7 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <WhatsAppCTA className="px-7 py-3.5">Falar no WhatsApp</WhatsAppCTA>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-border bg-surface py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 text-xs text-muted sm:flex-row">
          <span>© 2026 RealWise</span>
          <div className="flex gap-5">
            <a href="#" className="hover:text-ink">Política de Privacidade</a>
            <a href="#" className="hover:text-ink">Termos de Uso</a>
            <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="hover:text-ink">WhatsApp</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
