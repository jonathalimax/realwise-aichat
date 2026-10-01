import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { json, raw } from "express";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use("/billing/webhook", raw({ type: "application/json" }));
  app.use(json());
  app.use(cookieParser());
  app.enableCors({ origin: true, credentials: true });
  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`RealWise API listening on :${port}`);
}

bootstrap();
