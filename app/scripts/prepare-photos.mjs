// Compatibility entry point. Generated PNG sources are no longer runtime inputs.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const repository = fileURLToPath(new URL('../../', import.meta.url))
const localPython = path.join(repository, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python')
const python = existsSync(localPython) ? localPython : 'python'
const result = spawnSync(python, ['scripts/prepare_licensed_photos.py', ...process.argv.slice(2).filter(argument => argument !== '--require-complete')], { cwd: repository, stdio: 'inherit' })
if (result.error) throw result.error
process.exit(result.status ?? 1)
