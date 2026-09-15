import { isDeepStrictEqual } from 'node:util'

const bot = 'dependabot[bot]'
const workflowPath = '.github/workflows/ci.yml'
const requiredJobs = {
  Quality: ['Install dependencies', 'Lint and types', 'Unit tests', 'Build', 'Worker bundle'],
  'Browser smoke': ['Install dependencies', 'Build', 'Install Chromium', 'Browser smoke'],
}
const successful = (item) => item?.status === 'completed' && item.conclusion === 'success'

export function dependencyOnlyManifest(before, after) {
  const old = JSON.parse(before)
  const next = JSON.parse(after)
  for (const key of ['dependencies', 'devDependencies']) {
    if (!isDeepStrictEqual(Object.keys(old[key] ?? {}).sort(), Object.keys(next[key] ?? {}).sort()))
      return false
    const registryVersion = /^[~^]?\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/
    if (
      Object.values(next[key] ?? {}).some(
        (value) => typeof value !== 'string' || !registryVersion.test(value),
      )
    )
      return false
    delete old[key]
    delete next[key]
  }
  return isDeepStrictEqual(old, next)
}

export function actionReferencesOnly(before, after) {
  const old = before.split('\n')
  const next = after.split('\n')
  if (old.length !== next.length) return false
  const reference = /^(\s*(?:- )?uses: )([\w-]+\/[\w./-]+)@([a-f0-9]{40})(?:\s+#.*)?$/
  return old.every((line, index) => {
    if (line === next[index]) return true
    const a = line.match(reference)
    const b = next[index].match(reference)
    return Boolean(a && b && a[1] === b[1] && a[2] === b[2])
  })
}

export async function mergeDependabot({ api, repository, runId, dryRun = false }) {
  const root = `/repos/${repository}`
  const skip = (reason) => ({ merged: false, reason })
  const list = async (path, key) => {
    const items = []
    for (let page = 1; page <= 30; page++) {
      const data = await api(
        `${root}${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`,
      )
      const batch = key ? data[key] : data
      if (!Array.isArray(batch)) throw new Error('Missing paginated API result')
      items.push(...batch)
      if (batch.length < 100) return items
    }
    throw new Error('API result exceeds the pagination limit')
  }
  const run = await api(`${root}/actions/runs/${runId}`)
  if (
    !successful(run) ||
    run.event !== 'pull_request' ||
    run.path !== workflowPath ||
    run.actor?.login !== bot ||
    run.head_repository?.full_name !== repository ||
    !/^[a-f0-9]{40}$/.test(run.head_sha)
  )
    return skip('Not a successful Dependabot PR run from this repository')
  const workflow = await api(`${root}/actions/workflows/ci.yml`)
  if (run.workflow_id !== workflow.id || workflow.path !== workflowPath)
    return skip('Unexpected CI workflow')

  const candidates = (await list(`/commits/${run.head_sha}/pulls`)).filter(
    (pr) => pr.state === 'open' && pr.head?.sha === run.head_sha,
  )
  if (candidates.length !== 1) return skip('No unique open PR for the tested commit')
  const number = candidates[0].number
  const pr = await api(`${root}/pulls/${number}`)
  const eligible = (pull) =>
    pull.state === 'open' &&
    pull.draft === false &&
    pull.merged === false &&
    pull.user?.login === bot &&
    pull.head?.repo?.full_name === repository &&
    pull.base?.repo?.full_name === repository &&
    pull.base.ref === 'main' &&
    pull.head.sha === run.head_sha &&
    pull.head.ref === run.head_branch &&
    pull.head.ref.startsWith('dependabot/') &&
    pull.mergeable === true &&
    pull.mergeable_state === 'clean' &&
    Array.isArray(pull.labels) &&
    !pull.labels.some((label) => label.name === 'do-not-merge')
  if (!eligible(pr)) return skip('PR is not eligible or mergeability is not confirmed')
  const base = await api(`${root}/git/ref/heads/main`)
  const baseSha = base.object.sha
  const comparison = await api(`${root}/compare/${baseSha}...${run.head_sha}`)
  if (
    comparison.status !== 'ahead' ||
    comparison.behind_by !== 0 ||
    comparison.merge_base_commit?.sha !== baseSha
  )
    return skip('PR must include the current main before its CI run')

  const jobs = await list(`/actions/runs/${runId}/attempts/${run.run_attempt}/jobs`, 'jobs')
  if (jobs.length !== Object.keys(requiredJobs).length || jobs.some((job) => !successful(job)))
    return skip('CI has incomplete, unsuccessful, or unexpected jobs')
  for (const [name, steps] of Object.entries(requiredJobs)) {
    const matching = jobs.filter((job) => job.name === name && job.head_sha === run.head_sha)
    if (
      matching.length !== 1 ||
      steps.some(
        (step) =>
          matching[0].steps?.filter((item) => item.name === step && successful(item)).length !== 1,
      )
    )
      return skip('A required CI job or step did not pass')
  }
  const checks = await list(`/commits/${run.head_sha}/check-runs?filter=latest`, 'check_runs')
  if (checks.length === 0 || checks.some((check) => !successful(check)))
    return skip('A commit check is missing, pending, or unsuccessful')
  for (const name of Object.keys(requiredJobs)) {
    if (
      !checks.some(
        (check) =>
          check.name === name &&
          check.app?.slug === 'github-actions' &&
          check.check_suite?.id === run.check_suite_id,
      )
    )
      return skip('Required checks do not belong to the verified CI run')
  }
  const statuses = await list(`/commits/${run.head_sha}/statuses`)
  const latestStatuses = new Map()
  for (const status of statuses) {
    if (!latestStatuses.has(status.context)) latestStatuses.set(status.context, status)
  }
  if ([...latestStatuses.values()].some((status) => status.state !== 'success'))
    return skip('A commit status is pending or unsuccessful')
  const reviews = await list(`/pulls/${number}/reviews`)
  const latestReviews = new Map()
  for (const review of reviews) {
    if (['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state))
      latestReviews.set(review.user.id, review.state)
  }
  if ([...latestReviews.values()].includes('CHANGES_REQUESTED'))
    return skip('Changes were requested')

  const files = await list(`/pulls/${number}/files`)
  if (
    files.length === 0 ||
    files.length !== pr.changed_files ||
    files.some((file) => file.status !== 'modified')
  )
    return skip('Unexpected file additions, deletions, renames, or incomplete diff')
  const content = async (path, sha) => {
    const data = await api(`${root}/contents/${path}?ref=${sha}`)
    if (data.type !== 'file' || data.encoding !== 'base64' || !data.content)
      throw new Error('Missing file content')
    return Buffer.from(data.content, 'base64').toString('utf8')
  }
  for (const file of files) {
    if (file.filename === 'package-lock.json') continue
    const isManifest = file.filename === 'package.json'
    if (!isManifest && !/^\.github\/workflows\/[\w-]+\.ya?ml$/.test(file.filename))
      return skip('PR changes files outside dependency manifests and action references')
    const before = await content(file.filename, baseSha)
    const after = await content(file.filename, run.head_sha)
    if (!(isManifest ? dependencyOnlyManifest(before, after) : actionReferencesOnly(before, after)))
      return skip('PR changes behavior outside dependency versions')
  }

  const freshRun = await api(`${root}/actions/runs/${runId}`)
  const freshPr = await api(`${root}/pulls/${number}`)
  const freshBase = await api(`${root}/git/ref/heads/main`)
  if (
    !successful(freshRun) ||
    freshRun.run_attempt !== run.run_attempt ||
    freshRun.head_sha !== run.head_sha ||
    !eligible(freshPr) ||
    freshBase.object.sha !== baseSha
  )
    return skip('PR, CI attempt, or main changed during verification')
  if (dryRun) return { merged: false, eligible: true, number, sha: run.head_sha }
  const result = await api(`${root}/pulls/${number}/merge`, {
    method: 'PUT',
    body: { sha: run.head_sha, merge_method: 'squash' },
  })
  if (result.merged !== true) throw new Error('GitHub did not merge the verified PR')
  return { merged: true, number, sha: result.sha }
}

export function githubApi(token, fetcher = fetch) {
  return async (path, { method = 'GET', body } = {}) => {
    if (!path.startsWith('/repos/')) throw new Error('Unexpected API path')
    const response = await fetcher(`https://api.github.com${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2026-03-10',
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
      redirect: 'error',
    })
    if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status}`)
    return response.json()
  }
}

if (process.env.GITHUB_EVENT_NAME === 'workflow_run' && process.env.GITHUB_EVENT_PATH) {
  const { readFile } = await import('node:fs/promises')
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'))
  if (!process.env.GITHUB_TOKEN || !/^[\w.-]+\/[\w.-]+$/.test(process.env.GITHUB_REPOSITORY ?? ''))
    throw new Error('GitHub workflow environment is missing')
  const result = await mergeDependabot({
    api: githubApi(process.env.GITHUB_TOKEN),
    repository: process.env.GITHUB_REPOSITORY,
    runId: event.workflow_run.id,
    dryRun: process.env.AUTOMERGE_DRY_RUN === 'true',
  })
  console.log(JSON.stringify(result))
}
