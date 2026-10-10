import { execFileSync } from 'node:child_process'

/** CI elsewhere does not occupy this PC. Override the prefix when measuring on the Ryzen. */
export function requireNoLocalCI() {
  const prefix = process.env.TCG_MEASURE_RUNNER_PREFIX ?? 'tcg-pc-'
  const runs = JSON.parse(
    execFileSync('gh', ['run', 'list', '--status', 'in_progress', '--limit', '100', '--json', 'databaseId'], {
      encoding: 'utf8',
    }),
  )
  const activeJobs = runs.flatMap((run) => {
    const { jobs } = JSON.parse(
      execFileSync('gh', ['api', `repos/{owner}/{repo}/actions/runs/${run.databaseId}/jobs?per_page=100`], {
        encoding: 'utf8',
      }),
    )
    return jobs
      .filter((job) => job.status === 'in_progress')
      .map((job) => ({
        run: run.databaseId,
        job: job.name,
        runner: job.runner_name,
      }))
  })
  if (activeJobs.some((job) => !job.runner || job.runner.startsWith(prefix))) {
    throw new Error(`Wait for CI on ${prefix} before measuring: ${JSON.stringify(activeJobs)}`)
  }
  return { checkedAt: new Date().toISOString(), localRunnerPrefix: prefix, activeJobsElsewhere: activeJobs }
}
