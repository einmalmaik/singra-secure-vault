# Repository Guidelines

Es Muss alles immer in Mehere sprachen schnell erweiterbar sein unter /src/i18

Nutze immer MCP server wie Perplexty:ask um neuste Informationen aus dem Web zu holen

Codiere immer Auf ein hohen sicherheitsmaß und hinterfrage auch deine änderungen

Achte drauf jede änderungen zu Dokumentieren in einer .md datei 

## Project Structure & Module Organization
Application code lives in `src/` and follows a feature-oriented split:
- `src/pages/` for route-level screens (`Landing.tsx`, `VaultPage.tsx`).
- `src/components/` for reusable UI (`ui/` for shadcn primitives, `vault/`, `landing/`, `settings/` for domain components).
- `src/contexts/`, `src/hooks/`, and `src/services/` for state, reusable logic, and crypto/business logic.
- `src/integrations/supabase/` for Supabase client/types.
- `src/test/` for test setup and test files.
Static assets are in `public/`. Supabase SQL migrations are in `supabase/migrations/`.

## Build, Test, and Development Commands
- `npm i`: install dependencies.
- `npm run dev`: start Vite dev server with hot reload.
- `npm run build`: production bundle to `dist/`.
- `npm run build:dev`: build with development mode flags.
- `npm run preview`: serve the built app locally.
- `npm run lint`: run ESLint for `ts/tsx`.
- `npm run test`: run Vitest once in CI mode.
- `npm run test:watch`: run Vitest in watch mode.

## Coding Style & Naming Conventions
Use TypeScript + React function components with 2-space indentation and semicolons (match existing files). Prefer:
- `PascalCase` for components/pages (`VaultItemCard.tsx`).
- `camelCase` for hooks/services/utilities (`use-toast.ts`, `cryptoService.ts`).
- Path alias `@/*` for imports from `src`.
Linting is configured in `eslint.config.js` (`react-hooks`, `react-refresh`, TypeScript ESLint). Run `npm run lint` before opening a PR.

## Testing Guidelines
Testing uses Vitest + Testing Library in `jsdom` (`vitest.config.ts`, `src/test/setup.ts`). Name tests `*.test.ts` or `*.spec.ts` under `src/` (for example: `src/components/vault/VaultItemCard.test.tsx`). Cover new logic in services/hooks and critical UI flows. Run `npm run test` before pushing.

## Commit & Pull Request Guidelines
Recent history favors short, direct commit subjects (for example: `localhost redirect fix`, `Package log fix`). Use imperative, specific messages and avoid placeholders like `...`.
For PRs, include:
- Clear summary of behavioral changes.
- Linked issue/task when available.
- Screenshots or short video for UI changes.
- Notes for env or migration changes (`env.example`, `supabase/migrations/`).

## Security & Configuration Tips
Never commit secrets. Copy `env.example` to a local `.env` and set `VITE_SUPABASE_*` values. Treat crypto/auth changes as high risk: add tests and document any migration or key-handling impact in the PR.
