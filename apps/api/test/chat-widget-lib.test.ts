// Widget helper regressions (apps/chat/src/lib/api.ts is pure at import time).
import { test } from "node:test";
import assert from "node:assert/strict";
import { apiErrorMessage } from "../../chat/src/lib/api";

test("apiErrorMessage: a 5xx or a dead connection never shows the raw framework text, the friendly fallback instead", () => {
  const fallback = "Não consegui concluir agora. Tente de novo em instantes.";
  assert.equal(apiErrorMessage({ status: 500, data: { message: "Internal server error" } }, fallback), fallback);
  assert.equal(apiErrorMessage({ status: 503, data: { message: "Service Unavailable" } }, fallback), fallback);
  assert.equal(apiErrorMessage(new Error("Failed to fetch"), fallback), fallback);
});

test("apiErrorMessage: a 4xx domain error keeps its own pt-BR message", () => {
  assert.equal(apiErrorMessage({ status: 400, data: { message: "Informe o número da casa." } }, "x"), "Informe o número da casa.");
  assert.equal(apiErrorMessage({ status: 422, data: { message: ["CEP inválido", "outro"] } }, "x"), "CEP inválido");
  assert.equal(apiErrorMessage({ status: 400, data: {} }, "fallback"), "fallback");
});
