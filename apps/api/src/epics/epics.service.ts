import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { hasChanges, pickChanges } from "../common/changes.ts";
import { isForeignKeyViolation, isRecordNotFound } from "../common/prisma-errors.ts";
import { PrismaService } from "../prisma/prisma.service.ts";
import { teamNotFound } from "../teams/teams.service.ts";
import { EPIC_SELECT, type EpicView, toEpicView } from "./epic.view.ts";

function epicNotFound(): NotFoundException {
  return new NotFoundException({ message: "Epic not found", code: "EPIC_NOT_FOUND" });
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

const byTitle = (a: EpicView, b: EpicView): number =>
  a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) || a.createdAt.localeCompare(b.createdAt);

export interface EpicInput {
  title: string;
  description?: string | null | undefined;
}

/** Fields of a PATCH; `undefined` means "not provided". */
export interface EpicUpdate {
  title?: string | undefined;
  description?: string | null | undefined;
}

@Injectable()
export class EpicsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Epics of one team, ordered by title (case-insensitive). 404 if the team does not exist. */
  async listByTeam(teamId: string): Promise<EpicView[]> {
    const team = await this.prisma.team.findUnique({ where: { id: teamId }, select: { id: true } });
    if (!team) {
      throw teamNotFound();
    }
    const rows = await this.prisma.epic.findMany({ where: { teamId }, select: EPIC_SELECT });
    return rows.map(toEpicView).sort(byTitle);
  }

  async get(id: string): Promise<EpicView> {
    const row = await this.prisma.epic.findUnique({ where: { id }, select: EPIC_SELECT });
    if (!row) {
      throw epicNotFound();
    }
    return toEpicView(row);
  }

  async create(teamId: string, input: EpicInput): Promise<EpicView> {
    const team = await this.prisma.team.findUnique({ where: { id: teamId }, select: { id: true } });
    if (!team) {
      throw teamNotFound();
    }
    try {
      const row = await this.prisma.epic.create({
        data: { teamId, title: input.title, description: input.description ?? null },
        select: EPIC_SELECT,
      });
      return toEpicView(row);
    } catch (error) {
      // The team was deleted after the check.
      if (isForeignKeyViolation(error)) {
        throw teamNotFound();
      }
      throw error;
    }
  }

  /** Updates title and/or description. Unchanged values are a no-op and keep `modifiedAt` (D7). */
  async update(id: string, input: EpicUpdate): Promise<EpicView> {
    const current = await this.prisma.epic.findUnique({ where: { id }, select: { title: true, description: true } });
    if (!current) {
      throw epicNotFound();
    }
    const changes = pickChanges(current, { title: input.title, description: input.description });
    if (!hasChanges(changes)) {
      return this.get(id);
    }
    try {
      return toEpicView(await this.prisma.epic.update({ where: { id }, data: changes, select: EPIC_SELECT }));
    } catch (error) {
      if (isRecordNotFound(error)) {
        throw epicNotFound();
      }
      throw error;
    }
  }

  /** Deletes an epic that no ticket references (409 otherwise, spec §5). */
  async delete(id: string): Promise<void> {
    const epic = await this.prisma.epic.findUnique({ where: { id }, select: EPIC_SELECT });
    if (!epic) {
      throw epicNotFound();
    }
    const tickets = epic._count.tickets;
    if (tickets > 0) {
      throw new ConflictException({
        message: `This epic cannot be deleted while ${plural(tickets, "ticket")} ${tickets === 1 ? "references" : "reference"} it.`,
        code: "EPIC_IN_USE",
      });
    }

    try {
      await this.prisma.epic.delete({ where: { id } });
    } catch (error) {
      // A ticket started referencing the epic after the check: the Restrict foreign key blocks the delete.
      if (isForeignKeyViolation(error)) {
        throw new ConflictException({
          message: "This epic cannot be deleted while tickets reference it.",
          code: "EPIC_IN_USE",
        });
      }
      if (isRecordNotFound(error)) {
        throw epicNotFound();
      }
      throw error;
    }
  }
}
