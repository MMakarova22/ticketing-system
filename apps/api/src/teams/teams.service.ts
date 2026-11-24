import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { hasChanges, pickChanges } from "../common/changes.ts";
import { isForeignKeyViolation, isRecordNotFound, isUniqueViolation } from "../common/prisma-errors.ts";
import { PrismaService } from "../prisma/prisma.service.ts";
import { TEAM_SELECT, type TeamView, toTeamView } from "./team.view.ts";

/** Case-insensitive uniqueness key for team names (spec §4). */
export function normalizeTeamName(name: string): string {
  return name.trim().toLowerCase();
}

export function teamNotFound(): NotFoundException {
  return new NotFoundException({ message: "Team not found", code: "TEAM_NOT_FOUND" });
}

function nameTaken(): ConflictException {
  return new ConflictException({ message: "A team with this name already exists", code: "TEAM_NAME_TAKEN" });
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

@Injectable()
export class TeamsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(): Promise<TeamView[]> {
    const rows = await this.prisma.team.findMany({ select: TEAM_SELECT, orderBy: { nameNormalized: "asc" } });
    return rows.map(toTeamView);
  }

  async create(name: string): Promise<TeamView> {
    try {
      const row = await this.prisma.team.create({
        data: { name, nameNormalized: normalizeTeamName(name) },
        select: TEAM_SELECT,
      });
      return toTeamView(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw nameTaken();
      }
      throw error;
    }
  }

  /** Renames a team. Saving the same name is a no-op and keeps `modifiedAt` (D7). */
  async rename(id: string, name: string): Promise<TeamView> {
    const current = await this.prisma.team.findUnique({ where: { id }, select: { name: true, nameNormalized: true } });
    if (!current) {
      throw teamNotFound();
    }

    const changes = pickChanges(current, { name, nameNormalized: normalizeTeamName(name) });
    try {
      const row = hasChanges(changes)
        ? await this.prisma.team.update({ where: { id }, data: changes, select: TEAM_SELECT })
        : await this.prisma.team.findUniqueOrThrow({ where: { id }, select: TEAM_SELECT });
      return toTeamView(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw nameTaken();
      }
      if (isRecordNotFound(error)) {
        throw teamNotFound();
      }
      throw error;
    }
  }

  /** Deletes an empty team. A team with epics or tickets is never deleted (409); there is no cascade (spec §4). */
  async delete(id: string): Promise<void> {
    const team = await this.prisma.team.findUnique({ where: { id }, select: TEAM_SELECT });
    if (!team) {
      throw teamNotFound();
    }
    const { epics, tickets } = team._count;
    if (epics > 0 || tickets > 0) {
      throw new ConflictException({
        message: `This team cannot be deleted while it contains ${plural(tickets, "ticket")} and ${plural(epics, "epic")}.`,
        code: "TEAM_IN_USE",
      });
    }

    try {
      await this.prisma.team.delete({ where: { id } });
    } catch (error) {
      // An epic or ticket was added after the check: the Restrict foreign keys block the delete.
      if (isForeignKeyViolation(error)) {
        throw new ConflictException({
          message: "This team cannot be deleted while it contains tickets or epics.",
          code: "TEAM_IN_USE",
        });
      }
      if (isRecordNotFound(error)) {
        throw teamNotFound();
      }
      throw error;
    }
  }
}
