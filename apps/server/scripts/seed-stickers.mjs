// Test-only D1/R2 seed. No runtime fixture bypass exists in the Worker.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
const dir = process.argv[2]
if (!dir) throw new Error('Pass the isolated E2E persistence directory')
const assets = fileURLToPath(new URL('../../web/e2e/fixtures/stickers/', import.meta.url))
const stickers = Array.from({ length: 12 }, (_, i) => ({ assetId: `57a1c000-0000-4000-8000-${String(i).padStart(12, '0')}`, stickerId: `fixture_${i}`, packName: 'DoggyFixture', emoji: ['🐶','🐾','🦴'][i % 3], width: 256, height: 256, format: i === 1 ? 'tgs' : i === 2 ? 'webm' : 'static', available: true, keywords: ['dog', 'puppy', 'happy', `fixture ${i}`] }))
const pack = { name: 'DoggyFixture', title: 'Doggy daydreams', stickers }
const quote = (s) => `'${String(s).replaceAll("'", "''")}'`
const sql = [`INSERT INTO sticker_packs(name,title,manifest,upstream,updated_at) VALUES('doggyfixture',${quote(pack.title)},${quote(JSON.stringify(pack))},'[]',1);`]
const run = (args) => execFileSync('pnpm', ['exec', 'wrangler', ...args], { stdio: 'pipe' })
for (let i = 0; i < stickers.length; i++) {
  const id = stickers[i].assetId, file = join(assets, `${i}.png`)
  run(['r2', 'object', 'put', `doggynote-assets/${id}/thumb`, '--file', file, '--content-type', 'image/png', '--local', '--persist-to', dir])
  sql.push(`INSERT INTO assets(id,size,mime,bytes,created_by,created_at) SELECT '${id}','thumb','image/png',${readFileSync(file).length},id,1 FROM users WHERE username='rex';`)
  if (i === 1 || i === 2) {
    const full = i === 1 ? 'animation.json' : 'animation.webm', mime = i === 1 ? 'application/json' : 'video/webm'
    run(['r2', 'object', 'put', `doggynote-assets/${id}/full`, '--file', join(assets, full), '--content-type', mime, '--local', '--persist-to', dir])
    sql.push(`INSERT INTO assets(id,size,mime,bytes,created_by,created_at) SELECT '${id}','full','${mime}',${readFileSync(join(assets, full)).length},id,1 FROM users WHERE username='rex';`)
  }
}
// A second, fully prepared pack with a short name unlike its title, for multi-pack suggestions.
const parade = Array.from({ length: 6 }, (_, i) => ({ assetId: `57a1c000-0000-4000-8001-${String(i).padStart(12, '0')}`, stickerId: `parade_${i}`, packName: 'PuppyParade42x', emoji: '🐕', width: 256, height: 256, format: 'static', available: true, keywords: ['parade'] }))
sql.push(`INSERT INTO sticker_packs(name,title,manifest,upstream,updated_at) VALUES('puppyparade42x','Puppy parade',${quote(JSON.stringify({ name: 'PuppyParade42x', title: 'Puppy parade', stickers: parade }))},'[]',1);`)
for (let i = 0; i < parade.length; i++) {
  const id = parade[i].assetId, file = join(assets, `${i + 3}.png`)
  run(['r2', 'object', 'put', `doggynote-assets/${id}/thumb`, '--file', file, '--content-type', 'image/png', '--local', '--persist-to', dir])
  sql.push(`INSERT INTO assets(id,size,mime,bytes,created_by,created_at) SELECT '${id}','thumb','image/png',${readFileSync(file).length},id,1 FROM users WHERE username='rex';`)
}
const path = join(dir, 'stickers.sql')
writeFileSync(path, sql.join('\n'))
run(['d1', 'execute', 'doggynote', '--local', '--persist-to', dir, '--file', path])
