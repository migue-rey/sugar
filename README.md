# Hardware System Designer

Web application for high-level hardware block diagrams. It includes a reusable versioned block library, typed ports, YAML editing, project history, team roles, English/Spanish and light/dark themes. The Vue interface uses Tailwind CSS for utilities and component styling, with a small amount of custom CSS for the diagram canvas. The application is independent from Antmicro's Visual System Designer.

## Start

From this directory, run:

```sh
docker compose up --build -d
```

Open [http://localhost:8088](http://localhost:8088). The first boot creates `admin@local` with a random password. Read it once with `docker compose logs api`, sign in, and change it in **Settings**. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env` before first boot if you prefer fixed initial credentials. `.env.example` lists all options. Set `APP_PORT` if port 8088 is occupied.

The same Compose file starts the web frontend, API and PostgreSQL. Data is kept in the `postgres_data` Docker volume across restarts and rebuilds. Back up that volume before moving or upgrading an installation. For access outside a trusted local network, serve the app through HTTPS and set a strong `DB_PASSWORD` in `.env` before the first boot.

## Working with diagrams

- **Projects:** create or import a YAML diagram. Add blocks by clicking `+` or dragging from the library; connect their ports, edit selected block fields, and save a revision with a summary. The right panel shows properties, YAML and history. The navigation sidebar and the block palette can each be hidden with their buttons to give the canvas more space.
- **Library:** edit a block definition in YAML. Every save creates an immutable version. Existing projects contain the selected version's snapshot, so they do not change until someone updates an instance deliberately. A block can show an identifying image from an HTTPS URL or a PNG/JPEG/WebP upload up to 1 MB. Uploaded images are embedded in YAML so exports remain portable.
- **History:** compare two revisions with a text diff, or restore one as a new revision. Concurrent edits return a conflict instead of overwriting changes.
- **Export:** project YAML includes its block snapshots and is portable. SVG and PNG exports capture the current canvas viewport.

Example block:

```yaml
name: Temperature sensor
function: Measure ambient temperature
model: BME280
# Optional: HTTPS image URL or an embedded data:image/... value from the upload control.
image: https://example.com/bme280.png
properties:
  range: -40..85 °C
ports:
  - id: i2c
    label: I²C
    protocol: I2C
    direction: bidirectional
    maxConnections: 1
  - id: power
    label: Power
    protocol: POWER
    direction: in
    maxConnections: 1
```

Ports support `I2C`, `SPI`, `UART`, `GPIO`, and `POWER`; directions are `in`, `out`, and `bidirectional`. The server validates protocol, direction, port existence and connection limits. The YAML editor accepts an unfinished draft but will not apply or save it until validation succeeds.

## Roles

| Role | Permissions |
| --- | --- |
| `view` | View projects, blocks, revisions and export diagrams. |
| `dev` | Create and edit projects and block definitions; remove nodes and edges inside a diagram. |
| `Admin` | All `dev` actions, plus account management and deletion of projects and library blocks. |

An administrator creates user accounts. Deleted users are deactivated so revision authorship remains available. Deleting a project or library block hides it from the app while retaining its history in PostgreSQL.

## Optional GitHub synchronization

Create and install a GitHub App with repository **Contents: Read and write** permission. Put its app ID, installation ID and private key in `.env` as `GITHUB_APP_ID`, `GITHUB_INSTALLATION_ID`, and `GITHUB_PRIVATE_KEY`; encode private-key newlines as literal `\n`. Restart Compose, then an `Admin` sets the owner, repository and branch in **Settings**.

The API queues each project revision or block version as a separate YAML file under `projects/<id>/revision-<n>.yaml` or `blocks/<id>/version-<n>.yaml`. A background loop sends it and retries with backoff after errors. The app works without GitHub; pending revisions remain in PostgreSQL. Synchronization only publishes outward. Changes made in GitHub must be imported explicitly. GitHub is an audit copy, so deleting a record in the app does not erase already published history from the repository.

## Development and tests

The `web/` directory contains Vue 3, TypeScript, Vue Flow and Tailwind CSS. The `api/` directory contains Express, YAML validation and PostgreSQL access. Run `npm test` in `api/` and `npm run build` in `web/` to check the main logic and production frontend. `docker compose up --build -d` also builds both images and starts the complete system.
