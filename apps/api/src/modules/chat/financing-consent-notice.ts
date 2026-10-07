// LGPD disclosure for the financing simulator (Stage 3). Shown once, the first time a simulation
// is about to run in a given conversation, so budget/income-adjacent inputs are flagged to the
// Visitante as conversational data covered by the standard retention/consent policy rather than
// a credit decision input.
//
// NOT YET WIRED: this constant is deliberately not imported/used anywhere yet. Stage 3 owns
// simulator.service.ts and chat.service.ts (edited in parallel), so wiring this into the
// simulator's first-use path is left as a small follow-up to avoid a merge conflict.
export const FINANCING_SIMULATION_CONSENT_NOTICE =
  "Uso essas informações só para estimar valores — não é uma proposta de crédito, e seus dados seguem nossa política de privacidade.";
