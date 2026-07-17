import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./modules/app.module";

const port = Number(process.env.PORT ?? 3001);

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.enableCors({ origin: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000", credentials: true });
  app.setGlobalPrefix("api");
  await app.listen(port);
}

bootstrap().catch((error) => {
  console.error("Failed to start API", error);
  process.exit(1);
});
