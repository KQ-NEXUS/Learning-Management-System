# Phase 04: User Setup Required

**Generated:** 2026-09-03
**Phase:** catalogue-authoring-programmes-courses-modules-lessons
**Status:** Complete for local Compose; production host check pending

The local Docker Compose environment is configured and verified. Before deploying the scanner elsewhere, confirm the production host has enough memory and preserve the same environment-driven ClamAV connection.

## Environment Variables

| Status | Variable | Source | Add to |
|--------|----------|--------|--------|
| [x] | `CLAMAV_HOST` | Local Compose service name: `clamav` | Local Compose environment |
| [x] | `CLAMAV_PORT` | clamd default TCP port: `3310` | Local Compose environment |
| [ ] | `CLAMAV_HOST` | Production clamd hostname or service name | Production deployment environment |
| [ ] | `CLAMAV_PORT` | Production clamd TCP port, normally `3310` | Production deployment environment |

No ClamAV account or API key is required.

## Host Configuration

- [ ] **Confirm production scanner memory capacity**
  - Location: Docker deployment host
  - Requirement: at least 2 GB of free RAM before starting ClamAV
  - Compose limit: the service is capped at 4 GB
  - Notes: clamd's signature database has an approximately 1.2 GB load floor. The first start may take several minutes while signatures download.

- [ ] **Keep the ClamAV database volume persistent**
  - Location: production Docker volume configuration
  - Required mount: `clamav-db:/var/lib/clamav`
  - Notes: removing this volume forces a full signature download on the next start.

## Verification

After configuring the production host, verify that:

```bash
docker compose up -d
docker compose ps
docker compose logs --tail 50 clamav
docker compose logs --tail 50 worker
```

Expected results:

- `clamav` reports healthy.
- `worker` remains running and reports both lesson-resource queues ready.
- Restarting the stack does not trigger a full signature database download.

---

**Once the production items are complete:** Change the status above to `Complete` and check both remaining boxes.
