import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { hasChanges, pickChanges } from "../common/changes.ts";
import { isForeignKeyViolation, isRecordNotFound } from "../common/prisma-errors.ts";
import type { TicketState, TicketType } from "../generated/prisma/enums.ts";
import { PrismaService } from "../prisma/prisma.service.ts";
import { teamNotFound } from "../teams/teams.service.ts";
import { TICKET_SELECT, type TicketView, toTicketView } from "./ticket.view.ts";

export function ticketNotFound(): NotFoundException {
  return new NotFoundException({ message: "Ticket not found", code: "TICKET_NOT_FOUND" });
}

function invalidEpic(): BadRequestException {
  return new BadRequestException({
    message: "The epic does not exist or does not belong to the ticket's team",
    code: "INVALID_EPIC",
  });
}

export interface TicketInput {
  teamId: string;
  epicId?: string | null | undefined;
  type: TicketType;
  state?: TicketState | undefined;
  title: string;
  body: string;
}

/** Fields of a PATCH; `undefined` means "not provided". Only `epicId` may be null (no epic). */
export interface TicketUpdate {
  teamId?: string | undefined;
  epicId?: string | null | undefined;
  type?: TicketType | undefined;
  state?: TicketState | undefined;
  title?: string | undefined;
  body?: string | undefined;
}

@Injectable()
export class TicketsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Tickets of one team, most recently modified first. 404 if the team does not exist. */
  async listByTeam(teamId: string): Promise<TicketView[]> {
    await this.assertTeamExists(teamId);
    const rows = await this.prisma.ticket.findMany({
      where: { teamId },
      select: TICKET_SELECT,
      orderBy: [{ modifiedAt: "desc" }, { createdAt: "desc" }, { id: "asc" }],
    });
    return rows.map(toTicketView);
  }

  async get(id: string): Promise<TicketView> {
    const row = await this.prisma.ticket.findUnique({ where: { id }, select: TICKET_SELECT });
    if (!row) {
      throw ticketNotFound();
    }
    return toTicketView(row);
  }

  /** Creates a ticket. The creator always comes from the session, never from the request body. */
  async create(createdById: string, input: TicketInput): Promise<TicketView> {
    const epicId = input.epicId ?? null;
    await this.assertTeamExists(input.teamId);
    if (epicId !== null) {
      await this.assertEpicInTeam(epicId, input.teamId);
    }

    try {
      const row = await this.prisma.ticket.create({
        data: {
          teamId: input.teamId,
          epicId,
          type: input.type,
          ...(input.state === undefined ? {} : { state: input.state }),
          title: input.title,
          body: input.body,
          createdById,
        },
        select: TICKET_SELECT,
      });
      return toTicketView(row);
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw await this.foreignKeyError(input.teamId);
      }
      throw error;
    }
  }

  /**
   * Partial update. Only fields whose values actually differ are written; when nothing differs the row is not
   * touched at all, so `modifiedAt` keeps its value (D7).
   *
   * The epic must always belong to the ticket's (possibly new) team. Changing the team while the ticket keeps an
   * epic of the old team is rejected (400); the client must send `epicId: null` or an epic of the new team.
   */
  async update(id: string, input: TicketUpdate): Promise<TicketView> {
    const current = await this.prisma.ticket.findUnique({
      where: { id },
      select: { teamId: true, epicId: true, type: true, state: true, title: true, body: true },
    });
    if (!current) {
      throw ticketNotFound();
    }

    const teamId = input.teamId ?? current.teamId;
    const epicId = input.epicId !== undefined ? input.epicId : current.epicId;
    if (teamId !== current.teamId) {
      await this.assertTeamExists(teamId);
    }
    if (epicId !== null && (teamId !== current.teamId || epicId !== current.epicId)) {
      await this.assertEpicInTeam(epicId, teamId);
    }

    const changes = pickChanges(current, {
      teamId: input.teamId,
      epicId: input.epicId,
      type: input.type,
      state: input.state,
      title: input.title,
      body: input.body,
    });
    if (!hasChanges(changes)) {
      return this.get(id);
    }

    try {
      return toTicketView(await this.prisma.ticket.update({ where: { id }, data: changes, select: TICKET_SELECT }));
    } catch (error) {
      if (isRecordNotFound(error)) {
        throw ticketNotFound();
      }
      if (isForeignKeyViolation(error)) {
        throw await this.foreignKeyError(teamId);
      }
      throw error;
    }
  }

  /** Deletes a ticket. Its comments are deleted by the database (ON DELETE CASCADE). */
  async delete(id: string): Promise<void> {
    try {
      await this.prisma.ticket.delete({ where: { id } });
    } catch (error) {
      if (isRecordNotFound(error)) {
        throw ticketNotFound();
      }
      throw error;
    }
  }

  private async assertTeamExists(teamId: string): Promise<void> {
    const team = await this.prisma.team.findUnique({ where: { id: teamId }, select: { id: true } });
    if (!team) {
      throw teamNotFound();
    }
  }

  /** 400 INVALID_EPIC unless the epic exists and belongs to the team. */
  private async assertEpicInTeam(epicId: string, teamId: string): Promise<void> {
    const epic = await this.prisma.epic.findUnique({ where: { id: epicId }, select: { teamId: true } });
    if (!epic || epic.teamId !== teamId) {
      throw invalidEpic();
    }
  }

  /**
   * Explains a foreign key violation that happened after the checks passed (a concurrent delete of the team or
   * epic). The composite (epicId, teamId) foreign key is the database backstop for "epic belongs to the team".
   */
  private async foreignKeyError(teamId: string): Promise<BadRequestException | NotFoundException> {
    const team = await this.prisma.team.findUnique({ where: { id: teamId }, select: { id: true } });
    return team ? invalidEpic() : teamNotFound();
  }
}
