# SentinelOps final check — 13 October 2026

## Scope and result

The agreed target is a **local demonstration**. The six repair phases have been
implemented in source, and the source-level and live checks below pass. The
post-deployment incident trend is recorded in the final section of this report.
This report does not claim cloud or production readiness.

## What was built, in plain language

SentinelOps runs five small demo services and sends their HTTP, process and
application signals through Kafka. An ingestor stores normalized evidence in
PostgreSQL. A detector learns each instance's ordinary measurements and reports
deviations. A correlator groups related deviations by time and service
dependency, creating one incident with a suspected cause. The API and dashboard
show the incident, its evidence and runbook guidance. An engineer can investigate,
propose and approve a narrowly scoped demo action. A durable worker clears the
injected fault and waits for fresh, passing measurements before marking the
incident resolved. It can then create a postmortem.

The repairs made that flow more reliable: database inbox/outbox records and
idempotent Kafka handling protect against duplicate delivery; incident state
changes and remediation jobs are transactional; authentication protects reads,
WebSockets and decisions; and migrations, health gates and local monitoring make
the stack easier to operate. The dashboard uses polling when live events are
unavailable. Details of these choices and their tradeoffs are in
[Implemented architecture](architecture/IMPLEMENTED_ARCHITECTURE.md) and the
[phase checklist](FIX_PLAN.md).

This final scan also found noisy alert creation under ordinary generated traffic.
The detector now ignores a one-item notification queue and small request-rate
movement, and it requires repeated abnormal samples for noisy gauges and latency.
The confirmation count survives a process restart, while a healthy sample or a
gap of more than 20 seconds resets it. The incident engine updates a title when
correlation adds services. The API also corrects the displayed count for older
saved incidents without rewriting their history.

## Source verification

| Check | Result |
| --- | --- |
| Unit, API, browser and pipeline tests | 49 files, 230 tests passed |
| Coverage gates | Statements 86.46%, branches 77.36%, functions 80.62%, lines 88.30%; all configured gates passed |
| TypeScript, ESLint and Prettier | Passed |
| Optimized Next.js build | Passed; static and dynamic routes generated |
| Dependency audit | Zero known npm advisories in the resolved dependency tree at check time |
| Compose configuration and Kubernetes manifest render | Both passed; Kubernetes was not deployed |
| Knip dependency analysis | Passed with three configuration hints, no source finding |

The final 230-test suite passed, including the HTTP-latency calibration test.
An earlier final-check run timed out in seven test cases while Docker and many
test workers competed for this Windows host; it reported no assertion failures,
and a full rerun passed. A restricted-shell attempt also could not use Windows
temporary files; using a workspace temp directory succeeded. The npm audit
request was made with the user's earlier explicit authorization.

## How to check the local demo

1. Start Docker Desktop with its Linux engine. Its data disk is configured under
   `D:\DockerDesktopData\DockerDesktopWSL` on this machine. From the repository root run
   `npm ci`, then
   `docker compose --env-file .env.demo.example up -d --build --wait`.
2. Open <http://localhost:3000> and sign in with the demo engineer account shown
   in the README. `GET http://localhost:4010/api/ready` should return
   `{"ready":true}`. Prometheus is at <http://localhost:9090>, Grafana at
   <http://localhost:3001>, and Jaeger at <http://localhost:16686>.
3. Use the Failure Console to add a database-latency fault to payment-service.
   A fresh payment incident should appear after abnormal samples are confirmed.
   Open it, investigate, propose and approve the fault-clear action. Watch it
   move through verification to resolved; then request a postmortem.
4. For an automated end-to-end check in PowerShell, set
   `$env:SENTINELOPS_SMOKE_URL='http://127.0.0.1:4010'` and run
   `node scripts/stack-smoke.mjs`. It deliberately injects and clears a demo
   fault and can take several minutes.
5. Run `npm run test:coverage`, `npm run lint`, `npm run typecheck`,
   `npm run format:check`, and `npm run build` for source checks. On this Windows
   host, the tests require a writable temporary directory; use
   `$env:TEMP='D:\miniProject\SENTINELOPS\tmp\vitest-review'` if the default
   sandbox temp path gives an `EPERM` error.

`docker compose --env-file .env.demo.example down` stops the stack while
preserving its named volumes. Old incident records remain in the demo database;
they are not evidence of a new failure after this tuning.

## Limits and follow-up

