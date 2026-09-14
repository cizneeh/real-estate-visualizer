import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { loadEnvironment } from '../server/environment'

test('local env files preserve existing environment values and parse quoted values', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'price-env-'))
  const existing = 'PRICE_ENV_TEST_EXISTING'
  const quoted = 'PRICE_ENV_TEST_QUOTED'
  const before = { existing: process.env[existing], quoted: process.env[quoted] }
  t.after(() => {
    for (const [key, value] of [
      [existing, before.existing],
      [quoted, before.quoted],
    ] as const) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    rmSync(directory, { recursive: true, force: true })
  })
  process.env[existing] = 'from-shell'
  delete process.env[quoted]
  const path = join(directory, '.env')
  writeFileSync(path, `${existing}=from-file\n${quoted}="value with # and spaces"\n`)
  loadEnvironment(path)
  assert.equal(process.env[existing], 'from-shell')
  assert.equal(process.env[quoted], 'value with # and spaces')
})

test('a missing env file is optional but other read errors are not hidden', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'price-env-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  assert.doesNotThrow(() => loadEnvironment(join(directory, 'missing.env')))
  assert.throws(() => loadEnvironment(directory))
})
