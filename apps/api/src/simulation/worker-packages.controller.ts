import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type CanActivate,
  Controller,
  type ExecutionContext,
  Get,
  Injectable,
  Module,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import { parseBearer } from '../tokens/token-format.js'
import { TokensModule } from '../tokens/tokens.module.js'
import { TokensService } from '../tokens/tokens.service.js'

/** Packages accept only worker credentials, even when another token happens to carry a scope. */
@Injectable()
export class WorkerPackageGuard implements CanActivate {
  constructor(private readonly tokens: TokensService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>()
    const bearer = parseBearer(request.headers.authorization)
    const token = bearer ? await this.tokens.authenticate(bearer) : null
    if (token?.kind !== 'worker' || !token.scopes.includes('worker:claim')) {
      context.switchToHttp().getResponse<Response>().setHeader('WWW-Authenticate', 'Bearer')
      throw new UnauthorizedException('La descarga requiere un token de worker en Authorization: Bearer.')
    }
    return true
  }
}

@Injectable()
export class WorkerPackages {
  /** Test fixtures supply their own folder; production serves only files built into this image. */
  directory =
    process.env.WORKER_PACKAGES_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../../worker/build')

  async artifact(name: string): Promise<Buffer> {
    try {
      return await readFile(join(this.directory, name))
    } catch {
      throw new ServiceUnavailableException('El paquete Android no está construido en esta imagen.')
    }
  }
}

@Controller('api/worker')
export class WorkerPackagesController {
  constructor(private readonly packages: WorkerPackages) {}

  /** No credentials or data in this bootstrap. It prompts for the bearer inside Termux. */
  @Get('install/android.sh')
  async installer(@Res() response: Response) {
    const body = await this.packages.artifact('install-android.sh')
    response.setHeader('Cache-Control', 'no-store')
    response.type('text/plain').send(body)
  }

  @Get('packages/android-arm64')
  @UseGuards(WorkerPackageGuard)
  async android(@Res() response: Response) {
    const body = await this.packages.artifact('android-arm64.tar.gz')
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Checksum-Sha256', createHash('sha256').update(body).digest('hex'))
    response.setHeader('Content-Disposition', 'attachment; filename="tcg-worker-android-arm64.tar.gz"')
    response.type('application/gzip').send(body)
  }

  @Get('packages/android-arm64/version')
  @UseGuards(WorkerPackageGuard)
  async version() {
    return JSON.parse((await this.packages.artifact('android-version.json')).toString('utf8')) as {
      engineRev: string
      cliVersion: string
    }
  }
}

@Module({
  imports: [TokensModule],
  controllers: [WorkerPackagesController],
  providers: [WorkerPackages, WorkerPackageGuard],
})
export class WorkerPackagesModule {}
