import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  actionReferencesOnly,
  dependencyOnlyManifest,
  githubApi,
  mergeDependabot,
} from './dependabot-automerge.mjs'

const repository = 'example/price-map'
const head = 'a'.repeat(40)
const base = 'b'.repeat(40)
const passed = { status: 'completed', conclusion: 'success' }
const encoded = (text) => ({
  type: 'file',
  encoding: 'base64',
  content: Buffer.from(text).toString('base64'),
})

function fixture() {
  const run = {
    ...passed,
    event: 'pull_request',
    path: '.github/workflows/ci.yml',
    actor: { login: 'dependabot[bot]' },
    head_repository: { full_name: repository },
    head_sha: head,
    head_branch: 'dependabot/npm_and_yarn/hono-5.0.0',
    workflow_id: 7,
    run_attempt: 1,
    check_suite_id: 12,
  }
  const pr = {
    number: 23,
    state: 'open',
    draft: false,
    merged: false,
    user: { login: 'dependabot[bot]' },
    head: { sha: head, ref: run.head_branch, repo: { full_name: repository } },
    base: { ref: 'main', repo: { full_name: repository } },
    mergeable: true,
    mergeable_state: 'clean',
    labels: [],
    changed_files: 2,
  }
  const steps = {
    Quality: ['Install dependencies', 'Lint and types', 'Unit tests', 'Build', 'Worker bundle'],
    'Browser smoke': ['Install dependencies', 'Build', 'Install Chromium', 'Browser smoke'],
  }
  const jobs = Object.entries(steps).map(([name, names]) => ({
    ...passed,
    name,
    head_sha: head,
    steps: names.map((name) => ({ ...passed, name })),
  }))
  const checks = jobs.map(({ name }) => ({
    ...passed,
    name,
    app: { slug: 'github-actions' },
    check_suite: { id: 12 },
  }))
  const before = JSON.stringify({
    scripts: { test: 'node --test' },
    dependencies: { hono: '^4.0.0' },
  })
  const after = JSON.stringify({
    scripts: { test: 'node --test' },
    dependencies: { hono: '^5.0.0' },
  })
  const data = {
    '/actions/runs/42': run,
    '/actions/workflows/ci.yml': { id: 7, path: run.path },
    [`/commits/${head}/pulls`]: [{ number: 23, state: 'open', head: { sha: head } }],
    '/pulls/23': pr,
    '/git/ref/heads/main': { object: { sha: base } },
    [`/compare/${base}...${head}`]: {
      status: 'ahead',
      behind_by: 0,
      merge_base_commit: { sha: base },
    },
    '/actions/runs/42/attempts/1/jobs': { jobs },
    [`/commits/${head}/check-runs`]: { check_runs: checks },
    [`/commits/${head}/statuses`]: [],
    '/pulls/23/reviews': [],
    '/pulls/23/files': [
      { filename: 'package.json', status: 'modified' },
      { filename: 'package-lock.json', status: 'modified' },
    ],
  }
  const writes = []
  const reads = new Map()
  const state = { data, run, pr, jobs, checks, writes, before, after, onRead: undefined }
  state.api = async (path, options = {}) => {
    assert.ok(path.startsWith(`/repos/${repository}/`))
    const suffix = path.slice(`/repos/${repository}`.length)
    const key = suffix.split('?')[0]
    if (options.method && options.method !== 'GET') {
      writes.push({ path: key, ...options })
      return { merged: true, sha: 'c'.repeat(40) }
    }
    reads.set(key, (reads.get(key) ?? 0) + 1)
    state.onRead?.(key, reads.get(key))
    if (key.startsWith('/contents/'))
      return encoded(suffix.endsWith(base) ? state.before : state.after)
    assert.ok(Object.hasOwn(data, key), `Unexpected API read: ${key}`)
    return structuredClone(data[key])
  }
  return state
}

test('a major update merges only the SHA whose full CI succeeded', async () => {
  const state = fixture()
  const result = await mergeDependabot({ api: state.api, repository, runId: 42 })
  assert.equal(result.merged, true)
  assert.deepEqual(state.writes, [
    { path: '/pulls/23/merge', method: 'PUT', body: { sha: head, merge_method: 'squash' } },
  ])
})

test('dry-run performs verification without any writes', async () => {
  const state = fixture()
  const result = await mergeDependabot({ api: state.api, repository, runId: 42, dryRun: true })
  assert.equal(result.eligible, true)
  assert.deepEqual(state.writes, [])
})

