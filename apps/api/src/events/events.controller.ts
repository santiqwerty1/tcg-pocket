/** Eventos con restricciones (Fase 16, docs/API.md «Eventos»): session-protected. */
import { Body, Controller, Delete, Get, HttpCode, Module, Param, Patch, Post } from '@nestjs/common'
import { eventRulesSchema } from '@tcg/domain'
import { z } from 'zod'
import { CurrentSession, type RequestSession } from '../auth/request-auth.js'
import { CatalogModule } from '../catalog/catalog.module.js'
import { ZodValidationPipe } from '../http/zod-validation.pipe.js'
import { TournamentsModule } from '../tournaments/tournaments.controller.js'
import { type EventDetailView, EventsService, type EventView } from './events.service.js'

const date = z.iso.date().nullable().optional()
const inputSchema = z.object({
  name: z.string().trim().min(1, 'Poné un nombre.').max(120),
  startsOn: date,
  endsOn: date,
  rules: eventRulesSchema,
  notes: z.string().max(2000).optional(),
})
const patchSchema = inputSchema.partial()

@Controller('api/events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  async list(@CurrentSession() _session: RequestSession): Promise<{ items: EventView[] }> {
    return { items: await this.events.list() }
  }

  @Post()
  @HttpCode(201)
  create(
    @Body(new ZodValidationPipe(inputSchema)) body: z.infer<typeof inputSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<EventView> {
    return this.events.create(body)
  }

  /** The event with which decks comply and which tournament lists of the era comply and can be built. */
  @Get(':id')
  detail(@Param('id') id: string, @CurrentSession() _session: RequestSession): Promise<EventDetailView> {
    return this.events.detail(id)
  }

  @Patch(':id')
  patch(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(patchSchema)) body: z.infer<typeof patchSchema>,
    @CurrentSession() _session: RequestSession,
  ): Promise<EventView> {
    return this.events.patch(id, body)
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @CurrentSession() _session: RequestSession): Promise<void> {
    await this.events.remove(id)
  }
}

@Module({
  imports: [CatalogModule, TournamentsModule],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
