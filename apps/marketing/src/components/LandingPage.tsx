import { Reveal } from "./Reveal";
import { CAPABILITY_ICON_PATHS, type NicheConfig } from "../lib/niches";

const WHATSAPP_NUMBER = "5585992265544";
const DASHBOARD_LOGIN_URL = "/imobiliaria/app/login";

function waUrl(context: string) {
  const msg = encodeURIComponent(`Oi! Vi o site da Realwise (${context}) e quero saber mais.`);
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${msg}`;
}

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

function ChannelPill({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm text-ink transition-all duration-200 hover:-translate-y-0.5 hover:border-ink/30 hover:shadow-md">
      {icon}
      {label}
    </span>
  );
}

function CapabilityIcon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 48 48" className="h-11 w-11 transition-transform duration-300 group-hover:-translate-y-1 group-hover:scale-110" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

function ChatBubble({ msg }: { msg: { from: "bot" | "user"; text: string } }) {
  return msg.from === "bot" ? (
    <div className="max-w-[85%] rounded-xl rounded-bl-sm bg-bg-2 px-3 py-2 text-[0.76rem]">{msg.text}</div>
  ) : (
    <div className="ml-auto max-w-[80%] rounded-xl rounded-br-sm bg-ink px-3 py-2 text-[0.76rem] text-bg">{msg.text}</div>
  );
}

export function LandingPage({ niche }: { niche: NicheConfig }) {
  const WHATSAPP_URL = waUrl(niche.label);
  const ctaLabel = niche.earlyAccess ? "Entrar na lista de espera" : "Entrar no painel";
  const navCtaHref = niche.earlyAccess ? WHATSAPP_URL : DASHBOARD_LOGIN_URL;

  return (
    <div className="bg-bg text-ink">
      {/* NAV */}
      <header className="sticky top-0 z-30 border-b border-border/70 bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <a href="/" className="font-serif text-xl font-bold">Realwise</a>
          <nav className="hidden items-center gap-7 text-sm text-ink-soft md:flex">
            <a href="#solucao" className="hover:text-ink">Solução</a>
            <a href="#precos" className="hover:text-ink">Preços</a>
            <a href="#faq" className="hover:text-ink">Perguntas</a>
          </nav>
          <Pill href={navCtaHref} className="px-4 py-2 text-xs">{ctaLabel}</Pill>
        </div>
      </header>

      {/* HERO */}
      <section className="mx-auto max-w-6xl px-5 pb-20 pt-16 text-center md:pb-28 md:pt-24">
        {niche.earlyAccess && (
          <Reveal>
            <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-1.5 text-xs font-semibold text-ink-soft">
              <span className="h-1.5 w-1.5 rounded-full bg-lime" /> Em breve — entre na lista de espera
            </span>
          </Reveal>
        )}
        <Reveal>
          <h1 className="mx-auto max-w-3xl font-serif text-5xl leading-[1.1] text-ink md:text-7xl">
            {niche.heroPre}<em className="italic">{niche.heroEm}</em>.
          </h1>
        </Reveal>
        <Reveal delay={100}>
          <p className="mx-auto mt-6 max-w-xl text-base text-ink-soft md:text-lg">{niche.heroSub}</p>
        </Reveal>
        <Reveal delay={200}>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Pill href={navCtaHref} className="px-7 py-3.5 text-[0.95rem]">{niche.earlyAccess ? "Entrar na lista de espera" : "Começar agora"}</Pill>
            <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center rounded-full border border-ink/20 bg-transparent px-7 py-3.5 text-[0.95rem] font-semibold text-ink transition-all duration-200 hover:-translate-y-0.5 hover:bg-surface">
              Falar no WhatsApp
            </a>
          </div>
        </Reveal>

        <Reveal delay={300} className="relative mx-auto mt-16 max-w-xl">
          <div className="absolute -left-6 -top-6 h-16 w-16 rounded-full bg-lime-soft blur-2xl animate-float md:-left-10 md:-top-10 md:h-24 md:w-24" />
          <div className="absolute -bottom-8 -right-4 h-20 w-20 rounded-full bg-accent-soft blur-2xl animate-float-slow md:h-28 md:w-28" />
          <div className="relative mx-auto w-full max-w-[320px] rounded-[2rem] border border-border bg-surface shadow-2xl transition-transform duration-500 hover:-translate-y-1">
            <div className="flex items-center gap-2.5 border-b border-border px-4 py-3.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft font-serif font-bold text-accent-ink">{niche.heroBusinessInitials}</div>
              <div className="text-left">
                <div className="text-sm font-semibold">{niche.heroBusinessName}</div>
                <div className="flex items-center gap-1 text-[0.7rem] text-positive">
                  <span className="h-1.5 w-1.5 rounded-full bg-positive" /> Online agora
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-2.5 px-4 py-4 text-left">
              {niche.heroMessages.map((m, i) => <ChatBubble key={i} msg={m} />)}
              <div className="flex flex-wrap gap-1.5">
                {niche.heroChips.map((c, i) => (
                  <span key={c} className={i === niche.heroChips.length - 1 ? "rounded-full bg-ink px-2.5 py-1 text-[0.68rem] font-semibold text-bg" : "rounded-full border border-border bg-surface px-2.5 py-1 text-[0.68rem] text-ink-soft"}>
                    {c}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* PROBLEM */}
      <section className="bg-ink py-16 text-bg">
        <Reveal className="mx-auto max-w-5xl px-5">
          <h2 className="text-center font-serif text-2xl md:text-3xl">{niche.problemIntro}</h2>
          <div className="mt-10 grid gap-8 sm:grid-cols-3">
            <div>
              <div className="font-mono text-4xl text-lime">22h47</div>
              <p className="mt-2 text-sm text-bg/70">é quando chega boa parte das perguntas de preço — bem depois de qualquer um estar lá pra responder.</p>
            </div>
            <div>
              <div className="font-mono text-4xl text-lime">2h</div>
              <p className="mt-2 text-sm text-bg/70">é o tempo médio pra um lead esfriar. Quem responde em 5 minutos fecha mais — quem demora, perde pro concorrente.</p>
            </div>
            <div>
              <div className="font-mono text-4xl text-lime">R$ 3.500</div>
              <p className="mt-2 text-sm text-bg/70">custa uma recepcionista por mês, com encargos — e ela não trabalha domingo às 22h.</p>
            </div>
          </div>
        </Reveal>
      </section>

      {/* SOLUTION IN ACTION */}
      <section id="solucao" className="bg-bg-2 py-20">
        <Reveal className="mx-auto max-w-5xl px-5 text-center">
          <h2 className="font-serif text-3xl text-ink md:text-4xl">A Realwise resolve isso <em className="italic">na hora</em></h2>
          <p className="mx-auto mt-3 max-w-md text-ink-soft">Enquanto você está ocupado, ela já respondeu, já agendou e já separou quem está pronto pra fechar.</p>

          <div className="mt-10 grid gap-5 md:grid-cols-2">
            <div className="rounded-3xl bg-surface p-8 text-left transition-all duration-300 hover:-translate-y-1 hover:shadow-xl">
              <div className="mx-auto mb-6 flex w-full max-w-[260px] flex-col gap-2 rounded-2xl border border-border bg-bg p-4">
                {niche.solutionCard1Messages.map((m, i) => <ChatBubble key={i} msg={m} />)}
              </div>
              <h3 className="font-serif text-lg text-ink">{niche.solutionCard1Title}</h3>
              <p className="mt-2 text-sm text-ink-soft">{niche.solutionCard1Desc}</p>
            </div>

            <div className="rounded-3xl bg-surface p-8 text-left transition-all duration-300 hover:-translate-y-1 hover:shadow-xl">
              <div className="mx-auto mb-6 flex w-full max-w-[260px] flex-col gap-2 rounded-2xl border border-border bg-bg p-4">
                {niche.solutionCard2Messages.map((m, i) => <ChatBubble key={i} msg={m} />)}
              </div>
              <h3 className="font-serif text-lg text-ink">{niche.solutionCard2Title}</h3>
              <p className="mt-2 text-sm text-ink-soft">{niche.solutionCard2Desc}</p>
            </div>
          </div>
        </Reveal>
      </section>

      {/* CHANNELS */}
      <section className="py-14">
        <Reveal className="mx-auto max-w-5xl px-5 text-center">
          <h2 className="font-serif text-2xl text-ink">Fale com a Realwise <em className="italic">em qualquer canal</em></h2>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <ChannelPill label="Link na bio" icon={<span>🔗</span>} />
            <ChannelPill label="Story do Instagram" icon={<span>📸</span>} />
            <ChannelPill label="QR code no balcão" icon={<span>▦</span>} />
            <ChannelPill label="Status do WhatsApp" icon={<span className="text-positive">●</span>} />
          </div>
        </Reveal>
      </section>

      {/* CAPABILITIES */}
      <section className="bg-bg-2 py-20">
        <Reveal className="mx-auto max-w-5xl px-5 text-center">
          <h2 className="font-serif text-3xl text-ink md:text-4xl">Capacidades da <em className="italic">Realwise</em></h2>
          <div className="mt-12 grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            {niche.capabilities.map((cap, i) => (
              <div key={cap.title} className="group flex flex-col items-center text-center">
                <div className="mb-4 text-ink">
                  <CapabilityIcon path={CAPABILITY_ICON_PATHS[i]} />
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
          <p className="mx-auto mt-2 max-w-md text-ink-soft">Sem letra miúda. Sem taxa de setup — só a mensalidade.</p>
          <div className="mt-10 grid gap-5 text-left md:grid-cols-3">
            <div className="rounded-3xl border border-border bg-surface p-7 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
              <h3 className="font-serif text-lg">Essencial</h3>
              <div className="mt-2 font-mono text-3xl text-ink">R$297<span className="text-sm font-sans text-muted">/mês</span></div>
              <ul className="mt-5 flex flex-col gap-2 text-sm text-ink-soft">
                <li>— 300 conversas/mês</li>
                <li>— 10 documentos na base</li>
                <li>— Agendamento embutido</li>
                <li>— 1 número de WhatsApp</li>
              </ul>
              <Pill href={niche.earlyAccess ? WHATSAPP_URL : `${DASHBOARD_LOGIN_URL}?plan=essencial`} className="mt-6 w-full justify-center px-6 py-3">
                {niche.earlyAccess ? "Entrar na lista de espera" : "Escolher Essencial"}
              </Pill>
            </div>
            <div className="relative rounded-3xl bg-ink p-7 text-bg transition-all duration-300 hover:-translate-y-1.5 hover:shadow-2xl">
              <span className="absolute -top-3 left-7 rounded-full bg-lime px-3 py-1 text-[0.65rem] font-bold uppercase text-lime-ink">Mais escolhido</span>
              <h3 className="font-serif text-lg">Profissional</h3>
              <div className="mt-2 font-mono text-3xl">R$597<span className="text-sm font-sans opacity-60">/mês</span></div>
              <ul className="mt-5 flex flex-col gap-2 text-sm opacity-90">
                <li>— 1.200 conversas/mês</li>
                <li>— 50 documentos na base</li>
                <li>— 3 números de WhatsApp</li>
                <li>— Sua marca no chat</li>
                <li>— Revisão trimestral da base</li>
              </ul>
              <Pill href={niche.earlyAccess ? WHATSAPP_URL : `${DASHBOARD_LOGIN_URL}?plan=profissional`} className="mt-6 w-full justify-center bg-lime px-6 py-3 text-lime-ink">
                {niche.earlyAccess ? "Entrar na lista de espera" : "Escolher Profissional"}
              </Pill>
            </div>
            <div className="rounded-3xl border border-border bg-surface p-7 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
              <h3 className="font-serif text-lg">Studio</h3>
              <div className="mt-2 font-mono text-3xl text-ink">R$1.197<span className="text-sm font-sans text-muted">/mês</span></div>
              <ul className="mt-5 flex flex-col gap-2 text-sm text-ink-soft">
                <li>— 4.000 conversas/mês</li>
                <li>— Documentos ilimitados</li>
                <li>— 10 números de WhatsApp</li>
                <li>— Domínio próprio</li>
                <li>— Suporte dedicado</li>
              </ul>
            </div>
          </div>
          <p className="mt-6 text-sm text-ink-soft">O que conta como conversa? Uma sessão onde a IA de fato responde algo — perguntas de fluxo fixo (horário, endereço) não contam. Anual sai 2 meses grátis.</p>
        </Reveal>
      </section>

      {/* SOCIAL PROOF */}
      <section className="bg-bg-2 py-16">
        <Reveal className="mx-auto max-w-2xl px-5 text-center">
          <h2 className="font-serif text-2xl text-ink">Estou selecionando os primeiros 5 negócios</h2>
          <p className="mt-3 text-ink-soft">Condições especiais pra quem entrar agora, em troca de um depoimento depois dos primeiros 30 dias. Prefiro ser honesto: ainda não tenho case publicado — mas o primeiro pode ser o seu.</p>
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

      {/* TRUST + GETTING STARTED */}
      <section className="bg-bg-2 py-20">
        <Reveal className="mx-auto grid max-w-5xl items-center gap-10 px-5 md:grid-cols-2">
          <div>
            <h2 className="font-serif text-3xl text-ink md:text-4xl">Ela nunca <em className="italic">chuta</em> uma resposta pro seu cliente</h2>
            <p className="mt-4 text-ink-soft">Antes de publicar, você vê em porcentagem o quanto ela está pronta — e exatamente o que falta pra garantir que todo cliente saia com uma resposta certa.</p>
          </div>
          <div className="rounded-3xl border border-border bg-surface p-7 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl">
            <div className="flex items-center gap-5">
              <div className="font-mono text-4xl text-ink">82%</div>
              <div className="text-xs text-muted">Pronto pra publicar</div>
            </div>
            <div className="mt-5 flex flex-col gap-2.5 text-xs">
              {[["Campos obrigatórios", 92], ["Profundidade de documentos", 70], ["Teste de perguntas reais", 81], ["Atualidade", 88]].map(([label, val]) => (
                <div key={label as string} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                  <span className="w-full shrink-0 text-ink-soft sm:w-40">{label}</span>
                  <div className="flex w-full items-center gap-2 sm:w-auto sm:flex-1">
                    <div className="h-1.5 flex-1 rounded-full bg-bg-2">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${val}%` }} />
                    </div>
                    <span className="w-8 text-right font-mono text-muted">{val}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Reveal>

        <Reveal delay={100} className="mx-auto mt-16 max-w-5xl px-5 text-center">
          <h3 className="font-serif text-xl text-ink">Pra ter isso rodando, são 4 passos</h3>
          <div className="mt-8 grid gap-4 text-left sm:grid-cols-2 lg:grid-cols-4">
            {[
              { t: "Você manda o que já tem", d: "Tabela de preços, foto do quadro de horários — o que estiver à mão." },
              { t: "A IA te entrevista", d: "20 minutos de perguntas simples pra preencher o que falta." },
              { t: "Você testa e aprova", d: "Conversa com sua própria IA antes de qualquer cliente ver." },
              { t: "Cola o link na bio", d: "QR code, texto pronto e story prontos. Em minutos está no ar." },
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
      <section id="faq" className="border-t border-border py-20">
        <Reveal className="mx-auto max-w-2xl px-5">
          <h2 className="text-center font-serif text-3xl text-ink">FAQ</h2>
          <div className="mt-10 flex flex-col divide-y divide-border">
            {[
              ["Preciso ter site?", "Não. O link funciona sozinho — você cola na bio do Instagram, no status do WhatsApp ou num QR code impresso no balcão."],
              ["Funciona sem a API oficial do WhatsApp?", "Sim, de propósito. Sem fila de aprovação da Meta, sem taxa por conversa. A única limitação: a gente não manda mensagem automática pro seu cliente — quando precisa avisar algo, você reenvia o link ou chama direto."],
              niche.faqExtra,
              ["Meus dados e os dos meus clientes estão seguros?", "Sim. Seguimos a LGPD: consentimento explícito antes de guardar qualquer dado, criptografia, e você pode pedir exclusão quando quiser."],
              ["Quanto tempo leva pra ficar pronto?", "A entrevista guiada leva uns 20 minutos. Com os documentos certos em mãos, dá pra publicar no mesmo dia."],
              ["E se eu mudar meus preços depois?", "Edita na sua base de conhecimento e a IA já responde atualizado. Sem reprogramar nada."],
              ["Posso cancelar quando quiser?", "Sim, sem multa. Seus dados ficam disponíveis pra exportação por um tempo antes de serem apagados."],
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
            <Pill href={navCtaHref} className="px-7 py-3.5">{niche.earlyAccess ? "Entrar na lista de espera" : "Começar agora"}</Pill>
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
            <a href="/" className="hover:text-ink">Início</a>
            <a href="/imobiliaria" className="hover:text-ink">Imobiliárias</a>
            <a href="/concessionaria" className="hover:text-ink">Concessionárias</a>
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
