/** Calibration of the simulations against tournaments (R-012): `/api/calibration`. */
import { Body, Controller, Get, Module, Param, Post } from '@nestjs/common'
import { BOT_CODE_PATTERN, CALIBRATION_MAX_GAUNTLET_SIZE, TOURNAMENT_FORMATS } from '@tcg/domain'
import { z } from 'zod'
import { CurrentSession, type RequestSession } from '../auth/request-auth.js'
import { ZodValidationPipe } from '../http/zod-validation.pipe.js'
import { LabModule } from '../lab/lab.controller.js'
import { TournamentsModule } from '../tournaments/tournaments.controller.js'
import { CalibrationService } from './calibration.service.js'
import { SimulationModule } from './simulation.controller.js'

const startSchema = z.object({
  bot: z.string().regex(BOT_CODE_PATTERN, 'Bot desconocido.'),
  gamesPerPair: z.number().int().min(10).max(2000).optional(),
  size: z.number().int().min(3).max(CALIBRATION_MAX_GAUNTLET_SIZE).optional(),
  era: z
    .string()
    .regex(/^[A-Za-z0-9-]{1,8}$/)
    .optional(),
  format: z.enum(TOURNAMENT_FORMATS).optional(),
})
const idParam = z.coerce.number().int().positive()

@Controller('api/calibration')
export class CalibrationController {
  constructor(private readonly calibration: CalibrationService) {}

  @Get()
  list(@CurrentSession() _session: RequestSession) {
    return this.calibration.list()
  }

  /** The meta bank against itself with the chosen bot (a matrix job of the queue). */
  @Post()
  start(
    @Body(new ZodValidationPipe(startSchema)) body: z.infer<typeof startSchema>,
    @CurrentSession() _session: RequestSession,
  ) {
    return this.calibration.start(body)
  }

  @Get(':id')
  report(@Param('id', new ZodValidationPipe(idParam)) id: number, @CurrentSession() _session: RequestSession) {
    return this.calibration.report(id)
  }
}

@Module({
  imports: [SimulationModule, LabModule, TournamentsModule],
  controllers: [CalibrationController],
  providers: [CalibrationService],
  // The MCP tool simulations_calibration reads the same reports.
  exports: [CalibrationService],
})
export class CalibrationModule {}
