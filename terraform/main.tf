# D1 Database — trade ledger, snapshots, audit trail
resource "cloudflare_d1_database" "stocktrade" {
  account_id = var.account_id
  name       = "stocktrade"

  lifecycle {
    ignore_changes = [read_replication]
  }
}

# KV Namespace — agent configs, state, market cache
resource "cloudflare_workers_kv_namespace" "stocktrade" {
  account_id = var.account_id
  title      = "stocktrade"
}

# R2 Bucket — report archive, historical data exports
resource "cloudflare_r2_bucket" "stocktrade_reports" {
  account_id = var.account_id
  name       = "stocktrade-reports"
}

# Outputs for wrangler.toml configuration
output "d1_database_id" {
  value       = cloudflare_d1_database.stocktrade.id
  description = "D1 database ID for wrangler.toml binding"
}

output "kv_namespace_id" {
  value       = cloudflare_workers_kv_namespace.stocktrade.id
  description = "KV namespace ID for wrangler.toml binding"
}
