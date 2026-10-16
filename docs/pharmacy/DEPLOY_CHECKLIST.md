# Pharmacy: legal and compliance checklist before real customers

Engineering is not legal advice. Every item below needs an owner (the business, a lawyer or the Responsible Pharmacist) to confirm it; "Done" only after that confirmation. Technical steps are in `docs/DEPLOY.md`. Statuses reflect what the code does today; the legal basis and wording are open items.

## A. Before the first pharmacy goes live (blockers)

| # | Item | Why | Who | Status |
| --- | --- | --- | --- | --- |
| 1 | **Privacy policy and DPA reviewed by a Brazilian LGPD lawyer** (`docs/legal/politica-de-privacidade.md`, `dpa-operador-de-dados.md` are AI drafts with bracketed gaps). Add the pharmacy data: prescriptions (health data, LGPD art. 11, sensitive), symptom messages, delivery addresses, order history, access log | Health data is sensitive personal data; the drafts mention real estate documents only | Owner + lawyer | Open |
| 2 | **Legal basis and retention for prescription files**. Default today: file deleted `prescriptionRetentionDays` = 30 days after the order is closed (delivered/canceled), configurable per pharmacy; the daily job (03:30) deletes files and nulls expired handoff briefs. Confirm the period and basis (e.g. LGPD art. 11, II "a" / "f" health protection by a health professional, or explicit consent) with the lawyer and the pharmacist; some pharmacies are obliged by sanitary rules to keep a retained prescription (controlled drugs: retention by the pharmacy is the pharmacy's own regulated record, NOT the chat copy) | Retention is a regulated decision, not a product default | Owner + lawyer + RT | Open (HANDOFF open item 3) |
| 3 | **Controller / operator roles in the contract**: the pharmacy is controller, Realwise is operator; DPA signed by each pharmacy before onboarding; pharmacy indicates its own DPO/encarregado and the privacy-contact shown to customers | LGPD art. 5, 39, 41 | Lawyer | Open |
| 4 | **Consent texts reviewed**: chat shows consent cards for `pharmacy_triage` (symptoms), `prescription_upload`, `order_contact`, `pharmacy_contact` (`GET /api/chat/:businessId/consent-text?purpose=`). Have the lawyer approve the wording; consent records are kept as legal proof (never deleted, only marked revoked) | Valid, specific consent for sensitive data | Lawyer | Open |
| 5 | **Responsible Pharmacist (RT) registered per pharmacy**: name + CRF in Equipe e acessos. The product requires CRF on file before a member can validate prescriptions, confirm drug classes or answer handoffs. Check each CRF with the regional council (CRF-xx) before onboarding | Only a licensed pharmacist may validate prescriptions | Pharmacy + RT | Product enforces; verification is manual |
| 6 | **Pharmacy documents collected at onboarding** (not stored by the app, kept in your contract file): CNPJ, Autorização de Funcionamento (AFE/ANVISA) and alvara sanitario, Certidao de Regularidade Tecnica of the RT, and, if it sells controlled drugs, the AE (Autorizacao Especial) | Prove the customer is a licensed pharmacy | Owner | Open |
| 7 | **Backups encrypted and bounded**: prescription volume and Postgres backups encrypted at rest, access limited, retention not longer than the promised retention (a deleted file must not survive for months in an old backup); restore tested once | LGPD security (art. 46) and retention | Owner | Open (DEPLOY.md 3.4) |
| 8 | **Incident response plan**: who is contacted, the 72h notification path to ANPD and affected customers, contact e-mail published. Hosting, Resend, Stripe and the model provider listed as sub-processors in the DPA | LGPD art. 48 | Owner + lawyer | Open |
| 9 | **Model provider contract/DPA**: confirm which managed AI provider is used in production, that it does not train on the data, and where it processes it; international transfer clause (LGPD art. 33) if outside Brazil. Chat prompts carry only what the customer typed, never the pharmacist brief or the prescription image | Health data sent to a third party | Owner + lawyer | Open (also in `docs/legal/README.md` item 3) |

## B. Behaviour that must stay true (verify during acceptance, do not weaken)

These are implemented and covered by tests; the checklist exists so nobody removes them when tuning the product:

- The assistant (Alex) always identifies as an AI, never recommends or doses medicine, never states stock or price for prescription items, and hands symptoms and "which medicine" questions to the pharmacist (symptom questionnaire to handoff; red flags show the emergency card: SAMU 192 / call 192, and block buying for 30 minutes).
- Prescription-only and controlled products are never sold without a prescription validated by the RT (CRF); controlled-drug rules (retention of the physical prescription, notification where applicable) stay with the pharmacy's own process: the app only holds the photo for validation. Confirm with the RT that this matches their SNGPC/own-book routine; the app does NOT replace SNGPC reporting.
- Unclassified products (no drug class) are not sold until a pharmacist confirms the class.
- A pharmacist's brief (handoff) never appears in a chat message sent to the customer.
- Every access to a prescription file is logged (Equipe > access log), downloads are private (`Cache-Control: private, no-store`), a purged file answers 410.
- Customer-facing address is masked for returning customers.
- Marketing/advertising: no medicine promotion in the chat, banners or the landing page (sanitary rules restrict advertising of prescription medicines; confirm with the lawyer before adding any promotional messaging). Do not add discount campaigns for prescription items.

## C. Operations to agree with each pharmacy

| # | Item | Status |
| --- | --- | --- |
| 10 | Who monitors the handoff inbox and the "order waiting" alerts, in which hours; what the chat says outside hours (set in Farmacia > hours) | Per pharmacy |
| 11 | Delivery rules: area, fee, minimum, courier accounts with the `entregador` role (sees only their own deliveries) | Per pharmacy |
| 12 | Choose `commerce` vs `attendance` mode with the pharmacy (and the plan that allows it); explain attendance mode is "a WhatsApp with AI" with escalation, no orders | Per pharmacy |
| 13 | Customers' requests to access/delete data: process and e-mail channel; how the owner asks Realwise to erase a customer (admin tooling) | Open |
| 14 | Terms of Use for the pharmacy (not yet drafted, `docs/legal/README.md`) and an acceptable-use clause: no clinical advice by staff through the AI | Open |
| 15 | Pilot with one real pharmacy for 2 weeks with the RT reviewing every handoff before wider launch | Recommended |

## D. Technical confirmations after deploy (tick in the smoke test)

- Prescription volume is private: no URL under the domain serves `/data/realwise-storage` (DEPLOY.md 6.7).
- Retention job ran: `docker logs <worker> | grep retention-purge` shows the daily run and counts only.
- Only the three intended origins/prefixes exist; the `/admin` console is restricted to the platform owner.
- HTTPS everywhere (http redirects), security headers from the api (helmet) present.
- Logs contain no health data: the jobs log counts only; if you change logging, keep message and prescription text out.
