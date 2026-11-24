import { type DynamicModule, Module } from "@nestjs/common";
import { parseTrustProxy, type TrustProxySetting } from "./trust-proxy.ts";

export interface AppConfig {
  nodeEnv: string;
  /** Port the HTTP server listens on (API + compiled SPA). */
  port: number;
  databaseUrl: string;
  /** Public base URL of the app; used for links in verification emails. */
  appBaseUrl: string;
  /** Directory containing the compiled SPA (apps/web/dist). */
  webDistDir: string;
  /** Absolute session lifetime in days (D4). */
  sessionTtlDays: number;
  /** Whether the session cookie gets the Secure flag (D4). */
  cookieSecure: boolean;
  /** Express "trust proxy" setting from TRUST_PROXY (review M2); false = X-Forwarded-For is ignored (default). */
  trustProxy: TrustProxySetting;
  smtp: SmtpConfig;
}

export interface SmtpConfig {
  host: string;
  port: number;
  /** true = implicit TLS (usually port 465); false = plain or STARTTLS. */
  secure: boolean;
  /** SMTP auth is used only when a user is configured. */
  user: string | undefined;
  pass: string | undefined;
  from: string;
}

export const APP_CONFIG = Symbol("APP_CONFIG");

/**
 * Reads and validates configuration from environment variables.
 * Throws one error listing every problem so misconfiguration fails fast at startup.
 */
export function loadConfig(env: NodeJS.ProcessEnv, defaults: { webDistDir: string }): AppConfig {
  const errors: string[] = [];

  const port = Number(env.PORT ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push(`PORT must be an integer between 1 and 65535 (got "${env.PORT}")`);
  }

  const databaseUrl = env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl) {
    errors.push("DATABASE_URL is required");
  }

  const appBaseUrl = (env.APP_BASE_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
  if (!URL.canParse(appBaseUrl)) {
    errors.push(`APP_BASE_URL must be an absolute URL (got "${env.APP_BASE_URL}")`);
  }

  const sessionTtlDays = Number(env.SESSION_TTL_DAYS?.trim() || "7");
  if (!Number.isInteger(sessionTtlDays) || sessionTtlDays < 1) {
    errors.push(`SESSION_TTL_DAYS must be a positive integer (got "${env.SESSION_TTL_DAYS}")`);
  }

  const cookieSecure = parseBoolean(env.COOKIE_SECURE, true, "COOKIE_SECURE", errors);

  const trustProxyResult = parseTrustProxy(env.TRUST_PROXY);
  if ("error" in trustProxyResult) {
    errors.push(trustProxyResult.error);
  }
  const trustProxy = "value" in trustProxyResult ? trustProxyResult.value : false;

  const smtpHost = env.SMTP_HOST?.trim() ?? "";
  if (!smtpHost) {
    errors.push("SMTP_HOST is required");
  }
  const smtpPort = Number(env.SMTP_PORT?.trim() || "");
  if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
    errors.push(`SMTP_PORT must be an integer between 1 and 65535 (got "${env.SMTP_PORT ?? ""}")`);
  }
  const smtpSecure = parseBoolean(env.SMTP_SECURE, false, "SMTP_SECURE", errors);
  const smtpFrom = env.SMTP_FROM?.trim() ?? "";
  if (!smtpFrom) {
    errors.push("SMTP_FROM is required");
  }

  if (errors.length > 0) {
    throw new Error(`Invalid configuration:\n  - ${errors.join("\n  - ")}`);
  }

  return {
    nodeEnv: env.NODE_ENV ?? "development",
    port,
    databaseUrl,
    appBaseUrl,
    webDistDir: env.WEB_DIST_DIR?.trim() || defaults.webDistDir,
    sessionTtlDays,
    cookieSecure,
    trustProxy,
    smtp: {
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      user: env.SMTP_USER?.trim() || undefined,
      pass: env.SMTP_PASS || undefined,
      from: smtpFrom,
    },
  };
}

function parseBoolean(raw: string | undefined, fallback: boolean, name: string, errors: string[]): boolean {
  const value = raw?.trim().toLowerCase();
  if (!value) {
    return fallback;
  }
  if (value === "true" || value === "1") {
    return true;
  }
  if (value === "false" || value === "0") {
    return false;
  }
  errors.push(`${name} must be true or false (got "${raw}")`);
  return fallback;
}

/** Makes the validated AppConfig injectable everywhere via @Inject(APP_CONFIG). */
@Module({})
export class AppConfigModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppConfigModule,
      global: true,
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
    };
  }
}
