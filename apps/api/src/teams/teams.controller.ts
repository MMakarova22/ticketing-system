import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post } from "@nestjs/common";
import { uuidPipe } from "../common/uuid.pipe.ts";
import { TeamNameDto } from "./dto/team.dto.ts";
import type { TeamView } from "./team.view.ts";
import { TeamsService } from "./teams.service.ts";

@Controller("teams")
export class TeamsController {
  constructor(@Inject(TeamsService) private readonly teams: TeamsService) {}

  @Get()
  list(): Promise<TeamView[]> {
    return this.teams.list();
  }

  @Post()
  create(@Body() dto: TeamNameDto): Promise<TeamView> {
    return this.teams.create(dto.name);
  }

  @Patch(":id")
  rename(@Param("id", uuidPipe("id")) id: string, @Body() dto: TeamNameDto): Promise<TeamView> {
    return this.teams.rename(id, dto.name);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param("id", uuidPipe("id")) id: string): Promise<void> {
    return this.teams.delete(id);
  }
}
