const WHATSAPP_NUMBER = "5585992265544";
const WHATSAPP_MSG = encodeURIComponent("Oi! Vi o site da Realwise e quero saber mais.");
const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}?text=${WHATSAPP_MSG}`;

function Pill({ href, className = "", children }: { href: string; className?: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target={href.startsWith("http") ? "_blank" : undefined}
      rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-full bg-ink px-5 py-3 text-sm font-semibold text-bg transition hover:opacity-85 ${className}`}
    >
      {children}
    </a>
  );
}

function ChannelPill({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm text-ink">
      {icon}
      {label}
    </span>
  );
}

function PolaroidCard({ badge, from, to }: { badge: string; from: string; to: string }) {
  return (
    <div className="relative aspect-[4/5] overflow-hidden rounded-2xl" style={{ background: `linear-gradient(145deg, ${from}, ${to})` }}>
      <span className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-[0.72rem] font-medium text-bg">
        {badge}
      </span>
    </div>
  );
}

function CapabilityIcon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 48 48" className="h-11 w-11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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
          <Pill href={WHATSAPP_URL} className="px-4 py-2 text-xs">Falar no WhatsApp</Pill>
        </div>
      </header>

      {/* HERO */}
      <section className="mx-auto max-w-6xl px-5 pb-20 pt-16 text-center md:pb-28 md:pt-24">
        <h1 className="mx-auto max-w-3xl font-serif text-5xl leading-[1.1] text-ink md:text-7xl">
          Seu atendimento <em className="italic">não dorme</em>.
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-base text-ink-soft md:text-lg">
          Um link na sua bio do Instagram responde quem pergunta preço às 22h, agenda a visita e te passa o cliente pronto no seu WhatsApp.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Pill href={WHATSAPP_URL} className="px-7 py-3.5 text-[0.95rem]">Falar no WhatsApp</Pill>
          <a href="#como-funciona" className="inline-flex items-center justify-center rounded-full border border-ink/20 bg-transparent px-7 py-3.5 text-[0.95rem] font-semibold text-ink hover:bg-surface">
            Ver como funciona
          </a>
        </div>

        <div className="relative mx-auto mt-16 max-w-xl">
          <div className="absolute -left-6 -top-6 h-16 w-16 rounded-full bg-clay-soft blur-2xl md:-left-10 md:-top-10 md:h-24 md:w-24" />
          <div className="absolute -bottom-8 -right-4 h-20 w-20 rounded-full bg-accent-soft blur-2xl md:h-28 md:w-28" />
          <div className="relative mx-auto w-full max-w-[320px] rounded-[2rem] border border-border bg-surface shadow-2xl">
            <div className="flex items-center gap-2.5 border-b border-border px-4 py-3.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft font-serif font-bold text-accent-ink">AS</div>
              <div className="text-left">
                <div className="text-sm font-semibold">AutoSul Veículos</div>
                <div className="flex items-center gap-1 text-[0.7rem] text-positive">
                  <span className="h-1.5 w-1.5 rounded-full bg-positive" /> Online agora
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
              <div className="flex gap-1.5">
                <span className="rounded-full border border-border bg-surface px-2.5 py-1 text-[0.68rem] text-ink-soft">Simular financiamento</span>
                <span className="rounded-full bg-ink px-2.5 py-1 text-[0.68rem] font-semibold text-bg">📅 Test-drive</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* WHY USE — two cards */}
      <section className="bg-bg-2 py-20">
        <div className="mx-auto max-w-5xl px-5 text-center">
          <h2 className="font-serif text-3xl text-ink md:text-4xl">Por que usar a <em className="italic">Realwise</em>?</h2>
          <p className="mx-auto mt-3 max-w-md text-ink-soft">Veja abaixo por que é simples montar — e difícil o cliente perceber que é uma IA.</p>

          <div className="mt-10 grid gap-5 md:grid-cols-2">
            <div className="rounded-3xl bg-surface p-8 text-left">
              <div className="mx-auto mb-6 w-full max-w-[260px] rounded-2xl border border-border bg-bg p-4">
                <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-soft">Checklist de documentos</div>
                {["RG e CPF do locatário", "Comprovante de renda", "Comprovante de residência", "Fiador ou seguro fiança"].map((item) => (
                  <div key={item} className="mb-2 flex items-center gap-2 rounded-lg bg-positive-soft px-2.5 py-1.5 text-[0.78rem] text-ink">
                    <span className="flex h-4 w-4 items-center justify-center rounded bg-positive text-[0.6rem] text-white">✓</span>
                    {item}
                  </div>
                ))}
              </div>
              <h3 className="font-serif text-lg text-ink">Seu atendente particular</h3>
              <p className="mt-2 text-sm text-ink-soft">A IA entrevista você, monta a base de conhecimento e já sabe explicar documentos, prazos e política antes do cliente perguntar.</p>
            </div>

            <div className="rounded-3xl bg-surface p-8 text-left">
              <div className="mx-auto mb-6 flex w-full max-w-[260px] flex-col gap-2 rounded-2xl border border-border bg-bg p-4">
                <div className="max-w-[80%] rounded-xl rounded-bl-sm bg-bg-2 px-3 py-2 text-[0.76rem]">Oi! Qual horário funciona pra visita?</div>
                <div className="ml-auto max-w-[80%] rounded-xl rounded-br-sm bg-ink px-3 py-2 text-[0.76rem] text-bg">Sábado de manhã</div>
                <div className="max-w-[80%] rounded-xl rounded-bl-sm bg-bg-2 px-3 py-2 text-[0.76rem]">Fechado! Te mando a confirmação.</div>
              </div>
              <h3 className="font-serif text-lg text-ink">Seu lead quente, na hora</h3>
              <p className="mt-2 text-sm text-ink-soft">Cada conversa vira um lead com nota de temperatura. Você entra no painel e já sabe quem chamar primeiro no WhatsApp.</p>
            </div>
          </div>
        </div>
      </section>

      {/* TALK ANYWHERE */}
      <section id="nichos" className="py-20">
        <div className="mx-auto max-w-5xl px-5 text-center">
          <h2 className="font-serif text-3xl text-ink md:text-4xl">Fale com a Realwise <em className="italic">em qualquer canal</em></h2>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <ChannelPill label="Link na bio" icon={<span>🔗</span>} />
            <ChannelPill label="Story do Instagram" icon={<span>📸</span>} />
            <ChannelPill label="QR code no balcão" icon={<span>▦</span>} />
            <ChannelPill label="Status do WhatsApp" icon={<span className="text-positive">●</span>} />
          </div>

          <div className="mt-10 grid grid-cols-2 gap-4 md:grid-cols-3">
            <PolaroidCard badge="📅 Agendar visita" from="#E8D9C3" to="#D9C3A3" />
            <PolaroidCard badge="💰 Simular financiamento" from="#CFE0D6" to="#AFC9B9" />
            <PolaroidCard badge="📄 Checklist de documentos" from="#E3DCEE" to="#C9BEDD" />
          </div>
        </div>
      </section>

      {/* CAPABILITIES */}
      <section className="bg-bg-2 py-20">
        <div className="mx-auto max-w-5xl px-5 text-center">
          <h2 className="font-serif text-3xl text-ink md:text-4xl">Capacidades da <em className="italic">Realwise</em></h2>
          <div className="mt-12 grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { title: "Base de conhecimento", desc: "Monta sozinha a partir dos seus documentos e de uma entrevista guiada de 20 minutos.", path: "M12 10h24M12 20h24M12 30h16M8 6h32a2 2 0 012 2v32a2 2 0 01-2 2H8a2 2 0 01-2-2V8a2 2 0 012-2z" },
              { title: "Agendamento embutido", desc: "Marca visita, test-drive ou avaliação direto no chat, sem sair pra outro app.", path: "M10 8h28a2 2 0 012 2v28a2 2 0 01-2 2H10a2 2 0 01-2-2V10a2 2 0 012-2zM8 18h32M16 4v8M32 4v8M18 26l4 4 8-8" },
              { title: "Escalonamento humano", desc: "Quando a IA não sabe, ela avisa e já abre o WhatsApp do seu time com a conversa pronta.", path: "M24 4a10 10 0 00-10 10c0 7 10 18 10 18s10-11 10-18A10 10 0 0024 4zm0 14a4 4 0 110-8 4 4 0 010 8z" },
              { title: "Medidor de prontidão", desc: "Mostra em número o quanto sua base está pronta antes de qualquer cliente conversar.", path: "M24 42a18 18 0 100-36 18 18 0 000 36zM24 24V10M24 24l10 6" },
            ].map((cap) => (
              <div key={cap.title} className="flex flex-col items-center text-center">
                <div className="mb-4 text-ink">
                  <CapabilityIcon path={cap.path} />
                </div>
                <h3 className="font-serif text-base text-ink">{cap.title}</h3>
                <p className="mt-2 text-sm text-ink-soft">{cap.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CONFIDENCE METER */}
      <section className="py-20">
        <div className="mx-auto grid max-w-5xl items-center gap-10 px-5 md:grid-cols-2">
          <div>
            <h2 className="font-serif text-3xl text-ink md:text-4xl">Você sabe se está <em className="italic">pronto</em>. Com número.</h2>
            <p className="mt-4 text-ink-soft">A maioria dos chatbots entrega uma tela em branco e torce pra você preencher sozinho. A gente mostra, em porcentagem, o que falta antes de publicar.</p>
          </div>
          <div className="rounded-3xl border border-border bg-surface p-7">
            <div className="flex items-center gap-5">
              <div className="font-mono text-4xl text-ink">82%</div>
              <div className="text-xs text-muted">Pronto pra publicar</div>
            </div>
            <div className="mt-5 flex flex-col gap-2.5 text-xs">
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

      {/* HOW IT WORKS */}
      <section id="como-funciona" className="bg-bg-2 py-20">
        <div className="mx-auto max-w-5xl px-5 text-center">
          <h2 className="font-serif text-3xl text-ink md:text-4xl">Como funciona</h2>
          <p className="mx-auto mt-2 max-w-md text-ink-soft">Quatro passos, a maior parte feita com você numa chamada de 20 minutos.</p>
          <div className="mt-10 grid gap-5 text-left sm:grid-cols-2 lg:grid-cols-4">
            {[
              { t: "Você manda o que já tem", d: "Tabela de preços, foto do quadro de horários — o que estiver à mão." },
              { t: "A IA te entrevista", d: "20 minutos de perguntas simples pra preencher o que falta." },
              { t: "Você aprova e vê a prontidão", d: "Um medidor de 0 a 100% mostra o que falta antes de publicar." },
              { t: "Recebe o link e cola na bio", d: "QR code, texto pronto e story prontos. Em minutos está no ar." },
            ].map((step, i) => (
              <div key={step.t} className="rounded-2xl bg-surface p-5">
                <div className="font-mono text-xs text-muted">Passo {i + 1}</div>
                <h3 className="mt-2 font-serif text-base text-ink">{step.t}</h3>
                <p className="mt-2 text-sm text-ink-soft">{step.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="precos" className="py-20">
        <div className="mx-auto max-w-5xl px-5 text-center">
          <h2 className="font-serif text-3xl text-ink md:text-4xl">Preço</h2>
          <p className="mx-auto mt-2 max-w-md text-ink-soft">Sem letra miúda. Taxa de setup única, mais a mensalidade.</p>
          <div className="mt-10 grid gap-5 text-left md:grid-cols-3">
            <div className="rounded-3xl border border-border bg-surface p-7">
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
            <div className="relative rounded-3xl bg-ink p-7 text-bg">
              <span className="absolute -top-3 left-7 rounded-full bg-clay px-3 py-1 text-[0.65rem] font-bold uppercase text-white">Mais escolhido</span>
              <h3 className="font-serif text-lg">Profissional</h3>
              <div className="mt-2 font-mono text-3xl">R$597<span className="text-sm font-sans opacity-60">/mês</span></div>
              <div className="text-xs opacity-60">+ R$997 de setup</div>
              <ul className="mt-5 flex flex-col gap-2 text-sm opacity-90">
                <li>— 1.200 conversas/mês</li>
                <li>— 50 documentos na base</li>
                <li>— 3 números de WhatsApp</li>
                <li>— Sua marca no chat</li>
                <li>— Revisão trimestral da base</li>
              </ul>
            </div>
            <div className="rounded-3xl border border-border bg-surface p-7">
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
          <p className="mt-6 text-sm text-ink-soft">O que conta como conversa? Uma sessão onde a IA de fato responde algo — perguntas de fluxo fixo (horário, endereço) não contam. Anual sai 2 meses grátis.</p>
        </div>
      </section>

      {/* SOCIAL PROOF */}
      <section className="bg-bg-2 py-16">
        <div className="mx-auto max-w-2xl px-5 text-center">
          <h2 className="font-serif text-2xl text-ink">Estou selecionando os primeiros 5 negócios</h2>
          <p className="mt-3 text-ink-soft">Setup grátis pra quem entrar agora, em troca de um depoimento depois dos primeiros 30 dias. Prefiro ser honesto: ainda não tenho case publicado — mas o primeiro pode ser o seu.</p>
          <Pill href={WHATSAPP_URL} className="mx-auto mt-6 px-6 py-3">Quero ser um dos primeiros</Pill>
        </div>
      </section>

      {/* FOUNDER */}
      <section className="mx-auto max-w-2xl px-5 py-20 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-ink font-serif text-xl font-bold text-bg">J</div>
        <p className="mt-5 text-ink-soft">
          Eu sou o Jonatha. Construí a Realwise porque vi demais gente perdendo lead porque ninguém respondia a tempo — e porque todo chatbot que testei exigia que eu mesmo escrevesse as respostas do zero. Se quiser conversar antes de decidir, me chama direto.
        </p>
        <Pill href={WHATSAPP_URL} className="mx-auto mt-5 px-6 py-3">Falar comigo no WhatsApp</Pill>
      </section>

      {/* FAQ */}
      <section id="faq" className="border-t border-border bg-bg-2 py-20">
        <div className="mx-auto max-w-2xl px-5">
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
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="mx-auto max-w-2xl px-5 py-20 text-center">
        <h2 className="font-serif text-3xl text-ink md:text-4xl">Seu cliente já está mandando mensagem. <em className="italic">A pergunta é quem responde.</em></h2>
        <Pill href={WHATSAPP_URL} className="mx-auto mt-7 px-7 py-3.5">Falar no WhatsApp</Pill>
      </section>

      {/* FOOTER */}
      <footer className="bg-bg-2 pt-10">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-5 px-5 pb-6 sm:flex-row">
          <span className="font-serif text-lg font-bold">Realwise</span>
          <nav className="flex gap-6 text-sm text-ink-soft">
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
