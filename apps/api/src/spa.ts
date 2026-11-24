import type { Logger } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { NextFunction, Request, Response } from "express";
import { existsSync } from "node:fs";
import { extname, join, sep } from "node:path";

/**
 * Serves the compiled SPA from the same origin as the API (spec §2 allows the backend to serve the SPA).
 * - Static files are served as-is; hashed files under /assets are cached long-term.
 * - Any other GET outside /api without a file extension returns index.html (client-side routing).
 * - /api/* is never handled here, so unknown API routes still return JSON 404s from Nest.
 */
export function configureSpa(app: NestExpressApplication, webDistDir: string, logger: Logger): void {
  const indexHtml = join(webDistDir, "index.html");
  if (!existsSync(indexHtml)) {
    logger.warn(`SPA build not found at ${webDistDir}; serving the API only (use the Vite dev server in development).`);
    return;
  }

  app.useStaticAssets(webDistDir, {
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.includes(`${sep}assets${sep}`)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    },
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    const isApi = req.path === "/api" || req.path.startsWith("/api/");
    if ((req.method !== "GET" && req.method !== "HEAD") || isApi || extname(req.path) !== "") {
      next();
      return;
    }
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(indexHtml);
  });

  logger.log(`Serving SPA from ${webDistDir}`);
}
