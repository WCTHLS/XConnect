// XConnect backend on Azure Container Apps: registry, log workspace, Container Apps environment,
// the API app, and a firewall rule opening an existing Postgres Flexible Server to Azure services.
//
// The app can't be created until its image is in the registry, so deploy in two passes:
//   1. az deployment group create -g <rg> -f infra/main.bicep -p location=<region> postgresServerName=<pg> deployApp=false
//   2. az acr login --name <acrName>, then docker tag + docker push the image
//   3. the same command as step 1 without deployApp=false
// databaseUrl is prompted for (it's @secure), so it never lands in shell history.
//
// Not included yet: Redis. Without REDIS_URL the API runs, but engine state won't survive a restart.

@description('Region for every resource. Keep it the same as the Postgres server.')
param location string = resourceGroup().location

@description('Container registry name: globally unique, lowercase letters and numbers only.')
param acrName string = 'xconnect${uniqueString(resourceGroup().id)}'

param logAnalyticsName string = 'log-xconnect'
param environmentName string = 'env-xconnect'
param appName string = 'xconnect-test'

param imageName string = 'xconnect-test'
param imageTag string = 'v1'

@description('Set to false on the first pass, before the image has been pushed.')
param deployApp bool = true

@description('Run Redis as its own container app so engine state survives a backend restart.')
param deployRedis bool = true

param redisAppName string = 'xconnect-test-redis'

@description('Existing Postgres Flexible Server in this resource group.')
param postgresServerName string

@secure()
@description('postgres://user:password@<server>.postgres.database.azure.com:5432/postgres?sslmode=require')
param databaseUrl string

@description('vCPUs for the API. The backend is one Node process, so it gains little beyond 1.')
@allowed([
  '0.5'
  '1.0'
  '2.0'
])
param cpu string = '1.0'

// Consumption-plan Container Apps require memory to be exactly 2 GiB per vCPU.
var memoryByCpu = {
  '0.5': '1Gi'
  '1.0': '2Gi'
  '2.0': '4Gi'
}

resource logs 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: logAnalyticsName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: true
  }
}

resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: environmentName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2022-12-01' existing = {
  name: postgresServerName
}

// 0.0.0.0-0.0.0.0 is Azure's special rule for "any Azure service". Needed because a
// Consumption-plan Container App has no fixed outbound IP to allowlist instead.
resource postgresAllowAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2022-12-01' = {
  parent: postgres
  name: 'AllowAllAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

// A separate app from the API on purpose: deploying or restarting the API replaces its own
// containers, and a Redis inside it would be wiped at the exact moment the API needs to restore
// from it. External: false makes it reachable only from other apps in this environment, by name.
resource redisApp 'Microsoft.App/containerApps@2024-03-01' = if (deployApp && deployRedis) {
  name: redisAppName
  location: location
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: false
        targetPort: 6379
        transport: 'tcp'
      }
    }
    template: {
      containers: [
        {
          name: 'redis'
          image: 'redis:7-alpine'
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

resource app 'Microsoft.App/containerApps@2024-03-01' = if (deployApp) {
  name: appName
  location: location
  dependsOn: [
    redisApp
  ]
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
      }
      registries: [
        {
          server: acr.properties.loginServer
          username: acr.listCredentials().username
          passwordSecretRef: 'acr-password'
        }
      ]
      secrets: [
        {
          name: 'acr-password'
          value: acr.listCredentials().passwords[0].value
        }
        {
          name: 'database-url'
          value: databaseUrl
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'api'
          image: '${acr.properties.loginServer}/${imageName}:${imageTag}'
          resources: {
            cpu: json(cpu)
            memory: memoryByCpu[cpu]
          }
          env: concat([
            {
              name: 'PORT'
              value: '3000'
            }
            {
              name: 'NODE_ENV'
              value: 'production'
            }
            {
              name: 'DATABASE_URL'
              secretRef: 'database-url'
            }
          ], deployRedis ? [
            {
              name: 'REDIS_URL'
              value: 'redis://${redisAppName}:6379'
            }
          ] : [])
        }
      ]
      // Exactly one copy: rooms and the 2s tick live in this process's memory, so zero copies
      // loses live sessions and two copies would each track different rooms.
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

output acrLoginServer string = acr.properties.loginServer
output apiUrl string = deployApp ? 'https://${app!.properties.configuration.ingress.fqdn}' : ''
