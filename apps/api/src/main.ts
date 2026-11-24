import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { resolve } from "node:path";
import { AppModule } from "./app.module.ts";
import { HttpExceptionFilter } from "./common/http-exception.filter.ts";
import { jsonOnlyMiddleware } from "./common/json-only.middleware.ts";
import { securityHeadersMiddleware } from "./common/security-headers.middleware.ts";
import { createValidationPipe } from "./common/validation.ts";
import { loadConfig } from "./config/app-config.ts";
import { describeTrustProxy } from "./config/trust-proxy.ts";
import { configureSpa } from "./spa.ts";

async function bootstrap(): Promise<void> {
  const logger = new Logger("Bootstrap");
  // dist/main.js -> ../../web/dist (same layout locally and in the container)
  const config = loadConfig(process.env, { webDistDir: resolve(__dirname, "../../web/dist") });

  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config));
  app.disable("x-powered-by");
  // Which proxies may set X-Forwarded-For (req.ip, the per-IP rate-limit key). Off unless TRUST_PROXY is set.
  if (config.trustProxy !== false) {
    app.set("trust proxy", config.trustProxy);
  }
  // First middleware, so the headers are also on SPA files, index.html and every error response.
  app.use(securityHeadersMiddleware);
  app.setGlobalPrefix("api");
  app.enableShutdownHooks();
  // CSRF hardening: state-changing API calls must be JSON (415 otherwise). Registered before routing.
  app.use("/api", jsonOnlyMiddleware);
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new HttpExceptionFilter());
  configureSpa(app, config.webDistDir, logger);

  await app.listen(config.port, "0.0.0.0");
  logger.log(`Listening on port ${config.port} (${config.nodeEnv}); trust proxy: ${describeTrustProxy(config.trustProxy)}`);
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
