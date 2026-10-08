"use client";

import { useState } from "react";

// Faithful port of apps/chat/src/components/ChatScreen.tsx's assistant-message rendering
// (MessageContent markdown + ListingCards + SimulationCard) into a standalone dashboard component —
// same precedent as apps/admin/src/components/tenant/ListingPreview.tsx, kept separate rather than
// a cross-app import because apps/dashboard and apps/chat don't share a component package
// (packages/ui only holds design tokens). Any visual/markup change to ChatScreen.tsx's
// assistant-turn rendering must be mirrored here (and in apps/admin's own copy of this file) so
// this "what the visitor actually saw" mirror never drifts from the real chat widget.

function safeHttpUrl(u?: string | null): string | undefined {
  if (!u) return undefined;
  try {
    const parsed = new URL(u);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// --- Markdown rendering (port of ChatScreen's MessageContent, same tokenizer/precedence) ---

const UL_LINE = /^(\s*)[-*+]\s+(.*)$/;
const OL_LINE = /^(\s*)\d+\.\s+(.*)$/;
const HEADING_LINE = /^(\s*)#{1,6}\s+(.*)$/;

type LineKind = "ul" | "ol" | "heading" | "paragraph";
interface ParsedLine {
  kind: LineKind;
  indent: number;
  content: string;
}

function parseLine(line: string): ParsedLine {
  const headingMatch = HEADING_LINE.exec(line);
  if (headingMatch) return { kind: "heading", indent: 0, content: headingMatch[2] };
  const ulMatch = UL_LINE.exec(line);
  if (ulMatch) return { kind: "ul", indent: indentDepth(ulMatch[1]), content: ulMatch[2] };
  const olMatch = OL_LINE.exec(line);
  if (olMatch) return { kind: "ol", indent: indentDepth(olMatch[1]), content: olMatch[2] };
  return { kind: "paragraph", indent: 0, content: line };
}

function indentDepth(indent: string): number {
  return Math.min(Math.floor(indent.length / 2), 1);
}

function renderList(kind: "ul" | "ol", lines: ParsedLine[], key: string): React.ReactNode {
  const Tag = kind === "ul" ? "ul" : "ol";
  const className = kind === "ul" ? "list-disc pl-4 space-y-0.5" : "list-decimal pl-4 space-y-0.5";
  const items: { line: ParsedLine; children: ParsedLine[] }[] = [];
  for (const line of lines) {
    if (line.indent === 0 || items.length === 0) items.push({ line, children: [] });
    else items[items.length - 1].children.push(line);
  }
  return (
    <Tag key={key} className={className}>
      {items.map((item, i) => (
        <li key={i}>
          {renderInline(item.line.content)}
          {item.children.length > 0 ? renderList(kind, item.children, `${key}-${i}`) : null}
        </li>
      ))}
    </Tag>
  );
}

function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let rest = text;
  let key = 0;

  while (rest.length > 0) {
    const codeMatch = /^`([^`]+)`/.exec(rest);
    if (codeMatch) {
      nodes.push(
        <code key={key++} className="break-all rounded bg-border/40 px-1 py-0.5 text-[0.8em]">
          {codeMatch[1]}
        </code>,
      );
      rest = rest.slice(codeMatch[0].length);
      continue;
    }
    const linkMatch = /^\[([^\]]*)\]\(([^)]+)\)/.exec(rest);
    if (linkMatch) {
      const [, label, rawUrl] = linkMatch;
      const href = safeHttpUrl(rawUrl);
      nodes.push(
        href ? (
          <a key={key++} href={href} target="_blank" rel="noopener noreferrer" className="underline">
            {label}
          </a>
        ) : (
          <span key={key++}>{label}</span>
        ),
      );
      rest = rest.slice(linkMatch[0].length);
      continue;
    }
    const boldMatch = /^(\*\*|__)([^]*?)\1/.exec(rest);
    if (boldMatch) {
      nodes.push(
        <strong key={key++} className="font-semibold">
          {renderInline(boldMatch[2])}
        </strong>,
      );
      rest = rest.slice(boldMatch[0].length);
      continue;
    }
    const italicMatch = /^([*_])(\S(?:[^]*?\S)?)\1/.exec(rest);
    if (italicMatch) {
      nodes.push(<em key={key++}>{renderInline(italicMatch[2])}</em>);
      rest = rest.slice(italicMatch[0].length);
      continue;
    }
    const urlMatch = /^(https?:\/\/[^\s]+)/.exec(rest);
    if (urlMatch) {
      const raw = urlMatch[1];
      const href = safeHttpUrl(raw);
      if (href) {
        nodes.push(
          <a key={key++} href={href} target="_blank" rel="noopener noreferrer" className="underline break-all">
            {raw}
          </a>,
        );
      } else {
        nodes.push(<span key={key++}>{raw}</span>);
      }
      rest = rest.slice(raw.length);
      continue;
    }
    const nextTokenStart = rest.slice(1).search(/[`[*_]|https?:\/\//);
    const chunkEnd = nextTokenStart === -1 ? rest.length : nextTokenStart + 1;
    nodes.push(<span key={key++}>{rest.slice(0, chunkEnd)}</span>);
    rest = rest.slice(chunkEnd);
  }

  return nodes;
}

