/**
 * Builds the Windows helper: a single .exe with no console window (it lives in
 * the notification area). On a Windows host it also embeds the icon and file
 * details, which Bun only supports when compiling on Windows.
 *
 *   bun scripts/build-helper.ts [version]      → dist-helper/exec-hangars-helper.exe
 */
import { $ } from 'bun'

const version = process.argv[2] ?? 'dev'
const out = 'dist-helper/exec-hangars-helper.exe'
const flags = ['--compile', '--target=bun-windows-x64', '--windows-hide-console', `--define=HELPER_VERSION=${JSON.stringify(version)}`]

if (process.platform === 'win32') {
  await $`bun scripts/helper-icon.ts dist-helper/icon.ico`
  const numeric = /^\d+$/.test(version) ? `1.0.0.${version}` : '0.0.0.0'
  flags.push(
    '--windows-icon=dist-helper/icon.ico',
    '--windows-title=Exec Hangar helper',
    '--windows-description=Exec Hangar helper',
    `--windows-version=${numeric}`,
  )
} else {
  console.log('note: not on Windows, so the .exe gets the default icon (Bun limitation)')
}

await $`bun build helper/main.ts ${flags} --outfile ${out}`
console.log(`built ${out} (version ${version})`)
