# Local Kubernetes demo

This bundle uses explicit demo authentication and placeholder local secrets. It is
not a production overlay. PostgreSQL, Redis, Kafka and monitoring storage use PVCs;
a default StorageClass and enough cluster resources are required. Jaeger is ephemeral.

## Build and deploy

Install an ingress controller using your cluster's supported instructions (for
minikube: `minikube addons enable ingress`). Add `127.0.0.1 sentinelops.local` to
hosts and build browser addresses into the image:

```bash
docker build -t sentinelops/app:local --build-arg NEXT_PUBLIC_API_URL=http://sentinelops.local --build-arg NEXT_PUBLIC_WS_URL=ws://sentinelops.local/ws .
kind load docker-image sentinelops/app:local
# Alternatively: minikube image load sentinelops/app:local
kubectl kustomize .        # run from repository root; render for inspection
kubectl apply -k .         # applies root bundle including monitoring ConfigMaps
kubectl -n sentinelops wait --for=condition=complete job/migrate --timeout=180s
kubectl -n sentinelops get pods,pvc
```

Applying all resources does not create a Job dependency graph. API/engines run
locked migrations before consumption as an additional gate; readiness checks depend
on database availability and running consumers. Inspect startup failures and PVC
binding before considering the deployment ready. Redeploying a completed migration
Job may require replacing the Job when its pod template changes.

The web runs `next start`. Image build-time addresses cannot be changed with pod
environment variables alone. Access via your ingress/tunnel; the local demo login
is `engineer@sentinelops.dev` / `engineer123`. Grafana is accessible by port-forward
and requires login. Generate monitoring workloads after editing their descriptor:
`node scripts/generate-monitoring.mjs`, then format its generated YAML.

## Production requirements

Create a separate overlay with `DEMO_MODE=false`, release image tags/digests, TLS
origins, production secret delivery and an operator account. Replace local stores
with managed endpoints where appropriate. Use `rediss://` for TLS Redis and
`KAFKA_SSL=true` with TLS MSK brokers. The local secrets file is excluded from a
production deployment. Size resources, configure authentication for monitoring,
review network policies and verify backup/restore and rolling restarts before release.

## Isolation and writable storage

Use a CNI that enforces NetworkPolicy (for example Calico or Cilium). The bundle
denies ingress by default. API port 4000 and web port 3000 accept traffic only from
the `ingress-nginx` namespace; update the namespace selector if your controller
runs elsewhere. Prometheus reaches only the API's separate metrics listener on
4001, which has no dashboard, authentication or WebSocket routes. The shared
Prometheus configuration also uses 4001 in Docker Compose; rebuild the API image
when adopting this change. It does not require a published host port.

Explicit rules preserve backend calls, database clients, scraping, traces, logs
and alerts. Egress permits same-namespace destinations and TCP/UDP DNS to
`kube-system` pods labeled `k8s-app=kube-dns`; adapt this for NodeLocal DNS or a
different resolver. Only API pods additionally have external HTTPS egress for AI
providers. Ingress rules still restrict the destination of local connections.
Grafana and Jaeger administration use authenticated local port-forward access.

Application pods, the migration Job, PostgreSQL and Redis run as UID/GID 1001
with a read-only root filesystem, dropped capabilities and RuntimeDefault seccomp.
`/tmp` is an emptyDir; npm caches under `/tmp/npm`. The web has an emptyDir at
`/app/apps/web/.next/cache`; PostgreSQL has a writable socket directory. Persistent
data stays on its PVC. `fsGroup: 1001` provides volume group access. Existing PVCs
created under another UID may need an operator-managed ownership migration:
PostgreSQL requires its PGDATA directory to be owned by its running UID. Do not
delete persistent volumes to address this. Validate storage-driver fsGroup support
and permissions in a disposable cluster before upgrading an existing installation.

This host has rendered the bundle; it has not run the cluster. Container image,
collector/Loki startup, PVC permissions and replica behavior remain live checks.
