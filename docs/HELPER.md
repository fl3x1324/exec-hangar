# Exec Hangar helper: setup guide

The helper is a small Windows program that watches your Star Citizen game log
while you play. When the executive hangar closes near you, it reports the exact
moment to the Exec Hangar timer, so the timer stays accurate for everyone, even
right after a game patch resets the cycle.

It runs quietly as an icon in the notification area (bottom-right of the
taskbar). It never touches the game itself.

## 1. Download

Get **exec-hangars-helper.exe** from the latest release:

- Direct download: https://github.com/fl3x1324/exec-hangar/releases/latest/download/exec-hangars-helper.exe
- All releases: https://github.com/fl3x1324/exec-hangar/releases

Put it in a folder of its own, for example `Documents\Exec Hangar helper`.
The helper keeps its settings file next to the .exe, so avoid `Downloads` (gets
cleaned up) and `Program Files` (not writable).

Optional: each release also has `exec-hangars-helper.exe.sha256`. To check
your download, run this in PowerShell in that folder and compare the result:

```
Get-FileHash .\exec-hangars-helper.exe -Algorithm SHA256
```

## 2. First start

Double-click the .exe.

Windows may show **"Windows protected your PC"** because the program is not
code-signed. Click **More info**, then **Run anyway**. You only need to do this
once per version.

On the first start the helper creates **exec-hangars-helper.json** next to the
.exe, tells you what to fill in, and opens it.

## 3. Fill in the settings

```json
{
  "server": "https://your-timer-site.example",
  "token": "paste-the-token-here",
  "log": "C:\\Program Files\\Roberts Space Industries\\StarCitizen\\LIVE\\Game.log"
}
```

- **server**: the address of the timer website you use (the same address you
  open in your browser). The site's *Helper* page shows it with a copy button,
  and can download this file with the address already filled in.
- **token**: your personal token, from whoever runs the timer site. They can
  also send you a ready `exec-hangars-helper.json` with everything filled in:
  then just put it next to the .exe (replacing the one the helper created) and
  skip this step. Keep your token to yourself.
- **log**: only change this if Star Citizen is installed somewhere else. Point
  it at `Game.log` inside your `StarCitizen\LIVE` folder. Use double
  backslashes (`\\`) in the path.

Save the file and start the helper again.

## 4. Check it works

Look for the round icon in the notification area. If you don't see it, click the
**^** arrow next to the clock (you can drag the icon out onto the taskbar to keep
it visible).

| Icon | Meaning |
|---|---|
| Green | Connected and watching the game log. All good. |
| Amber | Connecting, or waiting for the game: `Game.log` doesn't exist yet, so start Star Citizen. |
| Red | Can't reach the timer server. It keeps retrying. Check the `server` address and your internet. |
| Grey | Paused by you. |

Hover over the icon for details. Left-click opens the timer.

## 5. Start with Windows (optional)

Right-click the icon and tick **Start with Windows**. The helper then starts
when you sign in, so you never have to remember it.

## The menu

Right-click the icon:

- **Open hangar timer**: the timer website.
- **Open log file**: what the helper has been doing (useful when something's
  wrong).
- **Open settings file**: edit `exec-hangars-helper.json`. Quit and start the
  helper again afterwards to apply changes.
- **Pause reporting**: stop reading the game log. Anything that happens while
  paused is skipped, not sent later.
- **Start with Windows**: on/off.
- **Quit**.

## Troubleshooting

- **"The server rejected the token"**: the token is wrong, or the site admin
  revoked it. Ask them for a new one, update the settings file, start again.
- **"The helper is already running"**: it's already in the notification area
  (check behind the **^** arrow). Only one copy runs at a time.
- **Stuck on amber while playing**: the `log` path is wrong. In the RSI
  Launcher, check where Star Citizen is installed and point `log` at
  `...\StarCitizen\LIVE\Game.log`.
- **Red**: the `server` address is wrong, the site is down, or a firewall blocks
  the helper. Open the address in your browser to check.
- **Anything else**: right-click → **Open log file**. The log lives at
  `%LOCALAPPDATA%\exec-hangars\helper.log`.

## Privacy: what it reads and sends

The helper only **reads** `Game.log`, the text log Star Citizen writes anyway.
It never reads or changes game memory or files, and never sends keystrokes.

From that log it picks out only these lines and sends them, with their times,
to the timer server you configured:

- executive hangar elevator movements (this is how the closing time is measured)
- entering or leaving the executive hangar (other locations are never sent)
- the game version, server build and server (shard) ID, to tell game patches
  and servers apart

It also sends an anonymous helper ID (a scrambled code derived from your
computer's name, so the server can tell helpers apart without knowing who you
are), its version, and how far your PC clock is off.

It does **not** send your player name, chat, other locations, or anything else
from the log.

## Uninstall

1. Right-click the icon and untick **Start with Windows** (if you ticked it).
2. Click **Quit**.
3. Delete the helper's folder, and optionally `%LOCALAPPDATA%\exec-hangars`
   (its log file).
