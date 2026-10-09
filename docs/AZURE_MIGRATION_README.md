# Microsoft Azure Portal Access Verification & Migration Handbook ☁️🚀
> **Project:** XConnect (ConfPresence Zero-Hardware Indoor Presence & Clustering System)  
> **Target Cloud:** Microsoft Azure  
> **Target Resource Group:** `rg-xconnect-prod`  
> **Target Architecture:** Azure Container Apps (ACA) + Azure Database for PostgreSQL (Flexible Server) + Azure Container Registry (ACR)  
> **Audience:** Engineering Team (Mohammed Thaqib Ul Rahman & Krishna Kansara)  
> **Status:** Active Master Runbook  

---

## 📑 Table of Contents

1. [Part 1: How to Check & Verify Your Azure Portal Access](#1-part-1-how-to-check--verify-your-azure-portal-access)
   - [1.1 Log in to Azure Portal via Org Email](#11-log-in-to-azure-portal-via-org-email)
   - [1.2 Verify Directory & Switch Tenant](#12-verify-directory--switch-tenant)
   - [1.3 Check Subscriptions & Resource Groups](#13-check-subscriptions--resource-groups)
   - [1.4 Verify Your RBAC Role & Permissions (IAM)](#14-verify-your-rbac-role--permissions-iam)
   - [1.5 Verify Azure CLI Access from Your Local Terminal](#15-verify-azure-cli-access-from-your-local-terminal)
   - [1.6 What to Do If Access Is Missing (Troubleshooting Template)](#16-what-to-do-if-access-is-missing-troubleshooting-template)
2. [Part 2: Architecture & Resource Planning (Render vs. Azure)](#2-part-2-architecture--resource-planning-render-vs-azure)
   - [2.1 Architecture Mapping & Target Topology](#21-architecture-mapping--target-topology)
   - [2.2 Target Resource Inventory & Sizing](#22-target-resource-inventory--sizing)
   - [2.3 Itemized Monthly Cost Estimate](#23-itemized-monthly-cost-estimate)
3. [Part 3: Step-by-Step Technical Migration Runbook (What, Where & How)](#3-part-3-step-by-step-technical-migration-runbook-what-where--how)
   - [Phase 0: Local Environment & Tooling Preparation](#phase-0-local-environment--tooling-preparation)
   - [Phase 1: Azure Database Provisioning & Data Migration](#phase-1-azure-database-provisioning--data-migration)
   - [Phase 2: Azure Container Registry (ACR) & Docker Build](#phase-2-azure-container-registry-acr--docker-build)
   - [Phase 3: Azure Container Apps (ACA) Deployment](#phase-3-azure-container-apps-aca-deployment)
   - [Phase 4: API Smoke Testing & Diagnostics](#phase-4-api-smoke-testing--diagnostics)
   - [Phase 5: Mobile App Endpoint Cutover](#phase-5-mobile-app-endpoint-cutover)
   - [Phase 6: Cutover Safeguards & Render Decommissioning](#phase-6-cutover-safeguards--render-decommissioning)
4. [Part 4: Critical Technical Safeguards & Best Practices](#4-part-4-critical-technical-safeguards--best-practices)
5. [Part 5: Troubleshooting & Quick FAQ](#5-part-5-troubleshooting--quick-faq)

---

# 1. Part 1: How to Check & Verify Your Azure Portal Access

When your manager notifies you: *"Krishna Kansara & Mohammed Thaqib Ul Rahman you both got azure portal access"*, follow these exact steps to verify your access privileges.

---

### 1.1 Log in to Azure Portal via Org Email

1. Open your web browser (Edge, Chrome, or Firefox) — preferably in an **Incognito / Private Window** to avoid caching personal Microsoft account sessions.
2. Navigate to: **[https://portal.azure.com](https://portal.azure.com)**.
3. Sign in using your **Official Organization Email Address**.
4. When prompted:
   - Select **"Work or school account"** (do NOT select "Personal Microsoft Account").
   - Complete your organization's **Multi-Factor Authentication (MFA)** (Microsoft Authenticator approval or SMS code).

---

### 1.2 Verify Directory & Switch Tenant

If your organization has multiple Azure tenants or guest directories, ensure you are in the correct one:

```
[Azure Portal Top Bar] ──> Click Gear Icon ⚙️ (Settings) ──> "Directories + subscriptions"
```

1. Look at the top right corner of the portal. Check the name under your email profile.
2. Click the **Directories + subscriptions** filter (or the ⚙️ Settings icon at the top right).
3. Under **Default directory filter**, check which directory is active.
4. If you see your company's directory listed under **Other directories**, click the **Switch** button next to it.

---

### 1.3 Check Subscriptions & Resource Groups

Once logged in to the correct directory:

#### A. Check Subscriptions
1. In the top global search bar, type `Subscriptions` and press **Enter**.
2. Confirm you see an active subscription (e.g., `Pay-As-You-Go`, `Microsoft Azure Enterprise`, or similar).
3. The **Status** column must show **`Active`**.

#### B. Check Resource Groups
1. In the top global search bar, type `Resource groups` and press **Enter**.
2. Check if a dedicated project resource group has already been created (e.g., `rg-xconnect-prod`, `rg-confpresence-prod`, or `rg-xconnect-dev`).
3. If no resource group exists yet, confirm whether you have permission to create one (see Section 1.4).

---

### 1.4 Verify Your RBAC Role & Permissions (IAM)

To build and deploy cloud infrastructure, you need appropriate Role-Based Access Control (RBAC) permissions.

1. In **Resource groups**, click on your project resource group (e.g., `rg-xconnect-prod`).
   *(If the resource group is not created yet, go to **Subscriptions** $\rightarrow$ click your Subscription).*
2. On the left navigation sidebar, click **Access control (IAM)**.
3. Click the **View my access** button (under the *Check access* tab) or click the **Role assignments** tab.
4. Look for your name/email under **Role**:

| Role Displayed | Status | What You Can Do |
| :--- | :---: | :--- |
| **`Contributor`** or **`Owner`** | ✅ **READY** | You have full permissions to provision Azure PostgreSQL, Container Apps, Container Registries, and configure network firewalls. |
| **`Reader`** | ⚠️ **INSUFFICIENT** | You can view resources but cannot create or deploy anything. Request an elevation to `Contributor`. |
| **No Role Listed / Blank** | ❌ **NO ACCESS** | Access has not propagated or was assigned to the wrong email/directory. |

---

### 1.5 Verify Azure CLI Access from Your Local Terminal

Testing via the Azure CLI ensures you can automate builds, migrate databases, and deploy containers directly from your development machine.

1. Open **PowerShell** or **Terminal** on your local machine.
2. Run the Azure login command:
   ```powershell
   az login
   ```
3. A browser window will open. Sign in with your **Organization Email**.
4. Once authenticated, run the following verification commands:

   ```powershell
   # 1. List active account and subscription
   az account show --output table

   # 2. List all accessible Resource Groups
   az group list --output table

   # 3. Check registered Azure resource providers
   az provider show --namespace Microsoft.App --query "registrationState"
   az provider show --namespace Microsoft.DBforPostgreSQL --query "registrationState"
   ```

If the outputs return your subscription name and resource groups without authorization errors, your environment is **100% ready for migration**.

---

### 1.6 What to Do If Access Is Missing (Troubleshooting Template)

If you log in and see `"No subscriptions found"` or have only `Reader` permissions, reply to your manager in Teams using this template:

> **Teams Reply Template:**
> *"Hi [Manager Name], I logged into the Azure Portal with my org email ([your-email@org.com]). I can see the directory, but I currently do not have `Contributor` permissions on the subscription / resource group `rg-xconnect-prod`. Could you please assign the **Contributor** role to `Mohammed Thaqib Ul Rahman` and `Krishna Kansara` under the target Resource Group / Subscription so we can proceed with provisioning Azure PostgreSQL and Azure Container Apps? Thank you!"*

---

# 2. Part 2: Architecture & Resource Planning (Render vs. Azure)

---

### 2.1 Architecture Mapping & Target Topology

```mermaid
flowchart LR
    subgraph Current_Render["Current State: Render.com"]
        R_API["Render Web Service\n(Docker Node.js 20 Express)"]
        R_DB["Render PostgreSQL\n(Managed Postgres)"]
        R_API --> R_DB
    end

    subgraph Target_Azure["Target State: Microsoft Azure (rg-xconnect-prod)"]
        ACR["Azure Container Registry\n(crxconnectprod - Basic SKU)"]
        ACA["Azure Container Apps\n(ca-xconnect-api: 0.5 vCPU, 1 GB RAM)"]
        APG["Azure PostgreSQL Flexible Server\n(psql-xconnect-prod - Burstable B1ms)"]
        LOG["Log Analytics Workspace\n(log-xconnect-prod)"]
        
        ACR -->|Pulls Image| ACA
        ACA -->|Read/Write State| APG
        ACA -->|Telemetry Logs| LOG
    end
```

### Component Comparison Table

| Service Layer | Current (Render.com) | Target (Microsoft Azure) | Technical Justification |
| :--- | :--- | :--- | :--- |
| **API & Inference Engine** | Render Web Service (`Docker`) | **Azure Container Apps (ACA)** | Serverless container platform with built-in HTTPS SSL, automated health probes, and zero-downtime rolling revisions. |
| **Relational Database** | Render Managed PostgreSQL | **Azure Database for PostgreSQL – Flexible Server** | PostgreSQL 16 on Burstable compute (`B1ms`), automated 7-day backups, point-in-time recovery (PITR), and strict SSL enforcement. |
| **Container Image Registry** | Render Git-Triggered Build | **Azure Container Registry (ACR)** | Private, secure Docker image registry on Azure's private backbone network. |
| **Logs & Real-time Telemetry** | Render Console Streams | **Azure Log Analytics Workspace** | Structured indexing, queryable metrics, and live log streaming for sensor calculations (BLE / Ultrasonic / Wi-Fi). |

---

### 2.2 Target Resource Inventory & Sizing

All resources will reside in a single logical group: **`rg-xconnect-prod`**.

```
📁 Resource Group: rg-xconnect-prod (Region: Central India or East US)
 ├── 🐳 Azure Container Registry:      crxconnectprod (SKU: Basic)
 ├── 🚀 Azure Container App:            ca-xconnect-api (0.5 vCPU, 1.0 GiB RAM, Replicas: 1)
 ├── 🗄️ Azure PostgreSQL Flexible:     psql-xconnect-prod (Burstable B1ms, Postgres 16, 32 GB)
 └── 📊 Log Analytics Workspace:        log-xconnect-prod (Pay-as-you-go)
```

---

### 2.3 Itemized Monthly Cost Estimate

| Azure Resource | SKU / Specifications | Monthly Cost (USD) | Monthly Cost (INR @ ₹86/$) |
| :--- | :--- | :---: | :---: |
| **Azure Container Apps (ACA)** | **0.5 vCPU, 1.0 GiB RAM** (1 Dedicated 24/7 Replica) | **$10.00 – $14.00** | ₹860 – ₹1,200 |
| **Azure PostgreSQL (Flexible Server)** | **Burstable B1ms Tier** (1 vCore, 2 GiB RAM, 32 GiB SSD) | **$15.50 – $17.00** | ₹1,330 – ₹1,460 |
| **Azure Container Registry (ACR)** | **Basic SKU** (10 GiB private storage) | **$5.00** | ₹430 |
| **Log Analytics Workspace** | **Pay-as-you-go** (First 5 GB data ingestion free) | **$0.00 – $2.00** | ₹0 – ₹170 |
| **Outbound Data Transfer (Egress)** | Standard Egress (First 100 GB/month outbound free) | **$0.00** | ₹0 |
| **Total Net Estimated Cost** | **Standard 24/7 Production Setup** | **~$30.50 – $38.00 / mo** | **~₹2,620 – ₹3,260 / mo** |

---

# 3. Part 3: Step-by-Step Technical Migration Runbook (What, Where & How)

Follow this execution roadmap sequentially. Do NOT skip steps.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              TECHNICAL EXECUTION PHASES                                │
└────────────────────────────────────────────────────────────────────────────────────────┘
  Phase 0: Local Environment & Tooling Preparation
  Phase 1: Azure Database Provisioning & Data Migration
  Phase 2: Azure Container Registry (ACR) & Docker Build
  Phase 3: Azure Container Apps (ACA) Deployment & Configuration
  Phase 4: API Smoke Testing & Diagnostics
  Phase 5: Mobile App Endpoint Cutover
  Phase 6: Cutover Safeguards & Render Decommissioning
```

---

## Phase 0: Local Environment & Tooling Preparation

### What to do:
Verify that your workstation has the required CLI tools installed to communicate with both Render and Azure.

### Where to do:
Your local development machine (PowerShell / Terminal).

### How to do:

1. **Verify Azure CLI**:
   ```powershell
   az --version
   ```
   *(If not installed, download from [aka.ms/installazurecliwindows](https://aka.ms/installazurecliwindows)).*

2. **Verify Node.js & pnpm**:
   ```powershell
   node -v   # Should be v20.x or higher
   pnpm -v   # Monorepo uses pnpm 10.14.0
   ```

3. **Verify PostgreSQL Client Tools (`pg_dump` and `psql`)**:
   ```powershell
   pg_dump --version
   psql --version
   ```

4. **Register Azure Resource Providers (One-Time Execution)**:
   ```powershell
   az provider register --namespace Microsoft.App
   az provider register --namespace Microsoft.ContainerRegistry
   az provider register --namespace Microsoft.DBforPostgreSQL
   az provider register --namespace Microsoft.OperationalInsights
   ```

---

## Phase 1: Azure Database Provisioning & Data Migration

### What to do:
Provision Azure Database for PostgreSQL Flexible Server, configure firewalls, and migrate schema & historical data from Render to Azure.

### Where to do:
Azure Portal (`portal.azure.com`) + Local Terminal.

### How to do:

#### Step 1.1: Create PostgreSQL Flexible Server via Azure Portal
1. In Azure Portal, search for **Azure Database for PostgreSQL flexible servers** $\rightarrow$ click **+ Create**.
2. Configure basic settings:
   - **Subscription:** Select your active subscription.
   - **Resource Group:** Select `rg-xconnect-prod`.
   - **Server Name:** `psql-xconnect-prod` (must be globally unique).
   - **Region:** Select your target region (e.g., `Central India` or `East US`).
   - **PostgreSQL Version:** Select `16`.
   - **Workload Type:** Select **Development / Small workloads**.
   - **Compute + Storage:** Click *Configure Server* $\rightarrow$ Select **Burstable** $\rightarrow$ **Standard_B1ms** (1 vCore, 2 GiB RAM, 32 GiB Storage).
   - **Authentication:** Select **PostgreSQL authentication only**.
   - **Admin Username:** `xconnectadmin`
   - **Password:** Create a secure password (e.g., `XConnect2026!SecurePass`).
3. Under the **Networking** tab:
   - Firewall rules: Check **"Allow public access from any Azure service within Azure to this server"**.
   - Click **+ Add current client IP address** (allows you to run migrations from your local laptop).
4. Click **Review + create** $\rightarrow$ **Create** (takes ~3 to 5 minutes).

#### Step 1.2: Create the Database
1. Once deployed, open `psql-xconnect-prod` in the Azure Portal.
2. In the left menu under **Settings**, click **Databases**.
3. Click **+ Add** $\rightarrow$ enter Database name: **`confpresence`** $\rightarrow$ click **Save**.

#### Step 1.3: Migrate Data from Render to Azure

Choose **Option A** (if starting clean with schemas) or **Option B** (if migrating existing live data from Render):

##### Option A: Fresh Schema Migration via Drizzle ORM
Run migrations directly from your local terminal against the Azure PostgreSQL instance:

```powershell
# Set target Azure PostgreSQL connection string
$env:DATABASE_URL = "postgres://xconnectadmin:YourPassword@psql-xconnect-prod.postgres.database.azure.com:5432/confpresence?sslmode=require"

# Execute Drizzle migrations from the repo root
pnpm --filter @confpresence/api db:migrate
```

##### Option B: Full Data Dump & Restore from Render PostgreSQL
If you need to copy existing test data and rooms from Render:

```powershell
# 1. Export entire database dump from Render PostgreSQL
pg_dump "postgres://<render_user>:<render_pass>@<render_host>.render.com/confpresence" -Fc -f render_backup.dump

# 2. Restore dump directly into Azure PostgreSQL Flexible Server
pg_restore -h psql-xconnect-prod.postgres.database.azure.com -U xconnectadmin -d confpresence -v --clean --no-owner --no-privileges render_backup.dump
```

#### Step 1.4: Verify Database Tables
Connect and verify the tables:
```powershell
psql "postgres://xconnectadmin:YourPassword@psql-xconnect-prod.postgres.database.azure.com:5432/confpresence?sslmode=require" -c "\dt"
```
*Expected Tables:* `sessions`, `rooms`, `devices`, `room_membership`, `state_change_events`, `scheduled_events`, `push_subscriptions`, `notification_logs`.

---

## Phase 2: Azure Container Registry (ACR) & Docker Build

### What to do:
Provision a private Azure Container Registry and build the production Docker image directly in the cloud.

### Where to do:
Azure Portal / Local CLI.

### How to do:

#### Step 2.1: Create Container Registry
```powershell
az acr create `
  --resource-group rg-xconnect-prod `
  --name crxconnectprod `
  --sku Basic `
  --admin-enabled true
```

#### Step 2.2: Cloud Build & Push Image
Run this command from the root directory of your workspace (`c:\Users\Admin\Documents\Codex\2026-08-13\XConnect`):

```powershell
# Build and tag image inside ACR directly from local source
az acr build --registry crxconnectprod --image xconnect-api:v1.0.0 .
```

*Verification:*
```powershell
az acr repository list --name crxconnectprod --output table
# Output should list: xconnect-api
```

---

## Phase 3: Azure Container Apps (ACA) Deployment

### What to do:
Deploy the container to Azure Container Apps with ingress enabled, single-replica state management, and environment variables.

### Where to do:
Azure Portal or Azure CLI.

### How to do:

#### Step 3.1: Create Container Apps Environment
```powershell
az containerapp env create `
  --name env-xconnect-prod `
  --resource-group rg-xconnect-prod `
  --location "centralindia"
```

#### Step 3.2: Deploy Container App (`ca-xconnect-api`)
```powershell
# Retrieve ACR admin password
$ACR_PASSWORD = (az acr credential show --name crxconnectprod --query "passwords[0].value" -o tsv)

# Deploy Container App
az containerapp create `
  --name ca-xconnect-api `
  --resource-group rg-xconnect-prod `
  --environment env-xconnect-prod `
  --image crxconnectprod.azurecr.io/xconnect-api:v1.0.0 `
  --registry-server crxconnectprod.azurecr.io `
  --registry-username crxconnectprod `
  --registry-password $ACR_PASSWORD `
  --target-port 3000 `
  --ingress external `
  --cpu 0.5 `
  --memory 1.0Gi `
  --min-replicas 1 `
  --max-replicas 1 `
  --env-vars `
    NODE_ENV=production `
    PORT=3000 `
    DATABASE_URL="postgres://xconnectadmin:YourPassword@psql-xconnect-prod.postgres.database.azure.com:5432/confpresence?sslmode=require" `
    AUTH_AUTHORITY="https://login.microsoftonline.com/common/v2.0"
```

> [!IMPORTANT]
> **Why Min Replicas = 1, Max Replicas = 1?**  
> XConnect's `PocInferenceEngine` maintains connected BLE graph components and sliding windows in memory. Fixed single-instance execution ensures that all polling attendees and presenters communicate with the exact same clustering state.

---

## Phase 4: API Smoke Testing & Diagnostics

### What to do:
Verify that the Azure Container App is live, serving traffic, and communicating with PostgreSQL.

### Where to do:
PowerShell / Terminal / Web Browser.

### How to do:

1. **Obtain the Azure Container App FQDN (URL)**:
   ```powershell
   $APP_URL = (az containerapp show --name ca-xconnect-api --resource-group rg-xconnect-prod --query "properties.configuration.ingress.fqdn" -o tsv)
   Write-Host "Azure API URL: https://$APP_URL"
   ```

2. **Test Health Probe**:
   ```powershell
   curl "https://$APP_URL/health"
   # Expected Output: {"ok":true}
   ```

3. **Test Admin Overview & Database Connectivity**:
   ```powershell
   curl "https://$APP_URL/api/admin/overview"
   # Expected Output: {"rooms":[]}
   ```

4. **Inspect Real-Time Logs**:
   ```powershell
   az containerapp logs show `
     --name ca-xconnect-api `
     --resource-group rg-xconnect-prod `
     --follow
   ```
   *Expected Log Output:*
   ```text
   🚀 ConfPresence POC API listening on http://0.0.0.0:3000
   🗄️  Postgres persistence enabled
   🧹 Closed 0 room(s) left open from before this restart
   ✨ Live Streaming Logs initialized. All connected device events will appear below.
   ```

---

## Phase 5: Mobile App Endpoint Cutover

### What to do:
Update the mobile application codebase to point to the newly deployed Azure Container App endpoint.

### Where to do:
Repository files: `apps/mobile/App.tsx` and `apps/mobile/src/services/presenceService.ts`.

### How to do:

1. In [`App.tsx`](file:///c:/Users/Admin/Documents/Codex/2026-08-13/XConnect/apps/mobile/App.tsx#L35) and [`presenceService.ts`](file:///c:/Users/Admin/Documents/Codex/2026-08-13/XConnect/apps/mobile/src/services/presenceService.ts#L8):
   ```typescript
   // Replace Render URL:
   // const CLOUD_API_URL = "https://xconnect-ytoj.onrender.com";

   // With new Azure Container Apps FQDN:
   const CLOUD_API_URL = "https://ca-xconnect-api.<your-region-id>.azurecontainerapps.io";
   ```

2. **Execute End-to-End Verification Test**:
   - **Device 1 (Presenter Mode):** Open App, start session for `Workshop 1`. Confirm acoustic token broadcast starts and room is registered in Azure PostgreSQL.
   - **Device 2 (Attendee Mode):** Open App in discovery mode. Confirm radar detects `● WORKSHOP 1 DETECTED`.
   - **Headcount Check:** Confirm Presenter screen dynamically updates attendee headcount to `1 VERIFIED ATTENDEES`.
   - **Admin History & Export:** Open Admin screen, verify session duration and telemetry logs, and export PDF report.

---

## Phase 6: Cutover Safeguards & Render Decommissioning

### What to do:
Ensure safe transition without data loss or duplicate infrastructure charges.

### How to do:

1. **48-Hour Parallel Run Window:**
   - Keep Render active for 48 hours while running test sessions on Azure.
   - Monitor Container App memory and CPU metrics in Azure Portal.
2. **Final Database Synchronization:**
   - Verify all test records persist reliably in Azure PostgreSQL.
3. **Decommission Render Services:**
   - Log in to [dashboard.render.com](https://dashboard.render.com).
   - Go to Web Service `confpresence-api` $\rightarrow$ **Settings** $\rightarrow$ Click **Suspend** or **Delete Web Service**.
   - Go to PostgreSQL `confpresence-db` $\rightarrow$ Download final backup $\rightarrow$ Click **Delete Database**.

---

# 4. Part 4: Critical Technical Safeguards & Best Practices

| Category | Requirement | Technical Rationale |
| :--- | :--- | :--- |
| **SSL Mode** | Always specify `?sslmode=require` in `DATABASE_URL` | Azure Database for PostgreSQL Flexible Server rejects all unencrypted plaintext connections by default. |
| **Port Binding** | Ingress Target Port must be `3000` | Express listens on `PORT=3000` as defined in `Dockerfile` and `backend/src/index.ts`. |
| **Single Replica Constraint** | `minReplicas=1, maxReplicas=1` | Preserves in-memory state of `PocInferenceEngine` without requiring a distributed Redis lock during the current pilot phase. |
| **Database Whitelist** | Add Developer IP under Postgres Firewall | Local CLI migrations (`db:migrate`) will timeout if your current IP is not whitelisted in Azure PostgreSQL Networking. |
| **Monorepo Build** | Use `az acr build` at root | Dockerfile copies root `package.json`, `pnpm-workspace.yaml`, and `packages/shared`. Building from root ensures all dependencies resolve cleanly. |

---

# 5. Part 5: Troubleshooting & Quick FAQ

### Q1: I get `ECONNREFUSED` or `ETIMEDOUT` when running Drizzle migrations locally.
**Fix:** Open Azure Portal $\rightarrow$ `psql-xconnect-prod` $\rightarrow$ **Networking** $\rightarrow$ Click **+ Add current client IP address** $\rightarrow$ Click **Save**. Wait 30 seconds and retry.

### Q2: Container App shows `CrashLoopBackOff` or continuously restarts.
**Fix:**
1. Check logs: `az containerapp logs show -n ca-xconnect-api -g rg-xconnect-prod`.
2. Ensure `DATABASE_URL` has `?sslmode=require` appended.
3. Verify `PORT=3000` is set in the environment variables.

### Q3: ACR says `Authentication required` when deploying ACA.
**Fix:** Ensure `--admin-enabled true` was configured on ACR, or pass `--registry-server`, `--registry-username`, and `--registry-password` during container app creation.

### Q4: How do Krishna and Mohammed collaborate simultaneously?
**Fix:** Since both have `Contributor` access to `rg-xconnect-prod`, both can run `az login` and manage resources independently or inspect live streaming logs simultaneously.

---
*Handcrafted for XConnect / ConfPresence Zero Engineering Team.*  
*File Reference: `docs/AZURE_MIGRATION_README.md`*
