/** GitHub repository that publishes the helper releases. */
export const REPO = 'fl3x1324/exec-hangar'
export const RELEASES_URL = `https://github.com/${REPO}/releases`
/** Always the newest helper build (release assets keep a stable name). */
export const HELPER_DOWNLOAD_URL = `${RELEASES_URL}/latest/download/exec-hangars-helper.exe`
export const HELPER_SHA256_URL = `${HELPER_DOWNLOAD_URL}.sha256`
export const HELPER_GUIDE_URL = `https://github.com/${REPO}/blob/main/docs/HELPER.md`
export const DEFAULT_GAME_LOG = 'C:\\Program Files\\Roberts Space Industries\\StarCitizen\\LIVE\\Game.log'
