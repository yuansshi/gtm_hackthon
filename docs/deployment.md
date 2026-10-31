# Deploying the portal

The portal needs a single persistent Node.js 24 service and a writable volume. Static hosting cannot run SQLite, native Kuzu, the server policy layer or background workers. Public hosting is not configured yet; the project hosting target is pending. The container workflow tests an isolated synthetic campaign, not live integrations or customer evidence.

## Local container or a host with Docker

From the project directory, create a separate deployment configuration. This command writes a random project token without printing it and refuses to overwrite an existing file:

```sh
node --input-type=module -e "import {randomBytes} from 'node:crypto'; import {writeFileSync} from 'node:fs'; writeFileSync('.env.deploy','PROJECT_ACCESS_TOKEN='+randomBytes(32).toString('hex')+'\nPUBLIC_ORIGIN=http://127.0.0.1:3001\n',{flag:'wx',mode:0o600});"
docker compose --env-file .env.deploy config --quiet
docker compose --env-file .env.deploy up -d --build
curl --fail http://127.0.0.1:3001/healthz
```

Open `http://127.0.0.1:3001`. Read your local `.env.deploy` privately to enter its project token in the portal. It grants access to both business workspaces; it is not a per-user or per-tenant login. The Docker image contains no `.env` files, runtime workspace data, tests or deployment fixture scripts. Compose forwards only the designated project token and browser origin; optional provider credentials are not inherited from the host. All live integrations stay disabled in this initial deployment.

Compose binds the published port to the host’s loopback interface. To host publicly, put this service behind the selected platform’s HTTPS ingress and set `PUBLIC_ORIGIN` to the exact browser origin, such as `https://your-project.example`. The runtime normalizes a root trailing slash, rejects credentials/path/query/fragment, and requires HTTPS except for loopback origins. Network binding requires a project token of at least 32 characters without surrounding whitespace and an explicit origin. HTTPS configuration adds `Secure` to the HttpOnly/SameSite session cookie even when TLS terminates at the ingress; the app does not trust arbitrary forwarded headers. Restart after configuration changes; existing in-memory sessions expire on restart.

The image listens on `PORT` (3001 by default) and stores both databases in `DATA_DIR` (`/data` in the container). A host that supplies its own persistent disk should mount it there with write access for the image’s `node` user, UID 1000. Run one application instance per volume; SQLite/Kuzu are embedded stores, not a shared multi-instance database service. Compose’s named `portal-data` volume is initialized with the image directory’s ownership.

## Health and shutdown

`GET /healthz` returns only `{"status":"ok"}` without authentication. It reads no workspace state, performs no graph query, invokes no provider and consumes no credits. The listener starts after SQLite and Kuzu initialize. This is process/startup readiness, not an ongoing database-integrity, external-provider or deliverability check. Workspace APIs still require a session and CSRF validation.

The image’s healthcheck uses Node’s built-in HTTP client against loopback, so curl is not needed inside the image. SIGTERM stops new HTTP connections, waits for active HTTP requests, stops source/billing/Band workers and closes the native graph and SQLite before exiting. Compose allows 90 seconds for shutdown. An eventual forced stop can still interrupt work; recovery preserves existing unknown-delivery rules and never automatically resends outreach.

## Persistence and updates

```sh
docker compose --env-file .env.deploy stop
docker compose --env-file .env.deploy cp portal:/data/. ../gtm-data-backup/
docker compose --env-file .env.deploy up -d --build
```

Keep backups private and outside the source repository. Copy the complete data directory while stopped, including SQLite and Kuzu files; copying a live database file is not a consistent backup. Check backup contents before relying on it. Do not use `docker compose down --volumes` for an upgrade: that deletes the campaign volume. A restored volume must retain the expected ownership and should be validated in an isolated instance before replacing working data. Automated backup restoration is not verified by the current smoke check.

To enable a real provider later, explicitly configure only its project-specific variables through the chosen hosting platform, follow the corresponding integration document and complete its in-app identity/processing review. A running container does not establish Band, Flexprice, model, enrichment or email success. Public callback reachability and live provider processing still require separate verification.

## Repeatable deployment verification

```sh
# Docker engine required: builds and runs the actual Linux image.
python3 scripts/check-deployment.py

# No Docker required: exercises the same probes against isolated local processes.
# This does not prove the Linux image works.
python3 scripts/check-deployment.py --native
```

The [Container deployment workflow](../.github/workflows/container.yml) runs the Docker checker on GitHub’s Linux runner. It verifies:

- The image boots as a non-root user, contains the shared runtime modules and excludes local secrets/data/test drivers.
- Public-interface startup fails without the project token. Health and static UI assets load; campaign APIs reject unauthenticated calls and approval rejects missing CSRF.
- A disposable synthetic account supports local intake/review, native Person → Company → Product matching, a saved value-proposition draft, mandatory exact HITL and one dry-run receipt.
- A linked demo reply updates the native graph and dashboard; same-ID credit reloads and dry-run replay cannot charge twice. Huasheng remains separate.
- After clean shutdown and container removal, a separate native graph reader finds the persisted nodes/relationships/paths without reconstructing them from SQLite. A recreated container then reads the same balance, receipt and pipeline state using a fresh session.

The CI container has no published port or outbound network and receives no live project keys. Its generated access token, named volume and synthetic data are disposable and removed by the checker. Test-only seed/probe code is passed on stdin, not shipped in the runtime image or exposed through an API. The existing owner-disabled Snyk workflow is unchanged; this check does not replace SAST/SCA.
