import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import {
  type CanActivate,
  Controller,
  type ExecutionContext,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
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

/**
 * The packages built into the image, per platform (T-015, D-026): Android's (with Node from Termux) and the Windows
 * update package (without Node: tcg-worker.exe brings it). Each worker updates itself to the one served here.
 */
const PLATFORMS = {
  'android-arm64': { archive: 'android-arm64.tar.gz', version: 'android-version.json', label: 'Android' },
  'windows-x64': { archive: 'windows-x64.tar.gz', version: 'windows-x64-version.json', label: 'de Windows' },
} as const
type Platform = keyof typeof PLATFORMS

/** What a worker compares with the package it runs (D-026): servers before it sent only the engine. */
export interface PackageVersion {
  platform: Platform
  workerVersion?: string
  engineRev: string
  cliVersion: string
  sha256: string
  size: number
}

async function sha256Of(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

function platformOf(value: string): Platform {
  if (!Object.hasOwn(PLATFORMS, value)) throw new NotFoundException('No hay paquete para esa plataforma.')
  return value as Platform
}

@Injectable()
export class WorkerPackages {
  /** Test fixtures supply their own folder; production serves only files built into this image. */
  directory =
    process.env.WORKER_PACKAGES_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../../worker/build')
  /** The sum of each archive, computed once per file (it does not change while the image runs). */
  private readonly sums = new Map<string, Promise<string>>()

  async artifact(name: string): Promise<Buffer> {
    try {
      return await readFile(join(this.directory, name))
    } catch {
      throw new ServiceUnavailableException('El paquete Android no está construido en esta imagen.')
    }
  }

  /** The archive's path, size and sha256 (streamed: a package never sits whole in memory). */
  async archive(platform: Platform): Promise<{ file: string; size: number; sha256: string }> {
    const file = join(this.directory, PLATFORMS[platform].archive)
    let info: Awaited<ReturnType<typeof stat>>
    try {
      info = await stat(file)
    } catch {
      throw new ServiceUnavailableException(
        `El paquete ${PLATFORMS[platform].label} no está construido en esta imagen.`,
      )
    }
    const key = `${file}:${info.size}:${info.mtimeMs}`
    let sum = this.sums.get(key)
    if (!sum) {
      sum = sha256Of(file)
      sum.catch(() => this.sums.delete(key))
      this.sums.set(key, sum)
    }
    return { file, size: Number(info.size), sha256: await sum }
  }

  async version(platform: Platform): Promise<PackageVersion> {
    const declared = JSON.parse((await this.artifact(PLATFORMS[platform].version)).toString('utf8')) as Omit<
      PackageVersion,
      'sha256' | 'size' | 'platform'
    >
    const { size, sha256 } = await this.archive(platform)
    return { ...declared, platform, sha256, size }
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

  /** The package of a platform; `X-Checksum-Sha256` is the same sum its version announces. */
  @Get('packages/:platform')
  @UseGuards(WorkerPackageGuard)
  async download(@Param('platform') platform: string, @Res() response: Response) {
    const { file, size, sha256 } = await this.packages.archive(platformOf(platform))
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Checksum-Sha256', sha256)
    response.setHeader('Content-Length', String(size))
    response.setHeader('Content-Disposition', `attachment; filename="tcg-worker-${platform}.tar.gz"`)
    response.type('application/gzip')
    // Once bytes went out there is no error page to send: a cut download fails the worker's sum and it retries.
    await pipeline(createReadStream(file), response).catch(() => response.destroy())
  }

  /** What the package is (worker, engine) and its sha256 and size: each worker updates itself when it differs. */
  @Get('packages/:platform/version')
  @UseGuards(WorkerPackageGuard)
  version(@Param('platform') platform: string): Promise<PackageVersion> {
    return this.packages.version(platformOf(platform))
  }
}

@Module({
  imports: [TokensModule],
  controllers: [WorkerPackagesController],
  providers: [WorkerPackages, WorkerPackageGuard],
})
export class WorkerPackagesModule {}
