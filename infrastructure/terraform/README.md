# AWS infrastructure scaffold

Terraform describes VPC/EKS, private RDS PostgreSQL, Redis and MSK. It has not been
provider-validated or planned on the repair host because Terraform is absent.
The CI infrastructure job now initializes providers without a backend and validates
source. No AWS resources were provisioned during repairs.

Supply `db_password` (at least 24 characters), an EKS-supported `kubernetes_version`
and an MSK-supported `kafka_version` for the chosen region. Historical version
defaults have been removed. The EKS API is private by default; an administrator
needs VPC access or explicit narrow `cluster_public_access_cidrs`.

Redis transport encryption is enabled: wire the application URL as `rediss://...`.
MSK outputs TLS brokers; set `KAFKA_SSL=true`. Set the PostgreSQL connection to use
validated server TLS for the managed endpoint. Enable pgvector through migrations.
Database credentials remain sensitive Terraform state: use an encrypted, restricted
remote backend with locking, as illustrated by `backend.tf.example`. Initialize
and review that backend separately; it is not provisioned by this scaffold.

```bash
cd infrastructure/terraform
# Copy/edit terraform.tfvars.example, supply secrets outside version control.
terraform init
terraform validate
terraform plan
```

A reviewed plan and separate authorization precede any chargeable apply. Production
application deployment still needs release images, a production Kubernetes overlay,
external secrets, operator provisioning, monitoring access controls and tested
backup/restore. The root Kustomize bundle is an isolated local demo and must not be
applied to production. Provider lockfile/version support and formatting remain
checks to complete using Terraform; do not treat this scaffold as AWS-ready.
