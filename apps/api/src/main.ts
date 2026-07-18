import "reflect-metadata";
import type { NextFunction, Request, Response } from "express";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./modules/app.module";
import { ApiExceptionFilter } from "./modules/api-exception.filter";

const port = Number(process.env.PORT ?? 3001);

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.enableCors({ origin: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000", credentials: true });
  app.use((request: Request, response: Response, next: NextFunction) => {
    const requestId = String(request.headers["x-request-id"] ?? `rw-${Date.now().toString(36)}`);
    request.headers["x-request-id"] = requestId;
    response.setHeader("x-request-id", requestId);
    next();
  });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.setGlobalPrefix("api");
  await app.listen(port);
}

bootstrap().catch((error) => {
  console.error("Failed to start API", error);
  process.exit(1);
});
