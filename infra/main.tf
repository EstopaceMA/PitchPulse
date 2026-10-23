# PitchPulse on Azure Container Apps. `azd provision` applies this; `azd deploy` builds the image and swaps it in.

data "azurerm_client_config" "current" {}

locals {
  resource_token = substr(sha256("${var.subscription_id}${var.environment_name}${var.location}"), 0, 13)
  tags           = { "azd-env-name" = var.environment_name }

  # https://<account>.services.ai.azure.com/api/projects/<project> → [account, project]. AI stays off without it.
  foundry       = var.foundry_project_endpoint == "" ? null : regex("^https://([^./]+)\\.services\\.ai\\.azure\\.com/api/projects/([^/?#]+)", var.foundry_project_endpoint)
  ai_enabled    = local.foundry != null
  budget_amount = var.ai_budget_amount == "" ? 25 : tonumber(var.ai_budget_amount)

  foundry_env = { for name, value in { FOUNDRY_PROJECT_ENDPOINT = var.foundry_project_endpoint } : name => value if local.ai_enabled }
  agent_pins  = { for agent in ["ANALYST", "RECAP", "ASK", "COMMENTATOR"] : "FOUNDRY_AGENT_VERSION_${agent}" => var.foundry_agent_version if var.foundry_agent_version != "" }
}

# The Foundry account is only looked up, never managed, so `azd down` cannot touch it.
data "azurerm_resources" "foundry_account" {
  count = local.ai_enabled ? 1 : 0
  type  = "Microsoft.CognitiveServices/accounts"
  name  = local.foundry[0]

  lifecycle {
    postcondition {
      condition     = length(self.resources) == 1
      error_message = "FOUNDRY_PROJECT_ENDPOINT names a Foundry account that this subscription cannot see."
    }
  }
}

locals {
  foundry_account = local.ai_enabled ? data.azurerm_resources.foundry_account[0].resources[0] : null
}

resource "azurerm_resource_group" "web" {
  name     = "rg-${var.environment_name}"
  location = var.location
  tags     = local.tags
}

resource "azurerm_log_analytics_workspace" "web" {
  name                = "log-${local.resource_token}"
  location            = var.location
  resource_group_name = azurerm_resource_group.web.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
  tags                = local.tags
}

resource "azurerm_container_registry" "web" {
  name                = "cr${local.resource_token}"
  location            = var.location
  resource_group_name = azurerm_resource_group.web.name
  sku                 = "Basic"
  admin_enabled       = false
  tags                = local.tags
}

# One identity pulls the image and calls Foundry; there are no keys or secrets anywhere.
resource "azurerm_user_assigned_identity" "web" {
  name                = "id-web-${local.resource_token}"
  location            = var.location
  resource_group_name = azurerm_resource_group.web.name
  tags                = local.tags
}

resource "azurerm_role_assignment" "acr_pull" {
  scope                = azurerm_container_registry.web.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.web.principal_id
  principal_type       = "ServicePrincipal"
}

# Foundry User on this one project only. The narrower Foundry Project Runtime User and Foundry Agent Consumer roles
# both return 403 for Responses API calls that use an agent reference. Referenced by ID because Foundry roles are
# being renamed.
resource "azurerm_role_assignment" "foundry_user" {
  count              = local.ai_enabled ? 1 : 0
  scope              = "${local.foundry_account.id}/projects/${local.foundry[1]}"
  role_definition_id = "/subscriptions/${var.subscription_id}/providers/Microsoft.Authorization/roleDefinitions/53ca6127-db72-4b80-b1b0-d745d6d5456d"
  principal_id       = azurerm_user_assigned_identity.web.principal_id
  principal_type     = "ServicePrincipal"
}

resource "azurerm_container_app_environment" "web" {
  name                       = "cae-${local.resource_token}"
  location                   = var.location
  resource_group_name        = azurerm_resource_group.web.name
  logs_destination           = "log-analytics"
  log_analytics_workspace_id = azurerm_log_analytics_workspace.web.id
  tags                       = local.tags

  # Azure gives new environments this serverless profile; declaring it keeps `azd provision` free of drift.
  workload_profile {
    name                  = "Consumption"
    workload_profile_type = "Consumption"
  }
}

resource "azurerm_container_app" "web" {
  name                         = "ca-web-${local.resource_token}"
  resource_group_name          = azurerm_resource_group.web.name
  container_app_environment_id = azurerm_container_app_environment.web.id
  workload_profile_name        = "Consumption"
  revision_mode                = "Single"
  tags                         = merge(local.tags, { "azd-service-name" = "web" })

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.web.id]
  }

  registry {
    server   = azurerm_container_registry.web.login_server
    identity = azurerm_user_assigned_identity.web.id
  }

  ingress {
    external_enabled = true
    target_port      = 8080
    transport        = "auto"

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    # One warm replica: no cold starts, and the agents route's in-memory rate limit stays accurate.
    min_replicas = 1
    max_replicas = 1

    container {
      name = "web"
      # Placeholder that also serves on 8080, so the first revision is healthy until `azd deploy` swaps in PitchPulse.
      image  = "mcr.microsoft.com/dotnet/samples:aspnetapp"
      cpu    = 0.5
      memory = "1Gi"

      env {
        name  = "PORT"
        value = "8080"
      }
      env {
        name  = "HOSTNAME"
        value = "0.0.0.0"
      }
      env {
        name  = "AZURE_CLIENT_ID"
        value = azurerm_user_assigned_identity.web.client_id
      }
      env {
        name  = "PITCHPULSE_AI"
        value = local.ai_enabled ? "on" : "off"
      }
      dynamic "env" {
        for_each = merge(local.foundry_env, local.agent_pins)
        content {
          name  = env.key
          value = env.value
        }
      }
    }
  }

  lifecycle {
    # `azd deploy` owns the image and revision suffix; provisioning must not roll a deployment back.
    ignore_changes = [template[0].container[0].image, template[0].revision_suffix]
  }

  depends_on = [azurerm_role_assignment.acr_pull]
}

# A cost alert on the Foundry resource group, where agent token usage is billed.
resource "azurerm_consumption_budget_resource_group" "ai" {
  count             = local.ai_enabled && local.budget_amount > 0 ? 1 : 0
  name              = "pitchpulse-ai-${var.environment_name}"
  resource_group_id = "/subscriptions/${var.subscription_id}/resourceGroups/${local.foundry_account.resource_group_name}"
  amount            = local.budget_amount
  time_grain        = "Monthly"

  time_period {
    start_date = formatdate("YYYY-MM-01'T'00:00:00'Z'", timestamp())
  }

  dynamic "notification" {
    for_each = [50, 80, 100]
    content {
      enabled        = true
      threshold      = notification.value
      operator       = "GreaterThanOrEqualTo"
      threshold_type = "Actual"
      contact_roles  = ["Owner"]
    }
  }

  lifecycle {
    ignore_changes = [time_period]
  }
}
