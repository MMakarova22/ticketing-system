import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post, Query } from "@nestjs/common";
import { uuidPipe } from "../common/uuid.pipe.ts";
import { CreateEpicDto, UpdateEpicDto } from "./dto/epic.dto.ts";
import type { EpicView } from "./epic.view.ts";
import { EpicsService } from "./epics.service.ts";

@Controller("epics")
export class EpicsController {
  constructor(@Inject(EpicsService) private readonly epics: EpicsService) {}

  /** GET /api/epics?teamId=… — teamId is required. */
  @Get()
  list(@Query("teamId", uuidPipe("teamId")) teamId: string): Promise<EpicView[]> {
    return this.epics.listByTeam(teamId);
  }

  @Get(":id")
  get(@Param("id", uuidPipe("id")) id: string): Promise<EpicView> {
    return this.epics.get(id);
  }

  @Post()
  create(@Body() dto: CreateEpicDto): Promise<EpicView> {
    return this.epics.create(dto.teamId, { title: dto.title, description: dto.description });
  }

  @Patch(":id")
  update(@Param("id", uuidPipe("id")) id: string, @Body() dto: UpdateEpicDto): Promise<EpicView> {
    return this.epics.update(id, { title: dto.title, description: dto.description });
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param("id", uuidPipe("id")) id: string): Promise<void> {
    return this.epics.delete(id);
  }
}
