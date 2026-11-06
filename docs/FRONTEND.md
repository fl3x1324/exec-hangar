# exec-hangars: frontend brief

For a frontend developer with **no Star Citizen knowledge**. Explains what the
UI is for, what it must communicate, and how to use the data correctly. Visual
design is deliberately not specified here.

Backend internals: [SPEC.md](SPEC.md). Example API responses: [fixtures/](fixtures/).

---

## 1. The game in two minutes

Star Citizen is an online space game. In one of its star systems (Pyro) there
is a space station, **PYAM-EXHANG-0-1**, called the **executive hangar**: a
vault full of valuable loot (ships, gear).

The vault is on a **fixed global timer**, the same for every player in the
world:

- **Closed** for ~2 hours. Nobody can get in.
- **Open** for ~1 hour. Players who bring the right keys can open the door
  and loot.
- Then it closes again. **Anyone still inside when it closes is killed.**

To get in, players first collect seven key items (**compboards**) from other
dangerous locations, which takes time, then fly to the hangar. So players
plan around the timer: *"When does it open next? Do I have time to get there?
How long until it closes?"* That is the whole purpose of this app.

Above the hangar door is a row of **five lights** that show the timer
progress in game. Players recognise this pattern, so the UI should mirror it.

## 2. Glossary

| Term | Meaning |
|---|---|
| Executive hangar / "exec hangar" / PYAM | The timed vault. |
| Open / online | The vault can be entered (~65 min). |
| Closed / offline / charging | The vault cannot be entered (~120 min). |
| Blackout | Last ~5 min of the open phase: all lights off, alarm. Leave now. |
| Compboard | Key item needed to open the door. Only usable while open. Not tracked by this app. |
| Cycle | One open + closed period (~3 h 05 min). Repeats forever. |
| Patch / deploy | Game server update. **Resets the timer to an unknown point**, so it must be re-measured. |
| Upstream | Community websites that also track the timer; one of our data sources. |
| Helper | Small Windows program that reads a player's game log and reports exact hangar events to our server. |
| Elevator | Ship elevator inside the hangar. Its log entries tell us exactly when the hangar closed. |

## 3. What the UI must answer, in priority order

1. **Is it open or closed right now?**
2. **How long until that changes?** (live countdown)
3. **The five lights**, as players see them in game.
4. **Is it the dangerous end of the open phase?** (blackout; see §6)
5. **Upcoming windows** in the user's local time, e.g. "Opens 14:51, closes 15:56". Players plan sessions hours ahead.
6. **How much to trust the timer** (§5). Usually a quiet indicator; prominent only when it is in doubt.
7. Source and helper details: secondary, for curious or technical users.

## 4. Data and time handling

### 4.1 Endpoints

| Endpoint | Use |
|---|---|
| `GET /api/state` | Everything: calibration, current state, 24 h schedule, sources. Shape: `HangarReport` in `src/core/report.ts`. |
| `GET /api/time` | `{ serverTimeMs }`. Fast; use it for clock correction. |

Both are same-origin and `no-store`. For SSR, don't fetch your own API from a
route loader: call `getHangarReport()` (`src/server/hangar.server.ts`) through
a `createServerFn`, per TanStack Start guidance.

### 4.2 Run the clock locally; don't poll it

The timer is pure math over one calibration. **Import the same code the
server uses** (`src/core/cycle.ts` is dependency-free and browser-safe):

```ts
import { hangarStateAt, schedule } from '#/core/cycle'

// 1) Clock correction: the user's PC clock may be off by seconds or minutes.
const t0 = Date.now()
const { serverTimeMs } = await (await fetch('/api/time')).json()
const t1 = Date.now()
const offsetMs = serverTimeMs - (t0 + t1) / 2
const now = () => Date.now() + offsetMs

// 2) Calibration from /api/state (refresh occasionally, see below).
const cal = report.calibration.calibration   // null when status === 'none'

// 3) Every tick (e.g. 1 s, or requestAnimationFrame for smooth countdowns):
const s = hangarStateAt(now(), cal)
// s.phase, s.subPhase, s.lights, s.phaseEndsAtMs, s.nextChangeAtMs
const upcoming = schedule(now(), now() + 12 * 3_600_000, cal)
```

Rules:

- **Always compute from absolute time** (`now()`). Never decrement a counter
  in `setInterval`: browsers throttle timers in background tabs and the count
  drifts.
- Re-tick immediately on `visibilitychange` → visible.
- `/api/time` is the cheapest clock reference. `report.serverTimeMs` also
  works (it is taken just before the response is sent) if you'd rather do
  one request.
- Re-measure the offset occasionally (e.g. every 10 min) and on visibility.

### 4.3 Refreshing `/api/state`

The calibration changes rarely (on a game deploy, or when a helper reports a
close). Poll every **60 s** and on tab focus. When the calibration changes,
the countdown may jump by a few seconds (re-anchoring on a fresher
measurement) or, after a game deploy, by up to an hour. Both are expected.

`report.schedule` covers 24 h from the server's `now`. For a long-open page,
compute the schedule locally with `schedule()` instead of relying on it.

### 4.4 Field reference

`state` (`HangarState`):

