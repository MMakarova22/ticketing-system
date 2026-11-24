import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post, Query } from "@nestjs/common";
import type { AuthUser } from "../common/authenticated-request.ts";
import { CurrentUser } from "../common/current-user.decorator.ts";
import { uuidPipe } from "../common/uuid.pipe.ts";
import { CreateTicketDto, UpdateTicketDto } from "./dto/ticket.dto.ts";
import type { TicketView } from "./ticket.view.ts";
import { TicketsService } from "./tickets.service.ts";

@Controller("tickets")
export class TicketsController {
  constructor(@Inject(TicketsService) private readonly tickets: TicketsService) {}

  /** GET /api/tickets?teamId=… — teamId is required; sorted by modifiedAt, newest first. */
  @Get()
  list(@Query("teamId", uuidPipe("teamId")) teamId: string): Promise<TicketView[]> {
    return this.tickets.listByTeam(teamId);
  }

  @Get(":id")
  get(@Param("id", uuidPipe("id")) id: string): Promise<TicketView> {
    return this.tickets.get(id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTicketDto): Promise<TicketView> {
    return this.tickets.create(user.id, {
      teamId: dto.teamId,
      epicId: dto.epicId,
      type: dto.type,
      state: dto.state,
      title: dto.title,
      body: dto.body,
    });
  }

  @Patch(":id")
  update(@Param("id", uuidPipe("id")) id: string, @Body() dto: UpdateTicketDto): Promise<TicketView> {
    return this.tickets.update(id, {
      teamId: dto.teamId,
      epicId: dto.epicId,
      type: dto.type,
      state: dto.state,
      title: dto.title,
      body: dto.body,
    });
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param("id", uuidPipe("id")) id: string): Promise<void> {
    return this.tickets.delete(id);
  }
}
