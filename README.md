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

- **Projects:** create or import a YAML diagram. Add blocks by clicking `+` or dragging from the library; connect their ports, select a connection and drag its green control point to route it around other lines, edit selected block fields, and save a revision with a summary. The right panel shows properties, YAML and history. On wide screens, use the YAML width slider to resize the right panel. The navigation sidebar and the block palette can each be hidden with their buttons to give the canvas more space.
- **Project settings:** each project records its creator and starts private. Its creator or an `Admin` can switch it to public, select a GitHub repository (`owner/repo`) and branch, and copy a read-only sharing link. Public projects are visible to everyone with the link; private projects are visible to their creator and admins, while a private sharing link grants read-only access to its holder. Private links can be revoked. Settings changes are recorded separately from YAML revisions.
- **Library:** edit a block definition in YAML. Use **Expand editor** to hide the block list and give the YAML the available width. Validation errors stay visible at the top of the screen and beside the editor. Every save creates an immutable version. Existing projects contain the selected version's snapshot, so they do not change until someone updates an instance deliberately. A block can show an identifying image from an HTTPS URL or a gallery URL. Upload PNG, JPEG or WebP images (up to 1 MB) in **Image gallery**, copy the URL, then paste it into a block image field. YAML stores only the URL. Gallery images are stored in PostgreSQL and included in the Compose volume backup. If the URL stops working, assign another image URL.
- **Image gallery:** `dev` and `Admin` can upload images; everyone can browse and copy their URLs. Only `Admin` can delete images. Deleting an image leaves existing block URLs in place, so they can be reassigned.
- **History:** compare two revisions with a text diff, or restore one as a new revision. Concurrent edits return a conflict instead of overwriting changes.
- **Export:** project YAML includes its block snapshots. Gallery image URLs resolve on the same installation; for use elsewhere, replace those URLs or host the images at stable HTTPS addresses. SVG and PNG exports capture the current canvas viewport.

Example block:

```yaml
name: Temperature sensor
function: Measure ambient temperature
model: BME280
# Optional: HTTPS image URL or a URL copied from the gallery.
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

A port can use any non-empty protocol text, such as `I2C`, `CSI`, `LVDS`, or `PAC`. Two ports connect when their protocol text matches after trimming outer whitespace; matching is case-sensitive. Directions are `in`, `out`, and `bidirectional`. The server also validates direction, port existence and connection limits. The YAML editor accepts an unfinished draft but will not apply or save it until validation succeeds.

## Roles

| Role | Permissions |
| --- | --- |
| `view` | View projects, blocks, revisions and export diagrams. |
| `dev` | Create and edit projects and block definitions; remove nodes and edges inside a diagram. |
| `Admin` | All `dev` actions, plus account management and deletion of projects and library blocks. |

An administrator creates user accounts. Deleted users are deactivated so revision authorship remains available. Deleting a project or library block hides it from the app while retaining its history in PostgreSQL.

## Optional GitHub synchronization

Create and install a GitHub App with repository **Contents: Read and write** permission. Put its app ID, installation ID and private key in `.env` as `GITHUB_APP_ID`, `GITHUB_INSTALLATION_ID`, and `GITHUB_PRIVATE_KEY`; encode private-key newlines as literal `\n`. Restart Compose, then set the repository and branch in each project's **Settings**. An `Admin` may also set a global repository in application **Settings** for shared library blocks.

The API queues each project revision or block version as a separate YAML file under `projects/<id>/revision-<n>.yaml` or `blocks/<id>/version-<n>.yaml`. Projects are queued only after their own repository is configured; the current revision is queued when a repository is first selected. A background loop sends jobs to their selected repository and retries with backoff after errors. The app works without GitHub; pending revisions remain in PostgreSQL. Synchronization only publishes outward. Changes made in GitHub must be imported explicitly. GitHub is an audit copy, so deleting a record in the app does not erase already published history from the repository. Check the destination repository's visibility before syncing a private project.

## Development and tests

The `web/` directory contains Vue 3, TypeScript, Vue Flow and Tailwind CSS. The `api/` directory contains Express, YAML validation and PostgreSQL access. Run `npm test` in `api/` and `npm run build` in `web/` to check the main logic and production frontend. `docker compose up --build -d` also builds both images and starts the complete system.
