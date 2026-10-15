# Chat widget and public pages (wave 2d): report

Scope: `apps/chat/**` and `apps/marketing/**` only. Contract: `API.md` sections 8, 8.4, 8.5, 9. Real-estate and vehicle chat paths are unchanged (every pharmacy branch is gated by `business.niche === "farmacia"`).

## Done

- **Theme**: `lib/pharmacy-theme.ts` turns `business.branding` (primary / secondary / tertiary, strict `#RRGGBB` validation, default teal `#0F766E / #0B4F4A / #F59E0B`) into `--ph-*` CSS variables (+ readable foreground colours, soft tint, `--tenant-accent`). Classes `.ph-*` live in `globals.css`.
- **Header / footer (S1)**: Alex avatar (or logo), the name "Alex (IA)" (round 2: no separate badge; footer is now "Não indico remédios nem dou orientação médica."; see CHAT_ENGINE_REPORT.md section 5), business name, CRF and "Farm. resp." line; footer with "Você conversa com uma IA. Ela não indica remédios nem dá orientação médica." plus legal name and CNPJ.
- **Welcome chips**: scripted flow start is used when present; if empty/unavailable, a fixed Alex welcome (says he is an AI) and `business.pharmacy.quickChips` as suggestion chips.
- **Renderers** (`components/pharmacy/PharmacyUi.tsx`, keyed by `message.ui.type`): see list below. Unknown kind, malformed payload or a renderer error renders nothing and the message text stays (error boundary). Cards are live only on the newest known card; older checkout forms go read-only (product card, Rx upload and the red-flag button stay live).
- **Cart bar** (`CartBar.tsx`): "Carrinho: N itens · R$ X", expandable list with steppers/remove (`cart.set_qty`, `cart.remove`), "Finalizar" (`checkout.start`) until checkout begins. Cart comes from `pharmacy.cart` (history response, action responses, `done` event).
- **Contact capture**: phone first, `POST /customers/:businessId/lookup`; returning customer gets "Oi, João!" and the masked saved address; new customer gets name/e-mail; LGPD consent checkbox required; then `checkout.contact`.
- **Address**: saved-address confirm ("Está certo" / "Atualizar endereço" = `replaceDefault: true` / "Entregar em outro endereço"), CEP mask + lookup, manual street/district/city/UF when the CEP is unavailable/generic, number with "sem número" (sends `S/N`), complemento, referência; server error messages (for example "Número inválido") shown inline.
- **Fulfillment**, **order review** (stale-stock notice, "Pagamento na entrega"), **order confirmation** (stepper badges + "Acompanhar pedido" link).
- **Rx upload**: consent checkbox, "Tirar foto" (camera capture) / "Escolher arquivo", client-side type and size check, multipart `POST .../prescriptions` (consent `"true"`, optional patient name), confirmation with RX code, local assistant note.
- **Human join**: `role: system` + `kind: human_joined` renders the centred "Nome · Função entrou na conversa" banner; `owner` messages with `author` show avatar initials + "Nome · Função" on a soft bubble. The generic "<business> entrou na conversa" line is suppressed for pharmacy. Polling (8 s, 15 min cap, existing mechanism) now also runs for pharmacy once a handoff was requested, the lane is `symptom`, or a human has joined.
- **Order status page** `apps/chat` route `/pedido/[token]` (full URL `<chat origin>/client/conversation/pedido/<token>`): themed by `pharmacy.branding`; received / confirmed / out for delivery / ready for pickup / delivered / canceled / rejected with the step timeline, cancel reason, items and totals, address (as returned, masked), WhatsApp/phone buttons, polls every 20 s until terminal; `noindex` and `no-referrer`; 404 and error states.
- **Marketing**: `/farmacia` (and `/farmacias` redirect) landing polish: "IA" badge in the hero mock, pharmacy-specific problem stats (no invented numbers), new "Segurança que não depende de promessa" section (`NicheConfig.safety`, optional, other niches unchanged). Niche picker card and footer link were already consistent; the page stays "lista de espera" like the other early-access niches.
- Accessibility: real buttons, labelled inputs, `aria-live` regions, `role="alert"` errors, 40 px touch targets, 16 px inputs (no iOS zoom).

## uiData kinds supported

`product_card`, `cart`, `symptom_question`, `red_flag`, `controlled_info`, `contact_capture`, `address_capture`, `fulfillment_choice`, `order_review`, `order_confirmation`, `rx_upload`, `human_joined` (the last one through the banner). Everything else degrades to plain text.

## Visitor actions sent (`POST .../pharmacy/actions`)

`cart.add`, `cart.set_qty`, `cart.remove`, `checkout.start`, `checkout.contact`, `checkout.fulfillment`, `checkout.use_saved_address`, `checkout.address`, `checkout.confirm`, `symptom.answer`, `handoff.request` (`reason: "symptom"` from the red-flag card, `"other"` from the controlled card). The widget echoes the tap as a visitor bubble and drops any `visitor` message in the response to avoid duplicates.

## Deviations / things 2a and 2b must know

1. `symptom.answer` carries an extra `consent: true` when the question card included a `consent` object (API.md has no field for it; the first answer is blocked until the checkbox is ticked).
2. `GET .../messages` is expected to return top-level `pharmacy` (as in 8.1); `done` SSE `message` may carry `id`, `kind`, `author`, `ui`; `done.pharmacy` is used if present. If `done.message.ui` is absent the card simply is not shown until history reloads.
3. `statusUrl` is rendered as given (http(s) or same-site relative only). It should point at `<chat origin>/client/conversation/pedido/<statusToken>`.
4. The widget needs `business.pharmacy.cnpj/legalName/pharmacistName/pharmacistCrf/quickChips` and `business.branding` from `GET /businesses/public/:slug`, and `logoUrl`. Product images: API-relative `/api/public/products/...` URLs are resolved against the API origin.
5. `api.ts` `request()` now also attaches the parsed error body as `error.data` (additive).

## Partial / not done

- No browser screenshot review (the Browser pane was not compositing); verified through DOM assertions against a mock API on a throwaway port (all renderers, contact/lookup flow, CEP form, action calls, status page), plus `tsc --noEmit` on both apps. Not verified against the real 2a/2b endpoints (they were not running).
- No Playwright/unit tests added for the widget.
- Camera capture relies on the browser's `capture` attribute (desktop browsers open a file picker).
- Staff web-push for visitors is the existing escalated-conversation prompt only; it is not triggered for pharmacy handoffs.
- `apps/chat/tsconfig.tsbuildinfo` and `apps/marketing/tsconfig.tsbuildinfo` are tracked and were rewritten by `tsc`; restore them before committing if unwanted.
