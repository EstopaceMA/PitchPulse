# PitchPulse repository guide

This file covers the repository layout and Azure deployment. App work follows [src/web/AGENTS.md](src/web/AGENTS.md); [README.md](README.md) is the user and operator guide.

## Layout

- [src/web/](src/web/) is the whole Next.js app: source, tests, scripts, data, `Dockerfile` and its own `package.json`. Run npm commands there, and keep app code, assets and tooling inside it.
- [azure.yaml](azure.yaml) and [infra/](infra/) make the repository an Azure Developer CLI template. The `web` service builds `src/web/Dockerfile` in Azure Container Registry and deploys it to Azure Container Apps.

## Deployment invariants

- Terraform in [infra/](infra/) owns the infrastructure; `azd deploy` owns the container image. Keep `lifecycle.ignore_changes` on the Container App's image and revision suffix so `azd provision` never rolls back a deployment, and keep the `azd-service-name = "web"` tag that azd deploys to.
- The app authenticates to Foundry only with its user-assigned managed identity: **AcrPull** on the registry and **Foundry User** (role ID `53ca6127-db72-4b80-b1b0-d745d6d5456d`) scoped to the one Foundry project. Don't add keys, secrets, account-wide or broader roles. The narrower "Foundry Project Runtime User" and "Foundry Agent Consumer" roles both return 403 for Responses API calls with an agent reference; a custom role is the way to tighten this further. Foundry resources are looked up, never managed, so `azd down` cannot delete them.
- Configuration flows from the azd environment through [infra/main.tfvars.json](infra/main.tfvars.json) into Container App environment variables. Never bake `.env*` files into images or commit `.azure/` or Terraform state.
- Keep exactly one replica unless the agents route's in-memory rate limit moves to a shared store.

## Verification

- App changes: from `src/web`, run `npm test`, `npm run lint` and `npm run build`, as [src/web/AGENTS.md](src/web/AGENTS.md) describes.
- Infrastructure changes: run `terraform fmt -check -recursive infra` and `terraform validate` (after `terraform -chdir=infra init -backend=false`), then `azd provision --preview` against an environment before applying.
- Deployments: `azd deploy`, then check the endpoint, an AI request through the managed identity, and `az containerapp logs show`.
