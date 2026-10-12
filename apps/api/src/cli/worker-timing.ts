/**
 * `pnpm -F @tcg/api worker-timing [--days 7]` (in production: `node /app/apps/api/dist/cli/worker-timing.js --days 7`
 * through `flyctl machine exec`). Phase 42, «medir primero»: per worker, the engine's time against the wall time of
 * each claim and the gap between a result and the next claim (median and p90), from the chunks it finished. Read only.
 */
import { parseArgs } from 'node:util'
import { workerTiming } from '@tcg/domain'
import { PrismaService } from '../prisma/prisma.service.js'
import { createCliContext } from './context.js'

const { values } = parseArgs({
  options: {
    days: { type: 'string', default: '7' },
    help: { type: 'boolean', default: false },
  },
  strict: true,
})

if (values.help) {
  console.log('Usage: worker-timing [--days 7]   (read only)')
  process.exit(0)
}
const days = Number(values.days)
if (!Number.isFinite(days) || days <= 0 || days > 90) {
  console.error('--days: from 1 to 90')
  process.exit(1)
}

const { context } = await createCliContext()
let exitCode = 0
try {
  const prisma = context.get(PrismaService)
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const rows = await prisma.$queryRaw<
    { workerId: string; takenAt: Date; finishedAt: Date; durationMs: number | null; games: number }[]
  >`
    SELECT c.worker_id AS "workerId", c.leased_at AS "takenAt", c.finished_at AS "finishedAt",
      c.duration_ms AS "durationMs", c.games
    FROM simulation_chunks c
    WHERE c.status = 'done' AND c.cached_from_id IS NULL AND c.worker_id IS NOT NULL
      -- Only chunks with their own start (leased_at, phase 42): before it, the first lease of another worker.
      AND c.finished_at > ${since} AND c.leased_at IS NOT NULL`
  const names = new Map(
    (await prisma.workerNode.findMany({ select: { id: true, name: true } })).map((node) => [node.id, node.name]),
  )
  const report = workerTiming(rows).map((row) => ({ name: names.get(row.workerId) ?? null, ...row }))
  console.log(JSON.stringify({ days, chunks: rows.length, workers: report }, null, 2))
} catch (error) {
  console.error(`worker-timing failed: ${error instanceof Error ? error.message : String(error)}`)
  exitCode = 1
} finally {
  await context.close()
}
process.exit(exitCode)
