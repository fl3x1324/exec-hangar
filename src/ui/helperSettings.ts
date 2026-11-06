import { DEFAULT_GAME_LOG } from './links'

/** Contents of exec-hangars-helper.json, as the helper reads it. */
export function helperSettingsJson(server: string, token: string): string {
  return `${JSON.stringify({ server, token, log: DEFAULT_GAME_LOG }, null, 2)}\n`
}

/** Save text as a file in the browser. */
export function downloadText(filename: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const SETTINGS_FILENAME = 'exec-hangars-helper.json'
