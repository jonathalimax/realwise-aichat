import { buildOwnerOutreachMessage } from "@realwise/shared";
import { escapeHtml } from "../../common/email";
import { safeHttpUrl } from "../../common/safe-http-url";
import { dashboardLink, renderEmailButton, renderWaButton } from "../../common/email-links";

// Pure rendering helpers for booking confirmation emails — no DI, no Prisma, so the shapes below
// are intentionally loose structural types rather than importing the full Prisma model types.

interface ListingLike {
  title: string;
  referenceCode?: string | null;
  priceText?: string | null;
  addressLine?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  url?: string | null;
}

interface BusinessLike {
  name: string;
  address?: string | null;
  timezone?: string | null;
}

interface LeadLike {
  name?: string | null;
  phone: string;
}

// Joins whatever address fragments a listing actually has, skipping nulls — used both for the
// email body and as the fallback for Appointment.locationAddress when no business address exists.
export function formatListingAddress(listing: ListingLike | null | undefined): string | undefined {
  if (!listing) return undefined;
  const parts = [listing.addressLine, listing.neighborhood, [listing.city, listing.state].filter(Boolean).join(" - ")].filter(
    (part): part is string => Boolean(part && part.trim()),
  );
  return parts.length > 0 ? parts.join(", ") : undefined;
}

function formatDateTime(date: Date, timezone?: string | null): string {
  return date.toLocaleString("pt-BR", { timeZone: timezone ?? "America/Sao_Paulo", dateStyle: "long", timeStyle: "short" });
}

export interface OwnerEmailContext {
  business: BusinessLike;
  lead?: LeadLike | null;
  serviceName: string;
  startsAt: Date;
  listing?: ListingLike | null;
  address?: string | null;
  topic?: string | null;
}

export interface VisitorEmailContext {
  business: BusinessLike;
  serviceName: string;
  startsAt: Date;
  listing?: ListingLike | null;
  address?: string | null;
  businessWhatsappPhone?: string | null;
}

function renderListingBlock(listing: ListingLike | null | undefined): string {
  if (!listing) return "";
  const url = safeHttpUrl(listing.url ?? undefined);
  const linkHtml = url ? ` — <a href="${escapeHtml(url)}">Ver anúncio</a>` : "";
  const priceHtml = listing.priceText ? ` — ${escapeHtml(listing.priceText)}` : "";
  const referenceHtml = listing.referenceCode ? ` (ref. ${escapeHtml(listing.referenceCode)})` : "";
  return `<p><strong>${escapeHtml(listing.title)}</strong>${referenceHtml}${priceHtml}${linkHtml}</p>`;
}

export function renderOwnerEmail(ctx: OwnerEmailContext): { subject: string; html: string } {
  const dateTimeLabel = formatDateTime(ctx.startsAt, ctx.business.timezone);
  const leadName = ctx.lead?.name ?? "Visitante";
  const address = ctx.address ?? ctx.business.address ?? undefined;

  const html = `
    <p>Novo agendamento confirmado.</p>
    <p><strong>Cliente:</strong> ${escapeHtml(leadName)} (${escapeHtml(ctx.lead?.phone ?? "sem telefone")})</p>
    <p><strong>Serviço:</strong> ${escapeHtml(ctx.serviceName)}</p>
    <p><strong>Data e hora:</strong> ${escapeHtml(dateTimeLabel)}</p>
    ${renderListingBlock(ctx.listing)}
    ${address ? `<p><strong>Endereço:</strong> ${escapeHtml(address)}</p>` : ""}
    <p>O convite de calendário (.ics) está anexado a este e-mail.</p>
    ${
      ctx.lead?.phone
        ? renderWaButton(
            ctx.lead.phone,
            buildOwnerOutreachMessage(leadName, ctx.business.name, ctx.topic ?? ctx.serviceName),
            "Falar com o cliente no WhatsApp",
          )
        : ""
    }
    ${renderEmailButton("Ver no painel", dashboardLink("/agenda"))}
  `.trim();

  return { subject: `Novo agendamento: ${ctx.serviceName}`, html };
}

export function renderVisitorEmail(ctx: VisitorEmailContext): { subject: string; html: string } {
  const dateTimeLabel = formatDateTime(ctx.startsAt, ctx.business.timezone);
  const address = ctx.address ?? ctx.business.address ?? undefined;

  const html = `
    <p>Seu agendamento com <strong>${escapeHtml(ctx.business.name)}</strong> está confirmado! 🎉</p>
    <p><strong>Serviço:</strong> ${escapeHtml(ctx.serviceName)}</p>
    <p><strong>Data e hora:</strong> ${escapeHtml(dateTimeLabel)}</p>
    ${renderListingBlock(ctx.listing)}
    ${address ? `<p><strong>Endereço:</strong> ${escapeHtml(address)}</p>` : ""}
    <p>O convite de calendário (.ics) está anexado a este e-mail — basta abrir o anexo para adicionar ao seu calendário.</p>
    ${renderWaButton(
      ctx.businessWhatsappPhone,
      `Oi! Confirmando meu agendamento de ${ctx.serviceName} com a ${ctx.business.name}.`,
      "Falar no WhatsApp",
    )}
  `.trim();

  return { subject: `Agendamento confirmado — ${ctx.business.name}`, html };
}
