# Kubernetes deployment

Runnable on a local cluster (kind or minikube). Data stores (Postgres, Redis, Kafka)
run as single-replica Deployments for the demo; in AWS they map to RDS, ElastiCache,
and MSK (see `../terraform`).

## Prerequisites
- A cluster: `kind create cluster` or `minikube start`
- An ingress controller (nginx): `kubectl apply -f https://ksi.example/nginx` or
  `minikube addons enable ingress`

## Build + load the image
All app pods share one image:
```bash
docker build -t sentinelops/app:local .
kind load docker-image sentinelops/app:local      # kind
# minikube image load sentinelops/app:local       # minikube
```

## Apply (ordered)
```bash
kubectl apply -f 00-namespace.yaml
kubectl apply -f 01-config.yaml
kubectl apply -f 02-data.yaml
kubectl apply -f 03-kafka.yaml
# wait for postgres/redis/kafka Ready, then:
kubectl apply -f 04-apps.yaml       # runs the migrate Job, then services
kubectl apply -f 05-web-ingress.yaml
```

Or all at once (the migrate Job retries until Postgres is ready):
```bash
kubectl apply -f .
```

## Access
Add `127.0.0.1 sentinelops.local` to your hosts file, then open
`http://sentinelops.local` (kind: `kubectl port-forward` the ingress, or use the
minikube tunnel). Log in with `engineer@sentinelops.dev` / `engineer123`.

## Notes
- Secrets here are for local use only. In production, use External Secrets Operator or
  mount from AWS Secrets Manager, and set a real `JWT_SECRET`.
- `web` runs `next dev` for simplicity; for production build a dedicated image with
  `next build && next start` (the repo Dockerfile can be extended with a web stage).
- Horizontal scaling: `api`, `api-gateway`, and `payment-service` are set to 2 replicas;
  the Kafka consumer groups (anomaly-engine, incident-engine, ingestor) scale by adding
  replicas up to the topic partition count.