The local demo uses mock AI/embeddings and simulated business database/cache
operations. Only clearing a named injected fault has a real remediation adapter;
restart, scale, rollback and cache-clear actions are proposals, not executable
operations. Static topology, a single correlation lock, broker/SQL at-least-once
delivery and fixed signal thresholds are deliberate local-demo choices. Cloud
Terraform, Kubernetes runtime behavior, remote model behavior, production
credentials and access policy, and multi-partition load limits were not verified.

Historical incidents opened during earlier noisy runs are preserved for review.
At the final check, 46 remain `DETECTED` and one `MITIGATION_REQUIRED`; five
smoke-test records are `POSTMORTEM`. Their status is not automatically changed
by detector tuning. Operators should review and disposition them explicitly.
Nine Compose services do not define a
Docker healthcheck, so “running” alone does not prove they are healthy; the API
readiness, service endpoints and workflow smoke test provide stronger evidence.

## Live validation

The final shared image was built once and deployed with
`docker compose --env-file .env.demo.example up -d --no-build --wait`. All 21
long-running containers are up; 12 report `healthy`, while nine have no Docker
healthcheck. The API returned `{"ready":true}` and the web login route returned
HTTP 200. Prometheus reported 13/13 active targets up. Jaeger listed all five
business services. Loki returned HTTP 200 from `/ready` after its startup wait.

The automated `scripts/stack-smoke.mjs` workflow passed before and after the
final HTTP-latency calibration: it rejected an invalid
fault request, opened a fresh payment incident from injected DB latency,
investigated, proposed the scoped fault-clear action, accepted one approval,
rejected a duplicate, observed verified recovery, and generated a postmortem.
The failure API then reported zero active injected faults and zero unreachable
business services. A historical incident, `INC-1093`, displayed four affected
services in its title and list, confirming the old-record title fix.

The deliberate first smoke-test incident `INC-1140` ended in `POSTMORTEM`. After the
fault was cleared, five minutes of ordinary generated traffic stored **2,400
metric samples, zero anomalies and zero new incidents**. A later read caught
`INC-1141` at 09:51 UTC: two order-service HTTP-latency samples around 71–75 ms
against a roughly 58 ms baseline. This showed the five-minute quiet window was
insufficient to declare the background noise solved. A follow-up source change
raised the local HTTP-latency absolute noise floor from 5 to 25 ms; its focused
test confirms that ordinary movement stays quiet while a sustained 100 ms spike
still alerts. The final image was redeployed, and the second smoke test created
`INC-1146` and finished in `POSTMORTEM`. Historical incidents remain for explicit
review, not silent closure.

Docker Desktop briefly failed during a parallel Compose image export. Its logs
showed the WSL data VHD was already attached. A clean WSL/Docker stop and start
recovered the engine without deleting volumes. The subsequent single-image
build, deployment and live acceptance all passed.

## Docker storage and recovery

The host's C: drive had less than 1 GB free. [Docker Desktop's supported disk-image
location setting](https://docs.docker.com/desktop/settings-and-maintenance/settings/)
moved its WSL data disk from
`C:\Users\ASUS\AppData\Local\Docker\wsl\disk\docker_data.vhdx` to
`D:\DockerDesktopData\DockerDesktopWSL\disk\docker_data.vhdx`. The old C: VHD is
absent, the new D: VHD is about 25.5 GB, and C: has roughly 40 GiB free at the
final check. Docker Desktop's active application files on C: total about 31 MB;
they were left in place so the application can run.
Unused build cache cleanup reclaimed 4.98 GB inside Docker without touching
named volumes. An obsolete 2.6 MB Docker diagnostic ZIP was removed from C:.

The engine restart exposed a damaged Redis append-only log. A complete copy of
the Redis volume files was saved at `tmp/redis-recovery-2026-10-13` on D: before
`redis-check-aof` removed its 107-byte corrupt tail. PostgreSQL, all ten named
volumes and the incident history were preserved. Compose then reported 21 running
services, 12 healthy Docker checks and a successful API readiness response. The
backup is intentionally outside Git and can be removed after local review.

## Final fault-free observation

After `INC-1146` reached `POSTMORTEM` and its injected fault was cleared, a
renewed **8-minute-31-second** window (15:11:30–15:20:01 UTC) stored 4,080
metric samples with **zero anomalies and zero new incidents**. The API still
returned `{"ready":true}`, the web login and Loki readiness endpoints returned
HTTP 200, and all 21 long-running Compose services were up with 12 passing
Docker health checks. Prometheus had 13/13 targets up and Jaeger showed the five
business services. This demonstrates a quiet local-demo workload after the final
calibration; other traffic patterns may still need their own thresholds.
