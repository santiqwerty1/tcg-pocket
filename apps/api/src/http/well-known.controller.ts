import { All, Controller, NotFoundException } from '@nestjs/common'

/** Public. Reserved for OAuth protected-resource metadata if the MCP connector ever needs it (PLAN §3.8). */
@Controller('.well-known')
export class WellKnownController {
  @All('{*path}')
  notFound(): never {
    throw new NotFoundException('Nada publicado en /.well-known todavía.')
  }
}
