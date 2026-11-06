# exec-hangars

Star Citizen PYAM executive hangar timer: backend + Windows log helper.

Full backend and logic spec: [docs/SPEC.md](docs/SPEC.md).
Frontend brief (no game knowledge needed): [docs/FRONTEND.md](docs/FRONTEND.md), example responses in [docs/fixtures/](docs/fixtures/).

## How it works

- `src/core/` – pure, tested logic shared by server and helper
  - `cycle.ts` – cycle math (phase, 5 lights, schedule) from a calibration
  - `logParser.ts` – Game.log line → whitelisted events (exec elevator, location, build/shard)
  - `calibration.ts` – combines upstream trackers + elevator close observations
  - `upstream.ts` – parsers for Arkanis `config.json` and xyxyll `app.js`
  - `protocol.ts` – helper → server payload validation
- `src/routes/api/` – `GET /api/time`, `GET /api/state`, `POST /api/events` (Bearer helper token)
- `/admin` – create / revoke per-player helper tokens (password: `ADMIN_TOKEN`)
- `helper/main.ts` – Windows helper: follows Game.log, syncs clock, posts events
- Events are stored raw in `data/events.jsonl` so detection rules can be re-run.

## Run

```
cp .env.example .env        # set ADMIN_TOKEN (and/or HELPER_TOKEN)
bun dev                     # server on :3000
bun test                    # core tests (fixtures from a real 2026-11-06 hangar close)
bun run helper:build        # → dist-helper/exec-hangars-helper.exe
bun run fixtures            # regenerate docs/fixtures (test fails if stale)
```

### Windows helper

Player setup guide: [docs/HELPER.md](docs/HELPER.md) (also attached to every release, and served as the `/helper` page).

Runs without a console window, as a notification-area (tray) icon:

- **Icon colour:** green = reporting, amber = connecting / waiting for Game.log (game not running), red = can't reach the server, grey = paused. Hover for details.
- **Right-click:** open the hangar timer, open the log file, open the settings file, pause reporting, start with Windows, quit. Left-click opens the timer.
- **First run** without a token creates `exec-hangars-helper.json` next to the exe and opens it: fill in `server` and `token`, save, start again.
- Only one copy runs at a time. Logs: `%LOCALAPPDATA%\exec-hangars\helper.log`.
- Settings can also come from flags or env: `--server` / `EXEC_HANGARS_SERVER`, `--token` / `EXEC_HANGARS_TOKEN`, `--log` / `EXEC_HANGARS_LOG`, `--backfill`.
- `bun run helper:build` builds it locally (the custom .exe icon is only embedded when building on Windows).

Dev-only UI previews: `/?fx=<docs/fixtures name>&speed=600` (ignored in production builds).

## Deploy (Docker)

```
cp .env.example .env        # set ADMIN_TOKEN (a long random string)
docker compose up -d --build
```

Then open `/admin`, sign in with `ADMIN_TOKEN`, and create a token per player. Each gets a
ready `exec-hangars-helper.json` to download and send them. Revoking a token (optionally deleting
its reports) cuts off just that player.

- Publishes on `127.0.0.1:3000`, for a reverse proxy in front (nginx + TLS). Set `PORT` in `.env`
  to change the host port, or `BIND=0.0.0.0` to expose it directly.
- Helper events and tokens persist in the `exec-hangars-data` volume (`/data/events.jsonl`, `/data/tokens.json`).
- Without compose: `docker build -t exec-hangars .` then
  `docker run -d -p 3000:3000 -e ADMIN_TOKEN=... -v exec-hangars-data:/data exec-hangars`.
- Keep the host clock NTP-synced: browsers and helpers use the server as their time reference.
- Without Docker: `bun run build && bun run start` (`scripts/serve.ts`).

## Helper releases

`.github/workflows/helper-release.yml` builds `exec-hangars-helper.exe` on every push to `main`
that touches `helper/`, `src/core/` or dependencies (or manually via *Run workflow*), and publishes it
as release `helper-v<N>`, where N increments by one each time. The number is stamped into the exe
(`--define HELPER_VERSION`) and shown in its log. Latest build:
`https://github.com/<owner>/<repo>/releases/latest/download/exec-hangars-helper.exe` (+ `.sha256`).

