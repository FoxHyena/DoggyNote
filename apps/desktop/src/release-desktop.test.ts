import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Exercise the real packaging shell script with fake Apple services. No signing
// identities, network access or production artifacts are used by these tests.
const mockTool = `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const tool = path.basename(process.argv[1])
const args = process.argv.slice(2)
fs.appendFileSync(process.env.MOCK_LOG, JSON.stringify([tool, ...args]) + '\\n')
const target = args.at(-1)
const ticket = p => p.endsWith('.app') ? path.join(p, 'Contents', 'notarization-ticket') : p + '.ticket'
if (tool === 'codesign') {
  if (args.includes('--force') && target.endsWith('.app')) {
    if (!args.includes('runtime') || !args.includes('--timestamp')) process.exit(1)
  }
  if (args.includes('-R') && process.env.MOCK_BAD_TEAM) process.exit(1)
} else if (tool === 'ditto') {
  fs.writeFileSync(target, 'zip placeholder')
} else if (tool === 'xcrun') {
  if (args[0] === 'notarytool') {
    if (args[1] === 'submit') {
      const kind = args[2].endsWith('.zip') ? 'app' : 'dmg'
      console.log(JSON.stringify({ id: kind + '-submission', status: process.env.MOCK_REJECT === kind ? 'Invalid' : 'Accepted' }))
      if (process.env.MOCK_SUBMIT_ERROR) process.exit(1)
    } else {
      console.log('Apple diagnostic log')
    }
  } else if (args[1] === 'staple') {
    fs.writeFileSync(ticket(target), 'Apple ticket')
  } else if (!fs.existsSync(ticket(target)) || process.env.MOCK_INVALID_TICKET) {
    process.exit(1)
  }
} else if (tool === 'spctl') {
  if (!fs.existsSync(ticket(target)) || process.env.MOCK_GATEKEEPER_FAIL) process.exit(1)
} else if (tool === 'pnpm') {
  fs.writeFileSync(target + '.sig', crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex'))
} else if (tool === 'hdiutil') {
  const stage = args[args.indexOf('-srcfolder') + 1]
  if (!fs.existsSync(ticket(path.join(stage, 'DoggyNote.app')))) process.exit(1)
  if (fs.readlinkSync(path.join(stage, 'Applications')) !== '/Applications') process.exit(1)
  fs.writeFileSync(target, 'DMG containing stapled app')
}
`

const fixtures: string[] = []
afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function release(overrides: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'doggynote-release-test-'))
  fixtures.push(root)
  const scripts = join(root, 'scripts')
  const bin = join(root, 'bin')
  const app = join(root, 'src-tauri/target/release/bundle/macos/DoggyNote.app')
  mkdirSync(scripts)
  mkdirSync(bin)
  mkdirSync(join(root, 'work'))
  mkdirSync(join(app, 'Contents/MacOS'), { recursive: true })
  writeFileSync(join(app, 'Contents/MacOS/DoggyNote'), 'app executable')
  cpSync(fileURLToPath(new URL('../scripts/release-desktop.sh', import.meta.url)), join(scripts, 'release-desktop.sh'))
  writeFileSync(join(bin, 'mock.cjs'), mockTool, { mode: 0o755 })
  for (const tool of ['codesign', 'ditto', 'xcrun', 'spctl', 'pnpm', 'hdiutil']) {
    symlinkSync(join(bin, 'mock.cjs'), join(bin, tool))
  }
  const log = join(root, 'calls.jsonl')
  const result = spawnSync('sh', [join(scripts, 'release-desktop.sh')], {
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      TMPDIR: join(root, 'work'),
      MOCK_LOG: log,
      VERSION: '0.4.123',
      SIGN_KEYCHAIN: '/test/signing.keychain-db',
      SIGN_IDENTITY: 'test-fingerprint',
      APPLE_ID: 'test@example.invalid',
      APPLE_PASSWORD: 'test-app-specific-password',
      APPLE_TEAM_ID: 'TESTTEAM01',
      TAURI_SIGNING_PRIVATE_KEY: 'test-updater-key',
      ...overrides,
    },
  })
  const calls: string[][] = existsSync(log)
    ? readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line))
    : []
  return { root, result, calls, manifest: join(root, 'release/latest.json') }
}

describe('desktop release packaging', () => {
  it('ships a stapled app in the updater and notarizes the DMG before creating the manifest', () => {
    const { root, result, calls, manifest } = release()
    expect(result.status, result.stderr).toBe(0)
    const archive = join(root, 'release/0.4.123/DoggyNote.app.tar.gz')
    const listing = spawnSync('tar', ['-tzf', archive], { encoding: 'utf8' })
    expect(listing.status).toBe(0)
    expect(listing.stdout).toContain('DoggyNote.app/Contents/notarization-ticket')
    const metadata = JSON.parse(readFileSync(manifest, 'utf8'))
    const platform = Object.values(metadata.platforms)[0] as { signature: string; url: string }
    expect(metadata.version).toBe('0.4.123')
    expect(platform.signature).toBe(createHash('sha256').update(readFileSync(archive)).digest('hex'))
    expect(platform.url).toBe('https://notepad.dog/api/desktop/files/0.4.123/DoggyNote.app.tar.gz')
    expect(existsSync(join(root, 'release/0.4.123', metadata.dmg))).toBe(true)
    expect(calls.filter(call => call[0] === 'xcrun' && call[2] === 'submit')).toHaveLength(2)
    expect(calls.filter(call => call[0] === 'spctl')).toHaveLength(2)
  })

  it.each(['app', 'dmg'])('stops publication and prints diagnostics when Apple rejects the %s', kind => {
    const { result, calls, manifest } = release({ MOCK_REJECT: kind })
    expect(result.status).not.toBe(0)
    expect(existsSync(manifest)).toBe(false)
    expect(result.stdout).toContain('Apple diagnostic log')
    expect(result.stderr).toContain('release stopped')
    expect(calls.some(call => call[0] === 'xcrun' && call[2] === 'log' && call[3] === `${kind}-submission`)).toBe(true)
    if (kind === 'app') expect(calls.some(call => call[0] === 'pnpm')).toBe(false)
  })

  it.each(['MOCK_SUBMIT_ERROR', 'MOCK_BAD_TEAM', 'MOCK_INVALID_TICKET', 'MOCK_GATEKEEPER_FAIL'])('blocks publication when %s occurs', failure => {
    const { result, manifest } = release({ [failure]: '1' })
    expect(result.status).not.toBe(0)
    expect(existsSync(manifest)).toBe(false)
  })

  it('requires notarization credentials before attempting signing', () => {
    const { result, calls, manifest } = release({ APPLE_PASSWORD: '' })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('APPLE_PASSWORD is required')
    expect(calls).toEqual([])
    expect(existsSync(manifest)).toBe(false)
  })
})
