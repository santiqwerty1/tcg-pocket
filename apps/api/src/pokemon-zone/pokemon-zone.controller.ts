/**
 * pokemon-zone (2/11/2026, docs/API.md «pokemon-zone»): session-protected like the rest. The body is the payload the
 * bookmarklet reads on pokemon-zone.com (`pokemonZonePayloadSchema` of @tcg/domain): anything else is a 400 whose
 * details name the fields, never their values. Nothing here logs the body.
 */
import { Body, Controller, Get, HttpCode, Module, Post } from '@nestjs/common'
import { type PokemonZonePayload, pokemonZonePayloadSchema } from '@tcg/domain'
import { CurrentSession, type RequestSession } from '../auth/request-auth.js'
import { CatalogModule } from '../catalog/catalog.module.js'
import { ZodValidationPipe } from '../http/zod-validation.pipe.js'
import {
  type PokemonZonePreview,
  type PokemonZoneSaved,
  PokemonZoneService,
  type PokemonZoneSummary,
} from './pokemon-zone.service.js'

@Controller('api/pokemon-zone')
export class PokemonZoneController {
  constructor(private readonly pokemonZone: PokemonZoneService) {}

  /** The latest import with its comparisons; `{ imports: 0, latest: null, … }` before the first one. */
  @Get()
  summary(@CurrentSession() _session: RequestSession): Promise<PokemonZoneSummary> {
    return this.pokemonZone.summary()
  }

  /** What saving would change (settings of Sobres, coupons, counters); writes nothing. */
  @Post('preview')
  @HttpCode(200)
  preview(
    @Body(new ZodValidationPipe(pokemonZonePayloadSchema)) body: PokemonZonePayload,
    @CurrentSession() _session: RequestSession,
  ): Promise<PokemonZonePreview> {
    return this.pokemonZone.preview(body)
  }

  /** Stores the import and writes the pack points and the pack hourglasses of Sobres. */
  @Post('imports')
  @HttpCode(201)
  save(
    @Body(new ZodValidationPipe(pokemonZonePayloadSchema)) body: PokemonZonePayload,
    @CurrentSession() _session: RequestSession,
  ): Promise<PokemonZoneSaved> {
    return this.pokemonZone.save(body)
  }
}

@Module({
  imports: [CatalogModule],
  controllers: [PokemonZoneController],
  providers: [PokemonZoneService],
  exports: [PokemonZoneService],
})
export class PokemonZoneModule {}
