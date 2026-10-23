// Starts the local Firestore emulator with its data kept between runs:
// whatever is in emulator-data/ is loaded on start (if it exists yet) and
// written back when the emulator exits (Ctrl+C). emulator-data/ is gitignored
// - it can hold a copy of real team data.
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'

const dir = 'emulator-data'
const args = ['firebase', 'emulators:start', '--only', 'firestore', '--project', 'demo-attendx', `--export-on-exit=${dir}`]
if (existsSync(`${dir}/firebase-export-metadata.json`)) args.push(`--import=${dir}`)

const child = spawn('npx', args, { stdio: 'inherit', shell: true })
child.on('exit', (code) => process.exit(code ?? 0))
