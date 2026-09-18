# Lumen — AI, always on

Lumen is a full-stack AI chat assistant: a streaming chat UI for ideas, code, writing, and planning, backed by user accounts, per-user chat history, a rank/leaderboard system, and an admin panel for moderation.

## Main Motive

Lumen aims to be a quiet, capable, always-available AI assistant that:
- Streams conversational answers (text, code, math via LaTeX, and image/file understanding).
- Persists chat threads per authenticated user, with auto-generated thread titles.
- Gamifies engagement with user ranks, badges, and a leaderboard.
- Gives admins moderation tools (an admin panel and a suspension gate to restrict flagged accounts).
- Adds useful side utilities such as a calculator and a location-aware weather panel.

## Tech Stack

**Frontend**
- [React 19](https://react.dev/) + [TanStack Start](https://tanstack.com/start) (file-based routing via TanStack Router, SSR)
- [Vite 7](https://vitejs.dev/) as the build tool/dev server
- [Tailwind CSS 4](https://tailwindcss.com/) for styling
- [Radix UI](https://www.radix-ui.com/) primitives + a `shadcn/ui`-style component layer (`src/components/ui`)
- [Vercel AI SDK](https://sdk.vercel.ai/) (`ai`, `@ai-sdk/react`, `@ai-sdk/openai-compatible`) for streaming chat completions
- `react-markdown`, `streamdown`, `remark-gfm`/`remark-math`, `rehype-katex`, `katex` for rich markdown + LaTeX rendering
- `recharts`, `motion` (Framer Motion), `embla-carousel-react`, `react-hook-form` + `zod` for charts, animation, carousels, and form validation
- `jspdf`, `pptxgenjs` for exporting content to PDF/PPTX

**Backend / Infrastructure**
- [Supabase](https://supabase.com/) for auth, database, and migrations (`supabase/migrations`)
- [Cloudflare Workers](https://workers.cloudflare.com/) as the deployment target, via `@cloudflare/vite-plugin` and `wrangler`
- TanStack Start server routes (`src/routes/api`) for server-side handlers (`/api/chat`, `/api/title`, `/api/weather`)

**Tooling**
- [Bun](https://bun.sh/) as the package manager/runtime (`bun.lock`, `bunfig.toml`)
- TypeScript, ESLint, Prettier

## Project Structure

```
src/
  components/
    ui/           # shadcn/ui-style base components
    lumen/         # app-specific: sidebar, chat window, admin panel, leaderboard, etc.
    ai-elements/   # chat/message/prompt-input building blocks
  hooks/           # auth, language, and other React hooks
  integrations/
    supabase/      # Supabase client setup
  lib/             # shared utilities (e.g. thread storage)
  routes/          # TanStack Router file-based routes
    api/           # server route handlers (chat, title, weather)
supabase/
  migrations/      # SQL migrations for the Supabase database
```

## Prerequisites

- [Bun](https://bun.sh/) installed (`curl -fsSL https://bun.sh/install | bash`)
- A [Supabase](https://supabase.com/) project (URL + publishable key)

## Installation

```bash
# Clone the repo
git clone <repo-url>
cd clair-vision-core

# Install dependencies
bun install
```

## Environment Variables

Create a `.env` file in the repo root with:

```bash
SUPABASE_PROJECT_ID=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_URL=

VITE_SUPABASE_PROJECT_ID=
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_SUPABASE_URL=

# Optional: Google Maps-backed weather panel
VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY=
VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID=
```

> Never commit real `.env` values — keep secrets local or in your deployment provider's secret store.

## Running Locally

```bash
# Start the dev server
bun run dev
```

The app will be available at the URL printed in the terminal (default Vite dev port).

## Other Scripts

```bash
bun run build       # Production build
bun run build:dev   # Development-mode build
bun run preview     # Preview the production build locally
bun run lint         # Run ESLint
bun run format       # Format the codebase with Prettier
```

## Database

Supabase migrations live in `supabase/migrations`. Apply them to your Supabase project using the [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase db push
```

## Deployment

This project is configured to deploy to Cloudflare Workers via `wrangler.jsonc` and `@cloudflare/vite-plugin`. After building, deploy with the Wrangler CLI:

```bash
bunx wrangler deploy
```
