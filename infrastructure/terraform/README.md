# Terraform — AWS infrastructure

Provisions the AWS foundation for a production SentinelOps deployment:

| Resource | Purpose |
| --- | --- |
| VPC (3 AZs, public+private subnets, NAT) | Network isolation |
| EKS (managed node group) | Runs the `kubernetes/` workloads |
| RDS PostgreSQL 16 | Incidents, telemetry, pgvector RAG store |
| ElastiCache Redis 7 | Cache + Kafka idempotency store |
| MSK (Kafka 3.6) | Event bus |
| Security groups | Scope data-store access to EKS nodes only |

Data stores live in **private** subnets and are reachable only from the EKS node
security group — nothing is internet-exposed.

## Usage

```bash
cd infrastructure/terraform
cp terraform.tfvars.example terraform.tfvars   # edit as needed
export TF_VAR_db_password='<a strong password>'

terraform init      # downloads providers + VPC/EKS modules
terraform plan      # review the plan (no cost yet)
terraform apply     # provision (incurs AWS charges)

# Point kubectl at the new cluster:
$(terraform output -raw configure_kubectl)

# Then deploy the app (see ../kubernetes), wiring the k8s Secret's
# DATABASE_URL / REDIS_URL / KAFKA_BROKERS to the terraform outputs:
terraform output postgres_endpoint
terraform output redis_endpoint
terraform output kafka_bootstrap_brokers
```

## Cost note

`terraform plan` is free. `apply` creates chargeable resources (EKS, RDS, MSK, NAT).
The defaults use small instance classes and a single NAT gateway to keep costs modest;
raise `multi_az`, node counts, and NAT-per-AZ for production HA. Run
`terraform destroy` to tear everything down.

## Not required for local development

Local dev uses `docker compose` (root) or `kind`/`minikube` (../kubernetes). This
Terraform is only for a real AWS deployment.
