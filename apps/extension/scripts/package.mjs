import { readFile, mkdir, copyFile, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
const { version } = JSON.parse(await readFile('package.json', 'utf8'))
await mkdir('release', { recursive: true })
await copyFile('README.md', 'dist/README.txt')
const destination = resolve(`release/doggynote-clipper-${version}.zip`)
await rm(destination, { force: true })
execFileSync('zip', ['-qr', destination, '.'], { cwd: 'dist' })
console.log(destination)
