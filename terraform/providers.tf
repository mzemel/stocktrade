terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
  required_version = ">= 1.0"
}

provider "cloudflare" {
  # Uses CLOUDFLARE_API_TOKEN environment variable
}
