# Repository Guidelines

## Project Structure & Module Organization

- `web/src/`: Vue 3/TypeScript components, Vue Flow diagrams, styles, and Spanish/English strings in `i18n.ts`. Static assets live in `web/public/`; frontend tests in `web/tests/`.
- `api/src/`: Express ES modules grouped by feature. Keep HTTP adapters in `routes.js`, business rules in `service.js`, and PostgreSQL queries in `repository.js`. Reuse existing categories, images, AI, and GitHub helpers.
- `api/src/app.js` composes the application without starting listeners or workers; `server.js` owns startup. Backend tests are colocated as `*.test.js`; provider mocks live in `api/test-support/`.
- `deploy/` contains production Compose, Nginx, and deployment scripts. See `api/README.md` for architecture and `.github/workflows/deploy.yml` for CI.

## Build, Test, and Development Commands

Use Node.js 22 and run `npm ci` separately in `api/` and `web/`.

- `docker compose up --build -d`: rebuild and run the local stack at `http://localhost:8088`, preserving database volumes. Checkout changes alone do not update running containers.
- `docker compose ps` and `curl -fsS http://localhost:8088/api/health`: verify local health.
- `cd api && npm start`: start the API with configured PostgreSQL.
- `cd api && npm test`: run backend tests.
- `cd web && npm run dev`: start Vite development mode.
- `cd web && npm test && npm run build`: run frontend tests, TypeScript checks, and production compilation.

## Coding Style & Naming Conventions

Follow existing two-space indentation, single quotes, and omitted semicolons. Use PascalCase Vue components, camelCase functions, and descriptive feature directories. Keep dependencies explicit and services independent of Express request/response objects. Pass the same transaction query function through revisions, image migration, and synchronization writes. No dedicated formatter or lint script is configured.

## Testing Guidelines

Both packages use Node’s built-in test runner. Name frontend tests `*.test.mjs`. Cover permissions, visibility, conflicts, and rollback when changing backend behavior; no numeric coverage threshold is configured. Integration variables (`AI_TEST_URL`, `ICON_TEST_URL`, `API_TEST_URL`, `API_TEST_DATABASE_URL`) must target disposable installations; see `api/README.md`. Use mocked DeepSeek responses. Verify UI flows in-browser; provide screenshots only when requested.

## Commit & Pull Request Guidelines

Make every requested change on a development branch, such as `dev/issue-1-api-modules`. Never merge or push changes to `main`, or deploy production, without the user’s explicit production-release instruction: pushes to `main` automatically publish and deploy. Development workflow runs only test. Use concise imperative commit subjects. PRs should explain behavior, link issues, and report validation.

## Security & Configuration

Keep `.env`, credentials, encryption keys, and database dumps out of Git. Preserve existing data and API contracts. Never use production for integration tests.
