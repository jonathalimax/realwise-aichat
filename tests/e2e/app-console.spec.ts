import { expect, test } from "@playwright/test";

test("operator can log in and use core console tabs", async ({ page }) => {
  await page.goto("/app");
  await page.getByRole("button", { name: "Entrar e carregar painel" }).click();
  await expect(page.getByRole("heading", { name: "Academia Realwise Demo" })).toBeVisible();
  await expect(page.getByText(/Tenant:/)).toBeVisible();

  await page.getByRole("button", { name: "Canais" }).click();
  await expect(page.getByRole("heading", { name: "WHATSAPP" })).toBeVisible();
  await page.getByRole("button", { name: "Conectar mock" }).first().click();
  await expect(page.getByText("mock-whatsapp-web")).toBeVisible();

  await page.getByRole("button", { name: "Conhecimento" }).click();
  await expect(page.getByRole("heading", { name: "Nova fonte" })).toBeVisible();
  await page.getByRole("button", { name: "Salvar conhecimento" }).click();
  await expect(page.getByText("Perguntas frequentes").first()).toBeVisible();

  await page.getByRole("button", { name: "Leads" }).click();
  await expect(page.getByText("Smoke Test").first()).toBeVisible();

  await page.getByRole("button", { name: "Cobrança" }).click();
  await expect(page.getByText(/Plano Pilot/)).toBeVisible();
});