---

Welcome to your new TanStack Start app!

# Getting Started

To run this application:

```bash
bun install
bun --bun run dev
```

# Building For Production

To build this application for production:

```bash
bun --bun run build
```

## Styling

This project uses [Tailwind CSS](https://tailwindcss.com/) for styling.

### Removing Tailwind CSS

If you prefer not to use Tailwind CSS:

1. Remove the demo pages in `src/routes/demo/`
2. Replace the Tailwind import in `src/styles.css` with your own styles
3. Remove `tailwindcss()` from the plugins array in `vite.config.ts`
4. Remove `@tailwindcss/vite` and `tailwindcss` from `package.json`



## Routing

This project uses [TanStack Router](https://tanstack.com/router) with file-based routing. Routes are managed as files in `src/routes`.

### Adding A Route

To add a new route to your application just add a new file in the `./src/routes` directory.

TanStack will automatically generate the content of the route file for you.

Now that you have two routes you can use a `Link` component to navigate between them.

### Adding Links

To use SPA (Single Page Application) navigation you will need to import the `Link` component from `@tanstack/react-router`.

```tsx
import { Link } from "@tanstack/react-router";
```

Then anywhere in your JSX you can use it like so:

```tsx
<Link to="/about">About</Link>
```

This will create a link that will navigate to the `/about` route.

More information on the `Link` component can be found in the [Link documentation](https://tanstack.com/router/v1/docs/framework/react/api/router/linkComponent).

### Using A Layout

In the File Based Routing setup the layout is located in `src/routes/__root.tsx`. Anything you add to the root route will appear in all the routes. The route content will appear in the JSX where you render `{children}` in the `shellComponent`.

Here is an example layout that includes a header:

```tsx
import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'My App' },
    ],
  }),
  shellComponent: ({ children }) => (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <header>
          <nav>
            <Link to="/">Home</Link>
            <Link to="/about">About</Link>
          </nav>
        </header>
        {children}
        <Scripts />
      </body>
    </html>
  ),
})
```

More information on layouts can be found in the [Layouts documentation](https://tanstack.com/router/latest/docs/framework/react/guide/routing-concepts#layouts).

## Server Functions

TanStack Start provides server functions that allow you to write server-side code that seamlessly integrates with your client components.

```tsx
import { createServerFn } from '@tanstack/react-start'

const getServerTime = createServerFn({
  method: 'GET',
}).handler(async () => {
  return new Date().toISOString()
})

// Use in a component
function MyComponent() {
  const [time, setTime] = useState('')
  
  useEffect(() => {
    getServerTime().then(setTime)
  }, [])
  
  return <div>Server time: {time}</div>
}
```

## API Routes

You can create API routes by using the `server` property in your route definitions:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'

export const Route = createFileRoute('/api/hello')({
  server: {
    handlers: {
      GET: () => json({ message: 'Hello, World!' }),
    },
  },
})
```

## Data Fetching

There are multiple ways to fetch data in your application. You can use TanStack Query to fetch data from a server. But you can also use the `loader` functionality built into TanStack Router to load the data for a route before it's rendered.

For example:

```tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/people')({
  loader: async () => {
    const response = await fetch('https://swapi.dev/api/people')
    return response.json()
  },
  component: PeopleComponent,
})

function PeopleComponent() {
  const data = Route.useLoaderData()
  return (
    <ul>
      {data.results.map((person) => (
        <li key={person.name}>{person.name}</li>
      ))}
    </ul>
  )
}
```

Loaders simplify your data fetching logic dramatically. Check out more information in the [Loader documentation](https://tanstack.com/router/latest/docs/framework/react/guide/data-loading#loader-parameters).



# Learn More

You can learn more about all of the offerings from TanStack in the [TanStack documentation](https://tanstack.com).

For TanStack Start specific documentation, visit [TanStack Start](https://tanstack.com/start).
