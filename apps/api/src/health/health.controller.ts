import { Controller, Get, Logger, ServiceUnavailableException } from "@nestjs/common";
import { Public } from "../common/public.decorator.ts";
import { PrismaService } from "../prisma/prisma.service.ts";

export interface HealthStatus {
  status: "ok";
  database: "up";
}

/** Public liveness/readiness endpoint: GET /api/health. Also used by the Docker healthcheck. */
@Public()
@Controller("health")
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<HealthStatus> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      this.logger.error(`Database health check failed: ${(error as Error).message}`);
      // Standard error body (review I4): {statusCode: 503, message, code}.
      throw new ServiceUnavailableException({ message: "Database is unavailable", code: "DATABASE_UNAVAILABLE" });
    }
    return { status: "ok", database: "up" };
  }
}
