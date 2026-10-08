# ── RDS PostgreSQL ──────────────────────────────────────────────────────
resource "aws_db_subnet_group" "postgres" {
  name       = "${var.cluster_name}-pg"
  subnet_ids = module.vpc.private_subnets
}

resource "aws_db_instance" "postgres" {
  identifier             = "${var.cluster_name}-postgres"
  engine                 = "postgres"
  engine_version         = "16"
  instance_class         = var.db_instance_class
  allocated_storage      = 50
  storage_type           = "gp3"
  db_name                = "sentinelops"
  username               = "sentinel"
  password               = var.db_password
  db_subnet_group_name   = aws_db_subnet_group.postgres.name
  vpc_security_group_ids = [aws_security_group.data_access.id]
  multi_az               = var.environment == "production"
  storage_encrypted      = true
  skip_final_snapshot    = var.environment != "production"
  deletion_protection    = var.environment == "production"
  # pgvector: enable the extension via a migration after provisioning
  # (RDS Postgres 16 ships pgvector as an available extension).
}

# ── ElastiCache Redis ───────────────────────────────────────────────────
resource "aws_elasticache_subnet_group" "redis" {
  name       = "${var.cluster_name}-redis"
  subnet_ids = module.vpc.private_subnets
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id       = "${var.cluster_name}-redis"
  description                = "SentinelOps cache + idempotency store"
  engine                     = "redis"
  engine_version             = "7.1"
  node_type                  = var.redis_node_type
  num_cache_clusters         = var.environment == "production" ? 2 : 1
  automatic_failover_enabled = var.environment == "production"
  subnet_group_name          = aws_elasticache_subnet_group.redis.name
  security_group_ids         = [aws_security_group.data_access.id]
  at_rest_encryption_enabled = true
  transit_encryption_enabled = false
  port                       = 6379
}

# ── MSK (Kafka) ─────────────────────────────────────────────────────────
resource "aws_msk_cluster" "kafka" {
  cluster_name           = "${var.cluster_name}-kafka"
  kafka_version          = "3.6.0"
  number_of_broker_nodes = 3

  broker_node_group_info {
    instance_type   = var.kafka_instance_type
    client_subnets  = module.vpc.private_subnets
    security_groups = [aws_security_group.data_access.id]
    storage_info {
      ebs_storage_info { volume_size = 50 }
    }
  }

  encryption_info {
    encryption_in_transit {
      client_broker = "TLS_PLAINTEXT"
      in_cluster    = true
    }
  }
}
