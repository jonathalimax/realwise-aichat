import { Reveal } from "../components/Reveal";

const WHATSAPP_NUMBER = "5585992265544";
const WHATSAPP_MSG = encodeURIComponent("Oi! Vi o site da Realwise e quero saber mais.");
const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}?text=${WHATSAPP_MSG}`;
const DASHBOARD_LOGIN_URL = "/app/login";

function Pill({ href, className = "", children }: { href: string; className?: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target={href.startsWith("http") ? "_blank" : undefined}
      rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-full bg-ink px-5 py-3 text-sm font-semibold text-lime transition-all duration-200 hover:-translate-y-0.5 hover:opacity-85 hover:shadow-lg active:translate-y-0 ${className}`}
    >
      {children}
    </a>
  );
}

function CapabilityIcon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 48 48" className="h-11 w-11 transition-transform duration-300 group-hover:-translate-y-1 group-hover:scale-110" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

export default function MarketingHome() {
  return (
    <div className="bg-bg text-ink">
      {/* NAV */}
      <header className="sticky top-0 z-30 border-b border-border/70 bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <span className="font-serif text-xl font-bold">Realwise</span>
          <nav className="hidden items-center gap-7 text-sm text-ink-soft md:flex">
            <a href="#como-funciona" className="hover:text-ink">Como funciona</a>
            <a href="#nichos" className="hover:text-ink">Nichos</a>
            <a href="#precos" className="hover:text-ink">Preços</a>
            <a href="#faq" className="hover:text-ink">Perguntas</a>
          </nav>
          <div className="flex items-center gap-2">
            <Pill href={DASHBOARD_LOGIN_URL} className="px-4 py-2 text-xs">Entrar no painel</Pill>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="mx-auto max-w-6xl px-5 pb-20 pt-16 text-center md:pb-28 md:pt-24">
        <Reveal>
          <h1 className="mx-auto max-w-2xl font-serif text-5xl leading-[1.1] text-ink md:text-7xl">
            Seu cliente pergunta. <em className="italic">A Clara responde na hora.</em>
          </h1>
        </Reveal>
        <Reveal delay={100}>
          <p className="mx-auto mt-6 max-w-lg text-base text-ink-soft md:text-lg">
            Agenda sozinha e só te chama no WhatsApp quando o lead está pronto pra fechar.
          </p>
        </Reveal>
        <Reveal delay={200}>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Pill href={DASHBOARD_LOGIN_URL} className="px-7 py-3.5 text-[0.95rem]">Começar agora</Pill>
            <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center rounded-full border border-ink/20 bg-transparent px-7 py-3.5 text-[0.95rem] font-semibold text-ink transition-all duration-200 hover:-translate-y-0.5 hover:bg-surface">
              Tirar dúvidas no WhatsApp
            </a>
          </div>
        </Reveal>

        <Reveal delay={300} className="relative mx-auto mt-16 max-w-xl">
          <div className="absolute -left-6 -top-6 h-16 w-16 rounded-full bg-lime-soft blur-2xl animate-float md:-left-10 md:-top-10 md:h-24 md:w-24" />
          <div className="absolute -bottom-8 -right-4 h-20 w-20 rounded-full bg-accent-soft blur-2xl animate-float-slow md:h-28 md:w-28" />
          <div className="relative mx-auto w-full max-w-[320px] rounded-[2rem] border border-border bg-surface shadow-2xl transition-transform duration-500 hover:-translate-y-1">
            <div className="flex items-center gap-2.5 border-b border-border px-4 py-3.5">
              <img src="/clara-avatar.jpg" alt="Clara" className="h-8 w-8 flex-none rounded-lg object-cover" />
              <div className="text-left">
                <div className="text-sm font-semibold">AutoSul Veículos</div>
                <div className="flex items-center gap-1 text-[0.7rem] text-positive">
                  <span className="h-1.5 w-1.5 rounded-full bg-positive" /> Clara · Online agora
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-2.5 px-4 py-4 text-left">
              <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-bg-2 px-3.5 py-2.5 text-[0.82rem]">
                Oi! Posso ajudar com estoque, financiamento ou agendar um test-drive.
              </div>
              <div className="ml-auto max-w-[75%] rounded-2xl rounded-br-sm bg-ink px-3.5 py-2.5 text-[0.82rem] text-bg">
                Vocês têm o Corolla 2023?
              </div>
              <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-bg-2 px-3.5 py-2.5 text-[0.82rem]">
                Temos! Corolla XEi 2023, automático, 18.400 km, R$ 128.900.
              </div>
              <div className="flex flex-wrap gap-1.5">
                <span className="rounded-full border border-border bg-surface px-2.5 py-1 text-[0.68rem] text-ink-soft">Simular financiamento</span>
                <span className="rounded-full bg-ink px-2.5 py-1 text-[0.68rem] font-semibold text-bg">📅 Test-drive</span>
              </div>
            </div>
            <div className="flex items-center gap-2 border-t border-border px-4 py-3">
              <div className="flex-1 rounded-full border border-border bg-bg-2 px-4 py-2 text-left text-[0.78rem] text-ink-soft">
                Escreva sua pergunta…
              </div>
              <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-accent text-sm text-white">➤</div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* PROBLEM */}
      <section className="bg-ink py-16 text-bg">
        <Reveal className="mx-auto max-w-3xl px-5 text-center">
          <h2 className="font-serif text-2xl md:text-3xl">Toda hora, alguém pergunta a mesma coisa. E ninguém responde.</h2>
          <p className="mt-5 text-bg/70">
            É sempre fora do horário comercial, no fim de semana, ou bem na hora em que ninguém pode largar o que está fazendo pra responder. O cliente espera, esfria, e vai perguntar pro concorrente — que às vezes responde primeiro só por estar online na hora certa.
          </p>
        </Reveal>
      </section>

      {/* SOLUTION IN ACTION */}
      <section id="solucao" className="bg-bg-2 py-20">
        <Reveal className="mx-auto max-w-5xl px-5 text-center">
          <h2 className="font-serif text-3xl text-ink md:text-4xl">Ela responde. Agenda. E só te chama quando vale a pena.</h2>

          <div className="mt-10 grid gap-5 md:grid-cols-2">
            <div className="rounded-3xl bg-surface p-8 text-left transition-all duration-300 hover:-translate-y-1 hover:shadow-xl">
              {/* Mirrors the real chat UI in apps/chat: header, bubbles, tappable options, pill input */}
              <div className="mx-auto mb-6 flex w-full max-w-[260px] flex-col overflow-hidden rounded-2xl border border-border bg-bg">
                <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
                  <img src="/clara-avatar.jpg" alt="Clara" className="h-7 w-7 flex-none rounded-lg object-cover" />
                  <div>
                    <div className="text-[0.72rem] font-semibold text-ink">Imóveis Costa</div>
                    <div className="flex items-center gap-1 text-[0.62rem] text-positive">
                      <span className="h-1 w-1 rounded-full bg-positive" /> Clara · Online agora
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-2 px-3 py-3">
                  <div className="max-w-[80%] rounded-xl rounded-bl-sm bg-bg-2 px-3 py-2 text-[0.72rem]">Oi! Qual horário funciona pra visita?</div>
                  <div className="ml-auto max-w-[80%] rounded-xl rounded-br-sm bg-accent px-3 py-2 text-[0.72rem] text-white">Sábado de manhã</div>
                  <div className="max-w-[80%] rounded-xl rounded-bl-sm bg-bg-2 px-3 py-2 text-[0.72rem]">Fechado! Te mando a confirmação.</div>
                </div>
                <div className="flex flex-wrap gap-1.5 px-3 pb-2.5">
                  <span className="rounded-full border border-border bg-surface px-2.5 py-1 text-[0.62rem] text-ink-soft">Ver outro horário</span>
                  <span className="rounded-full border border-border bg-surface px-2.5 py-1 text-[0.62rem] text-ink-soft">Confirmar</span>
                </div>
                <div className="flex items-center gap-2 border-t border-border px-3 py-2">
                  <div className="flex-1 rounded-full bg-bg-2 px-3 py-1.5 text-[0.62rem] text-muted">Escreva sua pergunta…</div>
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-ink text-[0.6rem] text-bg">➤</div>
                </div>
              </div>
              <h3 className="font-serif text-lg text-ink">Agenda sozinha</h3>
              <p className="mt-2 text-sm text-ink-soft">O cliente marca o horário direto no chat, sem ida e volta.</p>
            </div>

            <div className="rounded-3xl bg-surface p-8 text-left transition-all duration-300 hover:-translate-y-1 hover:shadow-xl">
              <div className="mx-auto mb-6 flex w-full max-w-[260px] flex-col overflow-hidden rounded-2xl border border-border bg-bg">
                <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
                  <img src="/clara-avatar.jpg" alt="Clara" className="h-7 w-7 flex-none rounded-lg object-cover" />
                  <div>
                    <div className="text-[0.72rem] font-semibold text-ink">Imóveis Costa</div>
                    <div className="flex items-center gap-1 text-[0.62rem] text-positive">
                      <span className="h-1 w-1 rounded-full bg-positive" /> Clara · Online agora
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-2 px-3 py-3">
                  <div className="ml-auto max-w-[85%] rounded-xl rounded-br-sm bg-accent px-3 py-2 text-[0.72rem] text-white">Quero fechar hoje, pode ser?</div>
                  <div className="max-w-[85%] rounded-xl rounded-bl-sm bg-bg-2 px-3 py-2 text-[0.72rem]">Claro! Vou te passar direto pro WhatsApp.</div>
                  <span className="ml-auto rounded-full bg-lime px-2.5 py-1 text-[0.62rem] font-semibold text-lime-ink">🔥 Lead quente</span>
                </div>
                <div className="flex items-center gap-2 border-t border-border px-3 py-2">
                  <div className="flex-1 rounded-full bg-bg-2 px-3 py-1.5 text-[0.62rem] text-muted">Escreva sua pergunta…</div>
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-ink text-[0.6rem] text-bg">➤</div>
                </div>
              </div>
              <h3 className="font-serif text-lg text-ink">Só te chama quando o lead está quente</h3>
              <p className="mt-2 text-sm text-ink-soft">Seu WhatsApp não vira caixa de spam — só recebe quem já está pronto pra decidir.</p>
            </div>
          </div>
        </Reveal>
      </section>

      {/* NICHE PICKER */}
      <section id="nichos" className="py-20">
        <Reveal className="mx-auto max-w-5xl px-5 text-center">
          <h2 className="font-serif text-3xl text-ink md:text-4xl">Feito pro seu <em className="italic">tipo de negócio</em></h2>
          <p className="mx-auto mt-3 max-w-md text-ink-soft">A entrevista, os exemplos e as respostas mudam de acordo com o seu nicho.</p>
          <div className="mt-10 grid gap-5 sm:grid-cols-2">
            <a href="/imobiliarias" className="group rounded-3xl border border-border bg-surface p-8 text-left transition-all duration-300 hover:-translate-y-1 hover:shadow-xl">
              <h3 className="font-serif text-xl text-ink">Imobiliárias</h3>
              <p className="mt-2 text-sm text-ink-soft">Documentos, fiador, seguro fiança e agendamento de visita — explicado antes do cliente ligar.</p>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-accent">Ver página do nicho <span className="transition-transform group-hover:translate-x-1">→</span></span>
            </a>
            <a href="/concessionarias" className="group rounded-3xl border border-border bg-surface p-8 text-left transition-all duration-300 hover:-translate-y-1 hover:shadow-xl">
              <h3 className="font-serif text-xl text-ink">Concessionárias</h3>
              <p className="mt-2 text-sm text-ink-soft">Estoque, simulação de financiamento, avaliação de troca e test-drive, direto no chat.</p>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-accent">Ver página do nicho <span className="transition-transform group-hover:translate-x-1">→</span></span>
            </a>
          </div>
          <p className="mt-8 text-sm text-ink-soft">
            Seu negócio não é desses dois?{" "}
            <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent underline underline-offset-2 hover:text-ink">
              Fala com a gente no WhatsApp
            </a>{" "}
            e vemos como te atender.
          </p>
        </Reveal>
      </section>

      {/* CAPABILITIES */}
      <section className="bg-bg-2 py-20">
        <Reveal className="mx-auto max-w-5xl px-5 text-center">
          <h2 className="font-serif text-3xl text-ink md:text-4xl">Capacidades da <em className="italic">Realwise</em></h2>
          <div className="mt-12 grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { title: "Responde em segundos", desc: "Sem bot travado nem resposta de minutos depois — o cliente pergunta e já recebe resposta.", path: "M24 4a20 20 0 100 40 20 20 0 000-40zm0 10v10l7 6" },
              { title: "Agenda sem ida e volta", desc: "Marca visita, test-drive ou avaliação direto no chat, sem sair pra outro app.", path: "M10 8h28a2 2 0 012 2v28a2 2 0 01-2 2H10a2 2 0 01-2-2V10a2 2 0 012-2zM8 18h32M16 4v8M32 4v8M18 26l4 4 8-8" },
              { title: "Te chama na hora certa", desc: "Quando o cliente quer falar com você, ela já abre o WhatsApp com a conversa pronta.", path: "M24 4a10 10 0 00-10 10c0 7 10 18 10 18s10-11 10-18A10 10 0 0024 4zm0 14a4 4 0 110-8 4 4 0 010 8z" },
              { title: "Nunca inventa resposta", desc: "Se não sabe algo, admite e te chama — nunca chuta preço ou prazo pro seu cliente.", path: "M24 42a18 18 0 100-36 18 18 0 000 36zM24 24V10M24 24l10 6" },
              { title: "Pergunte sobre seus leads", desc: "Pergunte sobre leads, métricas ou sua base em português simples — ela só edita seu perfil com sua aprovação.", path: "M8 8h32v24H18l-6 6v-6H8zM16 16h16M16 22h10" },
              { title: "Sincroniza com sua agenda", desc: "Pra quem usa Google Calendar, os horários livres já aparecem certos — sem checar duas agendas.", path: "M10 8h28a2 2 0 012 2v28a2 2 0 01-2 2H10a2 2 0 01-2-2V10a2 2 0 012-2zM8 18h32M16 4v8M32 4v8M18 30l4 4 10-10" },
            ].map((cap) => (
              <div key={cap.title} className="group flex flex-col items-center text-center">
                <div className="mb-4 text-ink">
                  <CapabilityIcon path={cap.path} />
                </div>
                <h3 className="font-serif text-base text-ink">{cap.title}</h3>
                <p className="mt-2 text-sm text-ink-soft">{cap.desc}</p>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* PRICING */}
      <section id="precos" className="py-20">
        <Reveal className="mx-auto max-w-5xl px-5 text-center">
          <h2 className="font-serif text-3xl text-ink md:text-4xl">Preço</h2>
          <p className="mx-auto mt-2 max-w-md text-ink-soft">Sem letra miúda. Taxa de setup única, mais a mensalidade.</p>
          <div className="mt-10 grid gap-5 text-left md:grid-cols-2">
            <div className="rounded-3xl border border-border bg-surface p-7 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
              <h3 className="font-serif text-lg">Essencial</h3>
              <div className="mt-2 font-mono text-3xl text-ink">R$297<span className="text-sm font-sans text-muted">/mês</span></div>
              <div className="text-xs text-muted">+ R$99 de setup</div>
              <ul className="mt-5 flex flex-col gap-2 text-sm text-ink-soft">
                <li>— 100 conversas/mês</li>
                <li>— 10 documentos na base</li>
                <li>— Agendamento embutido</li>
                <li>— 1 número de WhatsApp</li>
                <li>— Analytics básico</li>
              </ul>
              <Pill href={`${DASHBOARD_LOGIN_URL}?plan=essencial`} className="mt-6 w-full justify-center px-6 py-3">Escolher Essencial</Pill>
            </div>
            <div className="relative rounded-3xl bg-ink p-7 text-bg transition-all duration-300 hover:-translate-y-1.5 hover:shadow-2xl">
              <span className="absolute -top-3 left-7 rounded-full bg-lime px-3 py-1 text-[0.65rem] font-bold uppercase text-lime-ink">Mais escolhido</span>
              <h3 className="font-serif text-lg">Profissional</h3>
              <div className="mt-2 font-mono text-3xl">R$697<span className="text-sm font-sans opacity-60">/mês</span></div>
              <div className="text-xs opacity-60">+ R$997 de setup</div>
              <span className="mt-3 inline-block rounded-full bg-lime px-2.5 py-1 text-[0.68rem] font-bold text-lime-ink">50x mais conversas que o Essencial</span>
              <ul className="mt-4 flex flex-col gap-2 text-sm opacity-90">
                <li>— 5.000 conversas/mês</li>
                <li>— Documentos ilimitados</li>
                <li>— 5 números de WhatsApp</li>
                <li>— Sincronização com Google Calendar</li>
                <li>— Sua marca e domínio próprio</li>
                <li>— Suporte prioritário</li>
              </ul>
              <Pill href={`${DASHBOARD_LOGIN_URL}?plan=profissional`} className="mt-6 w-full justify-center bg-lime px-6 py-3 text-lime-ink">Escolher Profissional</Pill>
            </div>
          </div>
          <p className="mt-6 text-sm text-ink-soft">O que conta como conversa? Uma sessão onde a IA de fato responde algo — perguntas de fluxo fixo (horário, endereço) não contam.</p>
        </Reveal>
      </section>

      {/* SOCIAL PROOF */}
      <section className="bg-bg-2 py-16">
        <Reveal className="mx-auto max-w-2xl px-5 text-center">
          <h2 className="font-serif text-2xl text-ink">Estou selecionando os primeiros 5 negócios</h2>
          <p className="mt-3 text-ink-soft">Setup grátis pra quem entrar agora, em troca de um depoimento depois dos primeiros 30 dias. Prefiro ser honesto: ainda não tenho case publicado — mas o primeiro pode ser o seu.</p>
          <Pill href={WHATSAPP_URL} className="mx-auto mt-6 px-6 py-3">Quero ser um dos primeiros</Pill>
        </Reveal>
      </section>

      {/* FOUNDER */}
      <section className="mx-auto max-w-2xl px-5 py-20 text-center">
        <Reveal>
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-ink font-serif text-xl font-bold text-bg">J</div>
          <p className="mt-5 text-ink-soft">
            Eu sou o Jonatha. Construí a Realwise porque vi demais gente perdendo lead porque ninguém respondia a tempo — e porque todo chatbot que testei exigia que eu mesmo escrevesse as respostas do zero. Se quiser conversar antes de decidir, me chama direto.
          </p>
          <Pill href={WHATSAPP_URL} className="mx-auto mt-5 px-6 py-3">Falar comigo no WhatsApp</Pill>
        </Reveal>
      </section>

      {/* GETTING STARTED */}
      <section id="como-funciona" className="bg-bg-2 py-20">
        <Reveal className="mx-auto max-w-5xl px-5 text-center">
          <h2 className="font-serif text-3xl text-ink md:text-4xl">Pra ter isso rodando, são 4 passos</h2>
          <div className="mt-10 grid gap-4 text-left sm:grid-cols-2 lg:grid-cols-4">
            {[
              { t: "Adicione seu site e documentos", d: "Tabela de preços, horários, políticas — o que estiver à mão." },
              { t: "Tudo fica privado", d: "Seus documentos ficam na nossa infraestrutura, só pra você — nunca usamos pra treinar modelos de IA." },
              { t: "A IA te faz algumas perguntas", d: "Só o que faltar depois de ler seus documentos. Rápido." },
              { t: "Pronto — seu link pra compartilhar", d: "Cola na bio, no story ou manda direto. Em minutos está no ar." },
            ].map((step, i) => (
              <div key={step.t} className="rounded-2xl bg-surface p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
                <div className="font-mono text-xs text-muted">Passo {i + 1}</div>
                <h4 className="mt-2 font-serif text-base text-ink">{step.t}</h4>
                <p className="mt-2 text-sm text-ink-soft">{step.d}</p>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      {/* FAQ */}
      <section id="faq" className="border-t border-border bg-bg-2 py-20">
        <Reveal className="mx-auto max-w-2xl px-5">
          <h2 className="text-center font-serif text-3xl text-ink">FAQ</h2>
          <div className="mt-10 flex flex-col divide-y divide-border">
            {[
              ["Preciso ter site?", "Não. O link funciona sozinho — você cola na bio do Instagram, no status do WhatsApp ou num QR code impresso no balcão."],
              ["Funciona sem a API oficial do WhatsApp?", "Sim, de propósito. Sem fila de aprovação da Meta, sem taxa por conversa. A única limitação: a gente não manda mensagem automática pro seu cliente — quando precisa avisar algo, você reenvia o link ou chama direto."],
              ["A IA pode errar o preço?", "Preço, horário e disponibilidade vêm de respostas fixas da sua base, nunca inventadas. Se ela não souber algo, avisa e oferece falar com você."],
              ["Meus dados e os dos meus clientes estão seguros?", "Sim. Seguimos a LGPD: consentimento explícito antes de guardar qualquer dado, criptografia, e você pode pedir exclusão quando quiser."],
              ["Quanto tempo leva pra ficar pronto?", "A entrevista guiada leva uns 20 minutos. Com os documentos certos em mãos, dá pra publicar no mesmo dia."],
              ["E se eu mudar meus preços depois?", "Edita na sua base de conhecimento e a IA já responde atualizado. Sem reprogramar nada."],
              ["Posso cancelar quando quiser?", "Sim, sem multa. Seus dados ficam disponíveis pra exportação por um tempo antes de serem apagados."],
              ["Isso substitui minha recepcionista?", "Substitui a parte repetitiva — preço, horário, documentos, agendamento. Decisão final e atendimento mais delicado continuam sendo seus."],
            ].map(([q, a]) => (
              <details key={q} className="group py-4">
                <summary className="cursor-pointer list-none font-medium text-ink marker:content-none">
                  <span className="flex items-center justify-between">
                    {q}
                    <span className="ml-4 text-muted transition group-open:rotate-45">+</span>
                  </span>
                </summary>
                <p className="mt-2 text-sm text-ink-soft">{a}</p>
              </details>
            ))}
          </div>
        </Reveal>
      </section>

      {/* FINAL CTA */}
      <section className="mx-auto max-w-2xl px-5 py-20 text-center">
        <Reveal>
          <h2 className="font-serif text-3xl text-ink md:text-4xl">Seu cliente já está mandando mensagem. <em className="italic">A pergunta é quem responde.</em></h2>
          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Pill href={DASHBOARD_LOGIN_URL} className="px-7 py-3.5">Começar agora</Pill>
            <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-ink-soft hover:text-ink">
              ou falar no WhatsApp antes
            </a>
          </div>
        </Reveal>
      </section>

      {/* FOOTER */}
      <footer className="bg-bg-2 pt-10">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-5 px-5 pb-6 sm:flex-row">
          <span className="font-serif text-lg font-bold">Realwise</span>
          <nav className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-ink-soft">
            <a href="#" className="hover:text-ink">Início</a>
            <a href="#como-funciona" className="hover:text-ink">Como funciona</a>
            <a href="#precos" className="hover:text-ink">Preços</a>
            <a href="#faq" className="hover:text-ink">FAQ</a>
          </nav>
        </div>
        <div className="border-t border-border px-5 py-5 text-center text-xs text-muted">
          © 2026 Realwise. Todos os direitos reservados. <a href="#" className="underline hover:text-ink">Política de Privacidade</a>
        </div>
      </footer>
    </div>
  );
}
