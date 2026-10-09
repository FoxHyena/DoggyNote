// Create a DoggyNote user directly in D1.
//
//   pnpm --filter server create-user <username> <password> [--admin] [--remote] [--persist-to <dir>]
//
// Local by default (wrangler's local D1). Pass --remote for the deployed database.
import { execFileSync } from 'node:child_process'
import { hashPassword } from '../src/crypto.ts'

const args = process.argv.slice(2)
const flag = (f: string) => args.includes(f)
const opt = (f: string) => {
  const i = args.indexOf(f)
  return i >= 0 ? args[i + 1] : undefined
}
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--persist-to'))
const [username, password] = positional

if (!username || !password || !/^[a-zA-Z0-9_.-]{2,32}$/.test(username) || password.length < 8) {
  console.error('usage: create-user <username> <password (8+ chars)> [--admin] [--remote] [--persist-to <dir>]')
  process.exit(1)
}

const hash = await hashPassword(password)
const sql = `INSERT INTO users (id, username, pw_hash, is_admin, created_at) VALUES ('${crypto.randomUUID()}', '${username}', '${hash}', ${flag('--admin') ? 1 : 0}, ${Date.now()}) ON CONFLICT(username) DO UPDATE SET pw_hash = excluded.pw_hash, is_admin = excluded.is_admin;`
const target = flag('--remote') ? ['--remote'] : ['--local', ...(opt('--persist-to') ? ['--persist-to', opt('--persist-to')!] : [])]
execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'doggynote', ...target, '--command', sql], { stdio: ['ignore', 'ignore', 'inherit'] })
console.log(`✓ ${username}${flag('--admin') ? ' (admin)' : ''} ready ${flag('--remote') ? 'on the deployed database' : 'locally'}`)