function MessageContent({ text }: { text: string }) {
  const lines = text.split("\n").map(parseLine);
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let blockKey = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.kind === "ul" || line.kind === "ol") {
      const group: ParsedLine[] = [];
      while (i < lines.length && lines[i].kind === line.kind) {
        group.push(lines[i]);
        i++;
      }
      blocks.push(renderList(line.kind, group, `block-${blockKey++}`));
      continue;
    }
    if (line.kind === "heading") {
      blocks.push(
        <div key={`block-${blockKey++}`} className="font-semibold">
          {renderInline(line.content)}
        </div>,
      );
      i++;
      continue;
    }
    blocks.push(
      <span key={`block-${blockKey++}`} className="whitespace-pre-line">
        {renderInline(line.content)}
        {i < lines.length - 1 ? "\n" : null}
      </span>,
    );
    i++;
  }

  return <span>{blocks}</span>;
}

// --- Listing cards (read-only port of ChatScreen's ListingCard/ListingCards — no onOpen overlay
// since this is a historical transcript view, not an interactive chat; "Ver anúncio" is a real
// link here instead of an inert tappable pill) ---

interface MirrorListing {
  id?: string;
  title: string;
  price?: string;
  description?: string;
  url?: string;
  imageUrl?: string;
  images?: string[];
}

function ListingCard({ listing }: { listing: MirrorListing }) {
  const imageUrl = safeHttpUrl(listing.imageUrl);
  const url = safeHttpUrl(listing.url);
  const [imageFailed, setImageFailed] = useState(false);
  return (
    <div className="flex h-[23rem] w-56 shrink-0 flex-col overflow-hidden rounded-card border border-border bg-surface">
      {/* flex-col h-full + mt-auto on the footer below, mirroring ChatScreen.tsx's ListingCard,
          so the "Ver anúncio" row always lines up at the same height regardless of content
          length. */}
      <div className="flex h-full flex-col">
        <div className="flex w-full flex-col overflow-hidden text-left">
          <div className="flex h-32 w-full shrink-0 items-center justify-center bg-border/40">
            {imageUrl && !imageFailed ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageUrl}
                alt={listing.title}
                className="h-32 w-full object-cover"
                onError={() => setImageFailed(true)}
              />
            ) : (
              <span className="text-3xl" aria-hidden>
                🏠
              </span>
            )}
          </div>
          <div className="flex flex-col p-3">
            <div className="line-clamp-2 text-sm font-semibold text-ink">{listing.title}</div>
            {listing.price && <div className="mt-1 text-sm font-semibold text-accent">{listing.price}</div>}
            {listing.description && <p className="mt-1 line-clamp-3 text-xs text-ink-soft">{listing.description}</p>}
          </div>
        </div>
        <div className="mt-auto flex items-center gap-2 px-3 pb-3 pt-1">
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 rounded-full bg-accent px-3 py-1.5 text-center text-xs font-medium text-white"
            >
              Ver anúncio
            </a>
          ) : (
            <span className="invisible flex-1 rounded-full px-3 py-1.5 text-center text-xs font-medium">
              Ver anúncio
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ListingCards({ listings }: { listings: MirrorListing[] }) {
  return (
    <div className="flex w-full gap-2 overflow-x-auto overscroll-x-contain px-1 pb-1">
      {listings.map((listing, i) => (
        <ListingCard key={`${listing.title}-${i}`} listing={listing} />
      ))}
    </div>
  );
}

// --- Simulation card (read-only port of SimulationCard.tsx) ---

interface SimulationBreakdown {
  principalCents: number;
  downPaymentCents: number;
  downPaymentPercent: number;
  months: number;
  monthlyRatePercent: number;
  system: "sac" | "price";
  firstInstallmentCents: number;
  lastInstallmentCents: number;
  averageInstallmentCents: number;
  totalPaidCents: number;
  totalInterestCents: number;
}

interface SimulationData {
  breakdown: SimulationBreakdown;
  rateSource: string;
  rateSourceLabel: string;
  matchedListingIds: string[];
}

function SimRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-xs text-ink-soft">{label}</span>
      <span className="text-sm font-medium text-ink">{value}</span>
    </div>
  );
}

