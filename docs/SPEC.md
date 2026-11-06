# exec-hangars: backend & logic spec

Status: backend + Windows helper implemented, no UI yet. Last updated 2026-11-06.

This document defines what the system believes about the PYAM executive hangar
cycle, where each belief comes from, and exactly how the code turns evidence
into a timer. Code is the source of truth for constants; this file explains
them. Section references point at the implementing file.

---

## 1. Domain model: the hangar cycle

Implemented in `src/core/cycle.ts`.

### 1.1 Cycle

A **cycle** starts at the moment the hangar opens (5th light turns green) and
repeats forever with period `P = openMs + closeMs`.

| Phase  | Nominal length | Notes |
|--------|----------------|-------|
| open   | 65 min | Last ~5 min is the **blackout** (all lights off, alarm). Anyone inside at the end is killed. |
| closed | 120 min | "Charging". Compboards cannot be inserted. |

The measured period is slightly longer than the nominal 185 min (e.g.
`3_900_123 + 7_200_227 ms` = 185 min + 350 ms for build 12974691). The excess
varies per server build (observed 350 ms to ~1 s), so phase lengths are always
taken from measurement, never hard-coded. Over a day the excess is ~3 s; over
a month ~1.5 min.

The cycle is **global**: community testing reports it identical across all
servers, shards and regions.

### 1.2 Lights

Five lights. Light-change offsets are the nominal minutes scaled by the
measured phase length: open step = `openMs × 12/65`, closed step =
`closeMs × 24/120`.

| Minutes into cycle (nominal) | Lights | Phase / sub-phase |
|---|---|---|
| 0–12    | G G G G G | open |
| 12–24   | G G G G · | open |
| 24–36   | G G G · · | open |
| 36–48   | G G · · · | open |
| 48–60   | G · · · · | open |
| 60–65   | · · · · · | open / blackout |
| 65–89   | R R R R R | closed / charging |
| 89–113  | G R R R R | closed |
| 113–137 | G G R R R | closed |
| 137–161 | G G G R R | closed |
| 161–185 | G G G G R | closed; 5th green = next cycle opens |

`lights[0]` is the leftmost light. Lights turn green left to right and go
dark right to left (directions confirmed in game, 2026-11-06). The timings
come from community observation (match xyxyll and Arkanis). **Nothing in
Game.log confirms light timings** (see §2.3). Lights are derived from the
cycle boundary, not observed.

### 1.3 Calibration

```ts
type Calibration = { anchorMs: number; openMs: number; closeMs: number }
```

`anchorMs` is the UTC ms of *any* cycle's opening. All state is a pure function
of `(nowMs, Calibration)`:

```
msIntoCycle = ((now − anchor) mod P + P) mod P      // safe for now < anchor
open        = msIntoCycle < openMs
```

`hangarStateAt(now, cal)` returns: `phase`, `subPhase` (`open` | `blackout` |
`charging`), `lights[5]`, `cycleIndex` (relative to anchor; may be negative),
`cycleStartMs`, `msIntoCycle`, `phaseEndsAtMs`, `nextChangeAtMs` (next light
change, close or open).

`schedule(from, until, cal)` lists open/close boundaries in `[from, until)`.

### 1.4 Resets

**Every server build deploy resets the cycle to an arbitrary phase**, including
hotfixes within a patch and server-only deploys that do not change the client
build. Evidence (Arkanis config history, anchor projected across each re-anchor):

| Re-anchor | Phase jump |
|---|---|
| 2026-07-22 → 2026-09-01 | +36.2 min |
| 2026-09-16 → 2026-10-10 | +13.3 min |
| 2026-10-10 → 2026-10-17 | +37.7 min |
| 2026-10-17 → 2026-10-29 | +68.1 min |

Within a build the anchor is stable. Consequence: an anchor is valid only until
the next deploy, and the client log alone cannot detect every deploy (on
2026-10-29 the anchor reset while the client build stayed 12913470).

---

## 2. Evidence: what Game.log contains

Verified against the player's own logs (47 backups + live log). Raw lines are
in `src/core/__fixtures__/exec-close-2026-11-06.log` (sanitised).

### 2.1 Exec hangar elevators

The hangar has **three ship elevators**, all logged under one manager name:

```
LoadingPlatformManager_ShipElevator_HangarMediumFront_Dungeon_Exec_Rund
```

State-change lines (`<CSCLoadingPlatformManager::OnLoadingPlatformStateChanged>
… Platform state changed to <State>`) **do not include the entity ID**, so
individual elevators cannot be told apart.

Observed sequence, 2026-11-06 (UTC):

