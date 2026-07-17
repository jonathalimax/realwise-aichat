import { z } from "zod";

const optionalUrl = z.string().url().optional().or(z.literal(""));

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  API_URL: z.string().url().default("http://localhost:3001"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  SESSION_SECRET: z.string().min(32),
  ENCRYPTION_MASTER_KEYS: z.string().min(1),
  CHATWOOT_BASE_URL: optionalUrl.default(""),
  CHATWOOT_PLATFORM_TOKEN: z.string().optional().default(""),
  STRIPE_SECRET_KEY: z.string().optional().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(""),
  META_APP_ID: z.string().optional().default(""),
  META_APP_SECRET: z.string().optional().default(""),
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional().default(""),
  AI_PROVIDER: z.enum(["fake", "openai"]).default("fake"),
  OPENAI_API_KEY: z.string().optional().default(""),
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  return envSchema.parse(source);
}

export function externalActivationStatus(env: Pick<AppEnv, "CHATWOOT_PLATFORM_TOKEN" | "STRIPE_SECRET_KEY" | "META_APP_ID" | "META_APP_SECRET">) {
  return {
    chatwoot: env.CHATWOOT_PLATFORM_TOKEN ? "READY_FOR_EXTERNAL_ACTIVATION" : "IMPLEMENTED_NOT_VERIFIED",
    stripe: env.STRIPE_SECRET_KEY ? "READY_FOR_EXTERNAL_ACTIVATION" : "IMPLEMENTED_NOT_VERIFIED",
    meta: env.META_APP_ID && env.META_APP_SECRET ? "READY_FOR_EXTERNAL_ACTIVATION" : "MOCK_VERIFIED",
  } as const;
}
