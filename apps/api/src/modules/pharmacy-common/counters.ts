type RawClient = {
  $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<any>;
  pharmacySettings: { upsert: (args: any) => Promise<any> };
};

/** Creates the settings row if missing (create-on-read defaults). */
export async function ensureSettingsRow(client: Pick<RawClient, "pharmacySettings">, businessId: string): Promise<void> {
  await client.pharmacySettings.upsert({ where: { businessId }, update: {}, create: { businessId } });
}

/**
 * Atomic per-business counters: a single UPDATE ... RETURNING, so concurrent orders never share a number.
 * Returns the number that was just reserved (PED-<n> / RX-<n>).
 */
export async function nextOrderNumber(client: RawClient, businessId: string): Promise<number> {
  await ensureSettingsRow(client, businessId);
  const rows = (await client.$queryRaw`UPDATE "PharmacySettings" SET "nextOrderNumber" = "nextOrderNumber" + 1 WHERE "businessId" = ${businessId} RETURNING "nextOrderNumber" - 1 AS n`) as Array<{ n: number }>;
  return Number(rows[0].n);
}

export async function nextRxNumber(client: RawClient, businessId: string): Promise<number> {
  await ensureSettingsRow(client, businessId);
  const rows = (await client.$queryRaw`UPDATE "PharmacySettings" SET "nextRxNumber" = "nextRxNumber" + 1 WHERE "businessId" = ${businessId} RETURNING "nextRxNumber" - 1 AS n`) as Array<{ n: number }>;
  return Number(rows[0].n);
}