| Time | State | Meaning |
|---|---|---|
| 06:26:40.371 | OpenIdle, OpenIdle, ClosedIdle | stream-in snapshot (one line per elevator) |
| **06:51:25.602** | LoweringPlatform | **close**: first elevator |
| 06:51:25.669 | LoweringPlatform | second elevator, 67 ms later |
| 06:51:30.074 | (player "Incapacitated") | player inside was killed |
| 06:51:44.546 | ObstructedAtLoadingPlatformLower | (likely the player's body) |
| 06:51:44.629 | ClosingLoadingGate | |
| 06:51:59.889 | ClosedIdle | |
| 06:52:03.481 | OpenIdle | unexplained; *after* the close |

Upstream (Arkanis/xyxyll) predicted that close at **06:51:29.146**. The first
`LoweringPlatform` was 3.544 s earlier.

### 2.2 What is usable

- **First `LoweringPlatform` of a burst** = cycle close, to ~1 s. This is the
  only signal used for calibration.
- **Several elevators lowering together** (within 1 s) = lifecycle event
  rather than a player action (§3.4).
- **Stream-in snapshot (`OpenIdle`/`ClosedIdle`) is NOT a phase indicator.**
  During the open phase it showed two `OpenIdle` and one `ClosedIdle`, and an
  `OpenIdle` appeared after the close. Stored raw, not interpreted.
- Location entry: `<RequestLocationInventory> … Location[AsteroidClusterBase_Pyro_Dungeon_Executive_001b]`.
- Build/environment: `BackupNameAttachment=" Build(<client build>)`,
  `@env_session: '<env>'`, `<Join PU> … shard[<shard>]`.

### 2.3 What is not in the log

- Light changes and blackout: two changes (06:34:28, 06:46:28) produced no
  line while the player was in the hangar.
- The **open** event: not yet observed (needs a player near the hangar at an
  opening).
- Anything about the hangar while the player is far away: the client only logs
  objects streamed in near the player.

---

## 3. Calibration rules

Implemented in `src/core/calibration.ts`.

### 3.1 Constants

| Name | Value | Meaning |
|---|---|---|
| `ELEVATOR_CLOSE_LEAD_MS` | 3 500 | Elevator starts lowering this long before the boundary. **From one sample**; refine with `residualMs`. |
| `CLOSE_CLUSTER_MS` | 60 000 | Lowerings within this window of the previous one belong to one close. |
| `SIMULTANEOUS_MS` | 1 000 | Lowerings within this window of a burst's first one count as "together". |
| `STRONG_ELEVATOR_COUNT` | 2 | Elevators together for an observation to stand on its own. |
| `AGREE_TOLERANCE_MS` | 120 000 | An observed boundary within ±2 min of a predicted close agrees with it. |

### 3.2 Close detection (`detectCloses`)

Input: one helper's elevator events, in server time.

1. Take all `LoweringPlatform` events, sort by time.
2. A lowering more than `CLOSE_CLUSTER_MS` after the previous lowering starts a
   new close observation: `{ atMs, boundaryMs: atMs + LEAD, elevators: 1 }`.
3. A later lowering within `SIMULTANEOUS_MS` of that observation's first one
   increments `elevators`. Later lowerings in the cluster are ignored.

### 3.3 Merging helpers (`mergeCloses`)

Elevator counts are per helper (one player's log). Observations from all
helpers are clustered by `CLOSE_CLUSTER_MS`; each cluster becomes one
observation with the **median** time and the **maximum** elevator count. Counts
are never summed: two players seeing the same single elevator is still 1.

### 3.4 Strong vs weak observations

- **Strong** (`elevators ≥ 2`): the game moved several elevators together. A
  player claiming or storing a ship would move one. Treated as a lifecycle
  close.
- **Weak** (`elevators = 1`): may be a player action. Also what a genuine
  close looks like when only one elevator is raised.

Whether players can move these elevators at all is unknown (§7).

### 3.5 Upstream sources

Ordered by preference; the first one that is available is **primary**:

1. `arkanis`: `config.json` from ArkanisCorporation/Exec-Hangar
2. `xyxyll`: anchor and drift constants parsed from exec.xyxyll.com `app.js` (MIT)

Arkanis mirrors xyxyll (identical anchor to the ms), so they are **not
independent**. A secondary source "agrees" if its close is within
`AGREE_TOLERANCE_MS` of the primary's nearest close.

### 3.6 Algorithm (`buildCalibration`)

```
primary  = first available upstream source (may be none)
phases   = primary's openMs/closeMs, else nominal 65/120 min
relevant = observations with atMs > primary.anchorMs   // older ones may predate a reset
newest   = latest relevant observation

if no newest:
    → 'upstream' (primary calibration)   or 'none' if no primary
if primary and newest agrees with primary:
    → 'verified', re-anchor on newest:  anchor = newest.boundary − openMs
if an earlier relevant observation (> CLOSE_CLUSTER_MS before newest)
   agrees with a model anchored on newest:
    → 'observed' (anchored on newest; upstream looks stale)
if newest is strong:
    → 'observed' (anchored on newest; upstream looks stale)
if no primary:
    → 'conflict' (anchored on newest, unconfirmed)
else:
    → 'conflict' (keep primary; wait for confirmation)
```

Status meanings for the UI:

| Status | Trust | Meaning |
|---|---|---|
| `verified` | high | A fresh elevator observation agrees with upstream. |
| `observed` | high | Observations override upstream, which looks stale (recent deploy). |
| `upstream` | medium | Only the community trackers back the timer. |
| `conflict` | low | The newest observation disagrees and is unconfirmed. Keep showing the timer, with a caution. |
| `none` | none | No data. |

Re-anchoring on a verified observation keeps upstream's phase lengths but uses
the newer local boundary, which has less accumulated period error.

Safety property: a single weak stray lowering can at most cause a temporary
`conflict`. It can never replace an upstream anchor on its own.

---

## 4. Server

TanStack Start server routes, run with `bun dev` (port 3000).

### 4.1 `GET /api/time`

```json
{ "serverTimeMs": 1793948682606 }
```

`cache-control: no-store`. Clock reference for the helper (and later
browsers). Assumes the server clock is NTP-synced.

### 4.2 `GET /api/state`

`cache-control: no-store`. Shape (`HangarReport`, `src/core/report.ts`; assembled by the pure `buildReport`).
`serverTimeMs` is taken after upstream data is loaded, just before responding.

```ts
{
  serverTimeMs: number
  calibration: {
    status: 'verified' | 'upstream' | 'observed' | 'conflict' | 'none'
    calibration: { anchorMs, openMs, closeMs } | null
    basis: 'elevator' | 'arkanis' | 'xyxyll' | null   // where the active anchor came from
    upstream: { id, label, calibration, agreesWithPrimary }[]
    observations: { atMs, elevators, residualMs | null, agrees | null }[]
    notes: string[]                                   // human-readable reasons
  }
  state: HangarState | null          // §1.3
  schedule: { kind: 'open' | 'close', atMs, cycleIndex }[]   // next 24 h
  sources: { id, url, ok, fetchedAt | null, error | null }[]
  helper: { lastEventAt, lastEnv, lastShard, lastClientBuild }  // all nullable
}
```

`residualMs` = observed boundary − nearest close predicted by the primary
upstream source (positive = later). It is the running measurement of
`ELEVATOR_CLOSE_LEAD_MS` error.

### 4.3 `POST /api/events`

Ingest from the helper. Header `Authorization: Bearer <HELPER_TOKEN>`.

```ts
{
  helperId: string        // [\w.-]{1,128}
  helperVersion: string   // ≤ 32 chars
  clockOffsetMs: number   // server − helper clock
  events: LogEvent[]      // ≤ 500; `at` = RAW log time (helper clock)
}
```

| Response | When |
|---|---|
| `200 { accepted, added }` | `accepted` = valid events in batch, `added` = new after dedupe |
| `400` | invalid JSON or batch shape |
| `401` | wrong token |
| `413` | body > 256 KiB |
| `503` | `HELPER_TOKEN` not set on server |

Individual invalid events are dropped silently (not counted in `accepted`).

### 4.4 Event types (`LogEvent`, `src/core/logParser.ts`)

| type | fields | validation (`src/core/protocol.ts`) |
|---|---|---|
| `log_start` | `clientBuild?` | digits, ≤ 12 |
| `env` | `env` | `[\w.-]{1,128}` |
| `join_pu` | `shard` | `[\w.-]{1,128}` |
| `location` | `location` | `'other'` or starts with `AsteroidClusterBase_Pyro_Dungeon_Executive` |
| `elevator_state` | `state`, `dup?` | `state` `\w{1,64}`; `dup` integer 1–99 |

All carry `at` (ms, > 2024-01-01, < now + 1 h).

### 4.5 Storage (`src/server/store.server.ts`)

- Append-only JSONL at `$DATA_DIR/events.jsonl` (default `./data`).
- Each line: `{ event, receivedAt, clockOffsetMs, helperId }`, with the event
  stored **raw** so detection rules can be changed and re-run over history.
- Server time of an event = `event.at + clockOffsetMs`.
- Dedupe key: `helperId + JSON(event)`, i.e. the raw log facts. The corrected
  time is deliberately excluded: the measured offset jitters by a few ms
  between syncs, and resent events must still match.
- A torn last line (crash mid-write) is skipped on load.
- In-memory cache; single-process only.

### 4.6 Upstream polling (`src/server/upstream.server.ts`)

- Fetched on demand when older than 5 min, 10 s timeout, concurrent requests
  share one refresh.
- On failure, the **last good value is kept** (an anchor stays valid until the
  next deploy) and the error is reported in `sources`.
- Parsers reject implausible values: anchor before 2024, or either phase more
  than 60 s from nominal. A format change shows up as "source unavailable",
  never as a wrong timer.

### 4.7 Configuration

| Env | Default | |
|---|---|---|
| `HELPER_TOKEN` | (none) | Required for ingest. `.env` is git-ignored; see `.env.example`. |
| `DATA_DIR` | `./data` | Event store location. |

---

## 5. Windows helper

`helper/main.ts`, built with `bun run helper:build` →
`dist-helper/exec-hangars-helper.exe` (bun-windows-x64, ~110 MB, unsigned).

### 5.1 Config

First match wins: CLI flag → env var → `exec-hangars-helper.json` next to the exe.

| Flag | Env | JSON key | Default |
|---|---|---|---|
| `--server` | `EXEC_HANGARS_SERVER` | `server` | `http://localhost:3000` |
| `--token` | `EXEC_HANGARS_TOKEN` | `token` | (required) |
| `--log` | `EXEC_HANGARS_LOG` | `log` | `C:\Program Files\Roberts Space Industries\StarCitizen\LIVE\Game.log` |
| `--backfill` | | `backfill: true` | off |

### 5.2 Reading Game.log

- Polls every 1 s: `stat`, read the first 128 bytes, read `[offset, size)`.
  Polling, not change notifications, which are unreliable for a file another
  process holds open, and fail completely through WSL.
- **Rotation** (game relaunch replaces Game.log): detected when the file
  shrinks or its first 64 bytes change. Reading restarts at 0 with fresh
  decoder, line buffer and dup counter.
- Streaming `TextDecoder` keeps multi-byte UTF-8 split across reads intact;
  `LineBuffer` holds a partial last line until its newline arrives.
- On startup the current Game.log is read from the beginning (server dedupe
  makes this safe).
- `--backfill`: also parses every `logbackups\*.log` once.
- Read-only. Never touches the game process; nothing for Easy Anti-Cheat to
  see.

### 5.3 Privacy filter

Only the event types in §4.4 are produced. Non-exec locations become
`'other'`, and `'other'` is only sent when leaving an exec location. Player
names, IPs, session IDs, chat and everything else in the log never leave the
PC.

### 5.4 Duplicate numbering (`DupCounter`)

Several elevators can log the same state in the same ms. Within one log file,
the n-th identical `(at, state)` elevator line gets `dup: n` (first has none).
Deterministic per file, so re-reads produce identical events and dedupe still
works. A fresh counter is used per file.

### 5.5 Clock sync

- 5 × `GET /api/time`; offset = `server − (t0 + t1)/2` from the lowest-RTT
  sample.
- Re-synced every 10 min; retried every 15 s until the first success.
- **Events are held until the first sync succeeds** so nothing is sent without
  a usable offset.
- Backfilled old logs use the current offset (approximate; old events rarely
  matter because of the `relevant` filter in §3.6).

### 5.6 Sending

- Every 2 s, up to 500 events per POST; on failure the batch stays queued and
  is retried.
- Queue capped at 10 000 events (oldest dropped).
- `401` → exit with an error (wrong token).
- `helperId` = first 16 hex of `sha256("exec-hangars:" + hostname)`.

---

## 6. Testing

`bun test`, `src/core/core.test.ts`. Fixtures in `src/core/__fixtures__/`:

- `exec-close-2026-11-06.log`: real, sanitised log lines from the observed close
- `arkanis-config.json`, `xyxyll-app.js`: upstream snapshots (2026-11-06)

Covered: light table, state/next-change, negative elapsed, schedule, the
Arkanis prediction of the real close, parser extraction and masking, partial
lines, dup numbering and validation, close clustering and elevator counting,
cross-helper merge, every calibration status path, upstream parsers and
garbage rejection.

`bun run typecheck` for types.

---

## 7. Open questions

| Question | How to resolve |
|---|---|
| What does the elevator log at **open**? | Be near the hangar at an opening (~120 min after a close); look at the stored raw `elevator_state` events. |
| Is the 3.5 s lead constant? | Watch `residualMs` across more closes; adjust `ELEVATOR_CLOSE_LEAD_MS`. |
| Can players move these elevators (ship claim/store)? | Claim or store a ship at the hangar during open; compare its sequence with a close. |
| Do light timings ever change? | Only visible in game; occasional manual check. |
| Detecting server-only deploys | Partly covered: a strong close that disagrees → `observed`. Could also watch the Arkanis commit feed. |
| Production deployment | Nitro with the bun preset; its latest release is a fresh RC, so deferred. |
| Multi-user | Single shared token for now; a per-helper token or account is needed before others run the helper. |
