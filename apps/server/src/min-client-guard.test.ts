import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Runs the release guard script with a fake curl. No network access.
const mockCurl = `#!/bin/sh
echo "$@" >> "$MOCK_LOG"
[ -n "$MOCK_CURL_FAIL" ] && exit 22
printf '%s' "$MOCK_BODY"
`

const fixtures: string[] = []
afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const realToml = readFileSync(fileURLToPath(new URL('../wrangler.toml', import.meta.url)), 'utf8')
const tomlMin = realToml.match(/^MIN_CLIENT = "([^"]+)"/m)![1]

function guard(env: Record<string, string>, toml = realToml) {
  const root = mkdtempSync(join(tmpdir(), 'doggynote-guard-test-'))
  fixtures.push(root)
  mkdirSync(join(root, 'scripts'))
  mkdirSync(join(root, 'bin'))
  cpSync(fileURLToPath(new URL('../scripts/min-client-guard.sh', import.meta.url)), join(root, 'scripts/min-client-guard.sh'))
  writeFileSync(join(root, 'wrangler.toml'), toml)
  writeFileSync(join(root, 'bin/curl'), mockCurl, { mode: 0o755 })
  const log = join(root, 'curl.log')
  writeFileSync(log, '')
  const result = spawnSync('sh', [join(root, 'scripts/min-client-guard.sh')], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, MOCK_LOG: log, MOCK_BODY: '', MOCK_CURL_FAIL: '', ...env },
  })
  return { result, curlArgs: readFileSync(log, 'utf8') }
}

const live = (minClient: unknown) => JSON.stringify({ version: '0.4.10', minClient })

describe('MIN_CLIENT release guard', () => {
  it('deploys without waiting when the live MIN_CLIENT matches wrangler.toml', () => {
    const { result, curlArgs } = guard({ MOCK_BODY: live(tomlMin) })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim()).toBe('wait_for_desktop=false')
    expect(curlArgs).toContain('https://notepad.dog/api/version')
  })

  it('waits for the Mac build when MIN_CLIENT changes', () => {
    const { result } = guard({ MOCK_BODY: live('0.0.1') })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim()).toBe('wait_for_desktop=true')
    expect(result.stderr).toContain(`from 0.0.1 to ${tomlMin}`)
  })

  it.each([
    ['the request fails', { MOCK_CURL_FAIL: '1' }],
    ['the body is not JSON', { MOCK_BODY: '<html>oops</html>' }],
    ['minClient is missing', { MOCK_BODY: JSON.stringify({ version: '0.4.10' }) }],
    ['minClient is not a version', { MOCK_BODY: live('latest') }],
  ])('waits for the Mac build when %s', (_, env) => {
    const { result } = guard(env)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim()).toBe('wait_for_desktop=true')
  })

  it('reads the live value from PUBLIC_URL', () => {
    const { curlArgs } = guard({ MOCK_BODY: live(tomlMin), PUBLIC_URL: 'https://example.invalid' })
    expect(curlArgs).toContain('https://example.invalid/api/version')
  })

  it.each([
    ['missing', realToml.replace(/^MIN_CLIENT = .*$/m, '')],
    ['not a version', realToml.replace(/^MIN_CLIENT = .*$/m, 'MIN_CLIENT = "soon"')],
    ['duplicated', `${realToml}\nMIN_CLIENT = "9.9.9"\n`],
  ])('fails the release when MIN_CLIENT in wrangler.toml is %s', (_, toml) => {
    const { result } = guard({ MOCK_BODY: live(tomlMin) }, toml)
    expect(result.status).not.toBe(0)
    expect(result.stdout).not.toContain('wait_for_desktop')
  })
})
