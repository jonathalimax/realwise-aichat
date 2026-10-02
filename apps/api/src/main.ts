import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { json, raw } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { AppModule } from "./app.module";

// Dev-only fallbacks so local work across the 4 frontend apps isn't broken when
// CORS_ALLOWED_ORIGINS/NEXT_PUBLIC_* aren't set — never relied on in production.
const DEV_DEFAULT_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3003",
  "http://localhost:3004",
  "http://localhost:3005",
  "http://localhost:3007",
];

function buildAllowedOrigins(): string[] {
  const fromEnvList = (process.env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  const fromAppEnvVars = [
    process.env.NEXT_PUBLIC_DASHBOARD_URL,
    process.env.NEXT_PUBLIC_CHAT_URL,
    process.env.NEXT_PUBLIC_ADMIN_URL,
    process.env.NEXT_PUBLIC_MARKETING_URL,
    process.env.DASHBOARD_URL,
  ].filter((v): v is string => Boolean(v));

  const devDefaults = process.env.NODE_ENV === "production" ? [] : DEV_DEFAULT_ORIGINS;

  return Array.from(new Set([...fromEnvList, ...fromAppEnvVars, ...devDefaults]));
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  // Default img-src ('self' + data:) would silently block any off-origin business logo
  // (e.g. a logoUrl pointing at S3/Cloudinary) — this API never serves/renders images itself,
  // so widening img-src here is safe and only matters if this CSP header is ever inherited
  // by a page that embeds the API's own responses directly (it isn't, today).
  app.use(helmet({ contentSecurityPolicy: { directives: { imgSrc: ["'self'", "data:", "https:"] } } }));
  app.use("/billing/webhook", raw({ type: "application/json" }));
  app.use(json());
  app.use(cookieParser());

  const allowedOrigins = buildAllowedOrigins();
  app.enableCors({
    origin(origin, callback) {
      // No Origin header (curl, server-to-server, same-origin) — allow through.
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  });

  const port = process.env.API_PORT ?? 3001;
  await app.listen(port);
  console.log(`Realwise API listening on :${port}`);
  console.log(`CORS allowed origins: ${allowedOrigins.join(", ")}`);
}

bootstrap();