function SimulationCard({ data, listings, niche }: { data: SimulationData; listings?: MirrorListing[]; niche?: string | null }) {
  const { breakdown } = data;
  const isSac = breakdown.system === "sac";

  return (
    <div className="mt-2 rounded-2xl border border-border bg-surface p-4">
      <div className="mb-2 text-sm font-semibold text-ink">Simulação de financiamento</div>
      <SimRow label="Valor" value={formatBRL(breakdown.principalCents + breakdown.downPaymentCents)} />
      <SimRow
        label="Entrada"
        value={`${formatBRL(breakdown.downPaymentCents)} (${breakdown.downPaymentPercent.toFixed(0)}%)`}
      />
      <SimRow label="Prazo" value={`${breakdown.months}x`} />
      <SimRow label="Sistema" value={breakdown.system.toUpperCase()} />
      {isSac ? (
        <>
          <SimRow label="1ª parcela" value={`~${formatBRL(breakdown.firstInstallmentCents)}`} />
          <SimRow label="Última parcela" value={`~${formatBRL(breakdown.lastInstallmentCents)}`} />
        </>
      ) : (
        <SimRow label="Parcela fixa" value={`~${formatBRL(breakdown.firstInstallmentCents)}`} />
      )}
      <SimRow label="Total de juros" value={`~${formatBRL(breakdown.totalInterestCents)}`} />
      <SimRow label="Total pago" value={`~${formatBRL(breakdown.totalPaidCents)}`} />
      <div className="mt-2 border-t border-border pt-2 text-xs text-ink-soft">
        {data.rateSourceLabel}
        <br />
        Taxa estimada, sujeito à aprovação.
      </div>
      {listings && listings.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-xs font-semibold text-ink">
            {niche === "concessionaria" ? "Veículos que cabem no seu orçamento" : "Imóveis que cabem no seu orçamento"}
          </div>
          <ListingCards listings={listings} />
        </div>
      )}
    </div>
  );
}

// --- Public component: one assistant message, rendered exactly as the visitor saw it ---

export function MessageMirror({
  message,
  personaName,
  niche,
}: {
  message: {
    id: string;
    content: string;
    listings?: MirrorListing[];
    simulationData?: SimulationData | null;
  };
  personaName: string;
  niche?: string | null;
}) {
  return (
    <div className="max-w-full">
      <div className="mb-1 text-xs font-semibold text-accent">{personaName}</div>
      <div className="rounded-2xl rounded-bl-sm bg-surface px-4 py-3 text-sm text-ink break-words">
        <MessageContent text={message.content} />
      </div>
      {message.simulationData ? (
        <SimulationCard data={message.simulationData} listings={message.listings} niche={niche} />
      ) : (
        message.listings &&
        message.listings.length > 0 && (
          <div className="mt-2">
            <ListingCards listings={message.listings} />
          </div>
        )
      )}
    </div>
  );
}
