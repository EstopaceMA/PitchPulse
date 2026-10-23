# azd stores these in the environment: the registry endpoint is where `azd deploy` pushes the image.

output "AZURE_LOCATION" {
  value = var.location
}

output "AZURE_TENANT_ID" {
  value = data.azurerm_client_config.current.tenant_id
}

output "AZURE_RESOURCE_GROUP" {
  value = azurerm_resource_group.web.name
}

output "AZURE_CONTAINER_REGISTRY_ENDPOINT" {
  value = azurerm_container_registry.web.login_server
}

output "AZURE_CONTAINER_REGISTRY_NAME" {
  value = azurerm_container_registry.web.name
}

output "AZURE_CONTAINER_ENVIRONMENT_NAME" {
  value = azurerm_container_app_environment.web.name
}

output "SERVICE_WEB_NAME" {
  value = azurerm_container_app.web.name
}

output "SERVICE_WEB_ENDPOINT_URL" {
  value = "https://${azurerm_container_app.web.ingress[0].fqdn}"
}
