terraform {
  required_version = ">= 1.9, < 2.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}

# Authenticates through the Azure CLI (`az login`), as azd's Terraform support requires.
provider "azurerm" {
  subscription_id = var.subscription_id

  features {
    resource_group {
      # `azd down` removes the whole environment resource group.
      prevent_deletion_if_contains_resources = false
    }
    log_analytics_workspace {
      permanently_delete_on_destroy = true
    }
  }
}
