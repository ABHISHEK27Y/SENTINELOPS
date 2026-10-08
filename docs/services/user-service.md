# Service · user-service

User records and auth lookups. A straightforward PostgreSQL reader in the application
tier. Its DB latency contributes to the dependency graph, but it is not the primary
failure target.

- **Port**: 8081 (`USER_SERVICE_PORT`)
- **Depends on**: PostgreSQL (simulated), baseline DB latency ~12ms
- **Built on**: [`service-kit`](../packages/service-kit.md)
- **Code**: [`services/user-service/src`](../../services/user-service/src)
- **Status**: ✅ implemented + verified

---

## Endpoints

Beyond the standard [service-kit endpoints](../packages/service-kit.md#endpoints-every-service-gets-for-free):

| Method | Path | Behaviour |
| --- | --- | --- |
| `GET` | `/users/:id` | `simulateDbQuery()` → returns `{ id, name, email, dbLatencyMs }` |
| `POST` | `/users` | `simulateDbQuery(20)` → `201 { id, name, email }` |

Verified response:
```json
{"id":"abc123","name":"user-abc123","email":"user-abc123@example.com","dbLatencyMs":12}
```

## Role in the system

The api-gateway calls `GET /users/:id`; the response contributes user read latency to
the fleet's telemetry baseline. If a DB fault is injected here (`db_latency`), the
gateway's `/users` latency rises — a second, independent failure path the correlation
engine can attribute to user-service's database rather than payment's.

## Run

```bash
npm run dev -w @sentinelops/user-service   # :8081
curl localhost:8081/users/abc123
```