const rejected = {
  'missing labels': (s) => {
    delete s.pr.labels
  },
  'missing draft state': (s) => {
    delete s.pr.draft
  },
  'human author': (s) => {
    s.pr.user.login = 'human'
  },
  'human workflow actor': (s) => {
    s.run.actor.login = 'human'
  },
  'forked PR': (s) => {
    s.pr.head.repo.full_name = 'attacker/fork'
  },
  'forked workflow': (s) => {
    s.run.head_repository.full_name = 'attacker/fork'
  },
  'different base branch': (s) => {
    s.pr.base.ref = 'other'
  },
  'draft PR': (s) => {
    s.pr.draft = true
  },
  'hold label': (s) => {
    s.pr.labels.push({ name: 'do-not-merge' })
  },
  'unknown mergeability': (s) => {
    delete s.pr.mergeable
  },
  conflict: (s) => {
    s.pr.mergeable_state = 'dirty'
  },
  'changed head': (s) => {
    s.pr.head.sha = 'd'.repeat(40)
  },
  'wrong workflow path': (s) => {
    s.run.path = '.github/workflows/fake.yml'
  },
  'wrong workflow ID': (s) => {
    s.run.workflow_id = 9
  },
  'wrong event': (s) => {
    s.run.event = 'push'
  },
  'failed run': (s) => {
    s.run.conclusion = 'failure'
  },
  'old main': (s) => {
    s.data[`/compare/${base}...${head}`].behind_by = 1
  },
  'unrelated history': (s) => {
    s.data[`/compare/${base}...${head}`].merge_base_commit.sha = 'd'.repeat(40)
  },
  'missing browser job': (s) => {
    s.jobs.pop()
  },
  'skipped browser job': (s) => {
    s.jobs[1].conclusion = 'skipped'
  },
  'skipped test step': (s) => {
    s.jobs[0].steps[2].conclusion = 'skipped'
  },
  'job tested another SHA': (s) => {
    s.jobs[0].head_sha = 'e'.repeat(40)
  },
  'check from another suite': (s) => {
    s.checks[0].check_suite.id = 99
  },
  'check from another app': (s) => {
    s.checks[0].app.slug = 'fake'
  },
  'pending extra check': (s) => {
    s.checks.push({ status: 'in_progress', name: 'extra' })
  },
  'failed commit status': (s) => {
    s.data[`/commits/${head}/statuses`] = [{ context: 'external', state: 'failure' }]
  },
  'requested changes': (s) => {
    s.data['/pulls/23/reviews'] = [{ user: { id: 1 }, state: 'CHANGES_REQUESTED' }]
  },
  'unexpected code file': (s) => {
    s.data['/pulls/23/files'][0].filename = 'src/App.tsx'
  },
  'renamed file': (s) => {
    s.data['/pulls/23/files'][0].status = 'renamed'
  },
  'incomplete diff': (s) => {
    s.pr.changed_files = 3
  },
  'test command modification': (s) => {
    s.after = s.after.replace('node --test', 'echo ok')
  },
  'ambiguous PR': (s) => {
    s.data[`/commits/${head}/pulls`].push({ number: 24, state: 'open', head: { sha: head } })
  },
  'main changes during verification': (s) => {
    s.onRead = (key, count) => {
      if (key === '/git/ref/heads/main' && count === 2) s.data[key].object.sha = 'd'.repeat(40)
    }
  },
  'PR changes during verification': (s) => {
    s.onRead = (key, count) => {
      if (key === '/pulls/23' && count === 2) s.pr.head.sha = 'd'.repeat(40)
    }
  },
  'CI is rerun during verification': (s) => {
    s.onRead = (key, count) => {
      if (key === '/actions/runs/42' && count === 2) s.run.run_attempt++
    }
  },
}
for (const [name, change] of Object.entries(rejected)) {
  test(`does not merge: ${name}`, async () => {
    const state = fixture()
    change(state)
    const result = await mergeDependabot({ api: state.api, repository, runId: 42 })
    assert.equal(result.merged, false)
    assert.deepEqual(state.writes, [])
  })
}

test('manifest updates cannot change scripts, package names, or dependency sources', () => {
  const before = JSON.stringify({
    scripts: { test: 'node --test' },
    dependencies: { hono: '^4.0.0' },
  })
  for (const dependencies of [
    { extra: '^1.0.0' },
    {},
    { hono: 'file:../other' },
    { hono: 'https://example.com/package.tgz' },
  ])
    assert.equal(
      dependencyOnlyManifest(
        before,
        JSON.stringify({ scripts: { test: 'node --test' }, dependencies }),
      ),
      false,
    )
  assert.equal(dependencyOnlyManifest(before, before.replace('^4.0.0', '^5.0.0')), true)
})

test('action updates permit pinned reference changes and reject workflow logic changes', async () => {
  const before = `steps:\n  - uses: actions/checkout@${base} # v7.0.0\n    with:\n      persist-credentials: false\n`
  const after = before.replace(base, head).replace('v7.0.0', 'v8.0.0')
  assert.equal(actionReferencesOnly(before, after), true)
  for (const changed of [
    after.replace('false', 'true'),
    after.replace('actions/checkout', 'attacker/checkout'),
    after.replace(head, 'v8'),
    `${after}  - run: echo injected\n`,
  ])
    assert.equal(actionReferencesOnly(before, changed), false)
  const state = fixture()
  state.pr.changed_files = 1
  state.data['/pulls/23/files'] = [{ filename: '.github/workflows/ci.yml', status: 'modified' }]
  state.before = before
  state.after = after
  assert.equal((await mergeDependabot({ api: state.api, repository, runId: 42 })).merged, true)
})

test('API errors and a server-side head race fail without retrying a merge', async () => {
  const state = fixture()
  let writes = 0
  const api = async (path, options) => {
    if (options?.method === 'PUT') {
      writes++
      throw new Error('HTTP 409: head changed')
    }
    return state.api(path, options)
  }
  await assert.rejects(mergeDependabot({ api, repository, runId: 42 }), /409/)
  assert.equal(writes, 1)
  await assert.rejects(
    mergeDependabot({
      api: async () => {
        throw new Error('API unavailable')
      },
      repository,
      runId: 42,
    }),
    /API unavailable/,
  )
})

test('HTTP client uses bounded requests and never follows credential redirects', async () => {
  const api = githubApi('test-token', async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/example/test')
    assert.equal(options.redirect, 'error')
    assert.ok(options.signal instanceof AbortSignal)
    return { ok: false, status: 403 }
  })
  await assert.rejects(api('/repos/example/test'), /403/)
  await assert.rejects(api('https://attacker.invalid'), /Unexpected API path/)
})
