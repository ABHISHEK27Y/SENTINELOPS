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
add network policies and verify backup/restore and rolling restarts before release.

This host has rendered the bundle; it has not run the cluster. Container image,
collector/Loki startup, PVC permissions and replica behavior remain live checks.
