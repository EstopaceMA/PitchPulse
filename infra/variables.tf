# Values come from the azd environment through main.tfvars.json; unset azd values arrive as empty strings.

variable "environment_name" {
  description = "azd environment name, used for the resource group name and tags."
  type        = string
}

variable "location" {
  description = "Azure region for the web app resources. Use the Foundry project's region to keep agent calls close."
  type        = string
}

variable "subscription_id" {
  description = "Subscription to deploy into (AZURE_SUBSCRIPTION_ID)."
  type        = string
}

variable "foundry_project_endpoint" {
  description = "Microsoft Foundry project endpoint (FOUNDRY_PROJECT_ENDPOINT). Empty deploys with AI analysis switched off."
  type        = string
  default     = ""

  validation {
    condition     = var.foundry_project_endpoint == "" || can(regex("^https://[^./]+\\.services\\.ai\\.azure\\.com/api/projects/[^/?#]+/?$", var.foundry_project_endpoint))
    error_message = "FOUNDRY_PROJECT_ENDPOINT must look like https://<account>.services.ai.azure.com/api/projects/<project>."
  }
}

variable "foundry_agent_version" {
  description = "Pins all four PitchPulse agents to this Foundry agent version (FOUNDRY_AGENT_VERSION). Empty uses each agent's latest version."
  type        = string
  default     = ""

  validation {
    condition     = can(regex("^[0-9]*$", var.foundry_agent_version))
    error_message = "FOUNDRY_AGENT_VERSION must be a version number such as 5, or empty."
  }
}

variable "ai_budget_amount" {
  description = "Monthly cost alert in USD on the Foundry resource group (AI_BUDGET_AMOUNT). Empty means 25; 0 creates no budget."
  type        = string
  default     = ""

  validation {
    condition     = can(regex("^[0-9]*$", var.ai_budget_amount))
    error_message = "AI_BUDGET_AMOUNT must be a whole number of US dollars, or empty."
  }
}