| Field | UI meaning |
|---|---|
| `phase` | `'open'` / `'closed'`: the headline. |
| `subPhase` | `'open'`, `'blackout'` (open but about to close; danger), `'charging'` (closed). |
| `lights` | 5 × `'green' \| 'red' \| 'off'`. See §6. |
| `phaseEndsAtMs` | Target of the main countdown: closes at (if open) / opens at (if closed). |
| `nextChangeAtMs` | When the lights next change (≤ 24 min away). Optional secondary countdown. |
| `cycleStartMs`, `msIntoCycle`, `cycleIndex` | For progress bars or timelines. `cycleIndex` is relative to an internal anchor; don't show it. |

`schedule`: `{ kind: 'open' | 'close', atMs }[]`, alternating, sorted. Show in
local time (`Intl.DateTimeFormat`), with relative time ("in 2 h 14 min").

`calibration`: see §5. `sources`, `helper`: see §7.

All times are **UTC epoch ms**. Display in the user's local time zone. A UTC
toggle helps players coordinating across countries.

## 5. Trust: `calibration.status`

The timer is only as good as its latest measurement, and game deploys reset
it without warning. Communicate this proportionately:

| Status | What happened | Suggested tone |
|---|---|---|
| `verified` | A player's game log recently confirmed the timer. | Best case. Quiet confirmation ("Confirmed by in-game data"). |
| `upstream` | Based on community trackers only. Normal day-to-day state. | Neutral. No alarm. |
| `observed` | In-game data contradicts the community trackers, which are probably stale after a game update. Our timer follows the in-game data. | Confident, with a short note ("Updated from in-game data; other trackers may be outdated"). |
| `conflict` | One unconfirmed in-game report disagrees. Timer still shows the community value. | Visible caution: "may be off, waiting for confirmation". Keep showing the timer. |
| `none` | No data at all. | Hide the countdown and lights; explain that no timer data is available. |

`calibration.notes` holds human-readable reasons (English). Fine for a
details/tooltip view; not intended as headline copy.

`calibration.basis` = where the current anchor came from (`'elevator'` =
in-game data, or a source id). `observations` lists in-game close reports
with `residualMs` (difference from the community prediction); that's
technical detail only.

## 6. Lights and danger

- `lights[0]` is the **leftmost** light in game. Render left → right.
- While **closed**, lights turn green one by one **left to right**:
  `G R R R R` → `G G R R R` → …
- While **open**, lights go dark one by one **right to left**:
  `G G G G ·` → `G G G · ·` → …
- Both directions are confirmed in game. Still render from `lights` rather
  than hard-coding the pattern.
- Colours carry the meaning: green = progress, red = not yet, off = gone.
  Match the game's plain green/red/dark rather than inventing new semantics,
  and don't rely on colour alone (shape/label for colour-blind users).
- **Blackout (`subPhase === 'blackout'`) is the danger state**: all lights
  off, ~5 min left, and anyone inside at the end dies. It should feel
  different from a normal state, not just "lights off".
- Approaching close in general (last ~12 min of open) deserves rising emphasis.

## 7. Secondary data

`sources[]`: per upstream tracker, `ok`, `fetchedAt`, `error`. One source down
while another works changes nothing for the user. Only surface it in a
details view.

`helper`: last data received from any player's game (`lastEventAt`), plus
game build/shard identifiers. Technical; details view only. Not "your" data:
in future several players' helpers may report.

## 8. Edge cases checklist

- `status === 'none'` → `state` and `calibration.calibration` are `null`, `schedule` is `[]`.
- Phase boundary crossed while the page is open → just keep ticking; `hangarStateAt` handles it.
- Calibration jumps (re-anchor or deploy) → animate or just update; never assume monotonic countdowns across refreshes.
- Tab in background for hours → recompute on visibility; refetch state and clock offset.
- Network failure on refresh → keep the last calibration and keep ticking; show a subtle "offline" hint. The anchor stays valid until the next game deploy.
- User clock badly wrong → handled by the offset; never show `Date.now()`-based times directly.
- Countdown formatting: up to ~2 h for closed, ~65 min for open. Use h:mm:ss.

## 9. Fixtures

`docs/fixtures/*.json` are real `HangarReport` responses for fixed moments,
generated by `bun run fixtures` and checked by the test suite, so they always
match the code.

| File | Status | Phase | Shows |
|---|---|---|---|
| `verified-closed.json` | verified | closed | Normal confirmed state, 1 green light |
| `verified-open.json` | verified | open | 4 green, 1 off |
| `verified-blackout.json` | verified | open / blackout | Danger state, all off |
| `upstream.json` | upstream | closed | No in-game data |
| `upstream-one-source-down.json` | upstream | closed | One source erroring |
| `observed.json` | observed | closed | In-game data overrides stale trackers |
| `conflict.json` | conflict | closed | Unconfirmed disagreement |
| `none.json` | none | none | No data at all |

To build against them, serve a fixture in place of `/api/state`, and freeze
`now()` to the fixture's `serverTimeMs` to see the exact state it describes.

## 10. Not decided yet (design discussion)

- Notifications (browser push / sound before open or close)
- Download/setup page for the Windows helper
- Branding, layout, mobile vs desktop priority
- Language/localisation
