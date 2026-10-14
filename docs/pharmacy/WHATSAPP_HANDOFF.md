# WhatsApp hand-over of a pharmacist handoff

Owner request: when the attendant starts the attendance it happens on WhatsApp Web, with a welcome message that uses the attendant's name and summarizes what the customer told Alex.

## Flow

1. **Chat (symptom lane).** After the last questionnaire answer, before the handoff exists, Alex asks "Qual seu WhatsApp (com DDD) para o farmacêutico te chamar?" (ui `contact_capture`, `purpose: "pharmacy_triage"`, `fields: ["phone","name"]`, consent card `pharmacy_contact`). Typing a number, or sending the contact card, is the agreement (the text and the card say so; the card needs the checkbox).
   - Returning customer (same normalized phone on a `Lead`): recognized, name is not asked, no duplicate lead.
   - New customer: optional name ("Pular" skips), a `Lead` is created with the normalized phone, the conversation is linked to it.
   - Consent record `purposes: ["pharmacy_triage","contact"]` (version `CONSENT_VERSION`).
   - "Prefiro continuar só pelo chat" (or "cancelar" at this step) keeps the old web-chat-only path: handoff without a lead. Red-flag handoffs are urgent and are never delayed by this question.
   - The handoff references the lead (`leadId`); `brief.contact = { firstName, phoneMasked }` is display data only. The full number lives only on the `Lead`.
2. **Dashboard.** Atendimento > open handoff. **Iniciar atendimento** (needs `atendimento:edit` + CRF, like replying) calls `POST /handoffs/:id/whatsapp/draft`, shows an editable preview, and **Abrir no WhatsApp Web** opens `https://web.whatsapp.com/send?phone=<digits>&text=<encoded>` in a new tab (window opened synchronously from the click so blockers allow it), then `POST /handoffs/:id/start`. "Abrir no app" uses `https://wa.me/<digits>?text=`. The list row shows "Em atendimento · <nome>".
3. **Responder aqui no chat** stays available (the old composer; it also marks the handoff in progress with `channel: "chat"`). A handoff without a phone shows only the chat composer.
4. **Marcar como respondido** (`POST /handoffs/:id/mark-answered`): status `answered`, `answerText = "Atendimento continuado pelo WhatsApp."`, and one system message in the web chat "<Nome> · <Função> continuou o atendimento pelo WhatsApp" (`ChatHumanService.recordSystemNote`; role `system`, no health data). If the customer writes again in the web chat the existing lazy rule re-opens it.

## Message (`apps/api/src/modules/handoffs/whatsapp-message.ts`, pure, unit-tested)

```
Olá, Maria! Aqui é Paulo Nunes, Farmacêutico RT da Farmácia Exemplo. Recebi seu atendimento pelo chat e já li o que você me contou:

- O que você sente: Dor de cabeça (forte)
- Há quanto tempo: 1–3 dias
- Para quem: Para mim, 34 anos
- Alergias: dipirona
- Outros remédios em uso: losartana
- O que você já tentou: ibuprofeno sem melhora

Posso te ajudar com isso?
```

- Only what the customer answered: symptom (+ intensity), duration, for whom/age, allergies, other medicines, what they tried; for product requests only `requestedProduct`/`medication` ("Produto que você pediu"); red-flag handoffs repeat the customer's own words.
- Never: suggested products, red-flag labels, `suggestionNote`, stock, prices, equivalents, pregnancy answer, order data, links, `inProgress`, phone, surname.
- Max 900 characters; whole trailing lines are dropped first, then the last line is cut on a word boundary with "…"; greeting and closing question are always kept. Control and zero-width characters are stripped. The attendant can still edit the text in the dialog (limit enforced by `maxlength`).
- Differences from the request: the summary uses short labelled lines instead of running sentences (clearer on WhatsApp).

## Privacy and audit

- The full phone is returned only by `POST /handoffs/:id/whatsapp/draft` (`atendimento:edit` + CRF). `GET /handoffs` and `GET /handoffs/:id` return `contact { firstName, phoneMasked, hasPhone }` (deviation from "returned by the GET": stricter on purpose).
- Access log: `handoff.whatsapp_link` (number revealed), `handoff.start`, `handoff.whatsapp_answer`. Summaries and `detail` carry only the handoff id and channel; no phone, no health text.
- No schema change: the in-progress marker is `PharmacistHandoff.brief.inProgress`; the status machine (`open|answered|closed`) is untouched. The handoff dedupe merge (`PrismaPharmacyHandoffs.create`) keeps `inProgress` and `contact`.
- The message text is built server-side in the draft call and rebuilt client-side only as the URL-encoded edited text; nothing is sent to WhatsApp by the system (the attendant presses send).

## Tests

`apps/api/test/whatsapp-message.test.ts` (builder, links, masking), `pharmacy-handoffs.test.ts` (draft, start, mark answered, access log, no phone in GET), `pharmacy-access.test.ts` (guard matrix covers the three routes: attendant/courier get 403, owner/manager without CRF denied), `pharmacy-scenarios.test.ts` (contact step: new customer, returning customer, invalid number, decline, contact-card action, cancel).

## Who can handle which handoff (updated 2026-10-14)

- **Clinical handoffs** (reasons `symptom`, `rx`, `controlled`, `other`, or any urgent one) need a member whose role requires a CRF and who has a CRF on file. Others get 403 `CRF_REQUIRED`.
- **Plain availability checks** (`out_of_stock`, `product_request`) can be handled by anyone with Atendimento edit: Owner, Manager and Attendant now have it by default. Pharmacist keeps it too.
- The API sets `canHandle` (per member) and `requiresPharmacist` on every handoff; the dashboard enables or disables the actions from them. The check lives in `HandoffsService.assertCanHandle`.
- Staff with Atendimento access now see the customer's phone **unmasked** in the handoff detail (the list still hides it). Generating the WhatsApp link is still written to the access log.
