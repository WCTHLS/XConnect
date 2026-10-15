// XConnect backend on Azure Container Apps: registry, log workspace, Container Apps environment,
// the API app, Redis, and Postgres: either an existing Postgres Flexible Server opened to Azure
// services (createPostgres = false, the default) or a new Burstable B1ms server created here
// (createPostgres = true).
//
// The app can't be created until its image is in the registry, so deploy in two passes:
//   1. az deployment group create -g <rg> -p infra/main.local.bicepparam -p deployApp=false
//   2. az acr login --name <acrName>, then docker tag + docker push the image
//   3. the same command as step 1 without deployApp=false
// databaseUrl and postgresAdminPassword are @secure: keep them in the gitignored
// infra/main.local.bicepparam, never on the command line.
//
// With createPostgres = true the DATABASE_URL secret is built from the server, user, password and
// database below, so databaseUrl isn't needed. The new database is empty: run the migrations
// (drizzle-kit migrate) against it once, from a machine whose IP is allowed by clientIpAddress.
// Redis is a separate container app (deployRedis).

@description('Region for every resource except a new Postgres server (see postgresLocation). Ideally the same region as the Postgres server, to keep database latency low.')
param location string = resourceGroup().location

@description('Container registry name: globally unique, lowercase letters and numbers only.')
param acrName string = 'xconnect${uniqueString(resourceGroup().id)}'

param logAnalyticsName string = 'log-xconnect'
param environmentName string = 'env-xconnect'

@description('Resource id of an existing Container Apps environment to run the apps in, from any resource group in this subscription. It must be in the same region as the apps (location). Empty creates a new environment here. Useful where a subscription allows few environments, such as the free trial.')
param existingEnvironmentId string = ''
param appName string = 'xconnect-test'

param imageName string = 'xconnect-test'
param imageTag string = 'v1'

@description('Set to false on the first pass, before the image has been pushed.')
param deployApp bool = true

@description('Run Redis as its own container app so engine state survives a backend restart.')
param deployRedis bool = true

param redisAppName string = 'xconnect-test-redis'

@description('Region for the new Postgres server only (createPostgres = true). Defaults to location, but a subscription can be barred from creating Postgres in some regions (the personal trial is, in East US), so it can be set separately, for example canadacentral.')
param postgresLocation string = location

@description('Postgres Flexible Server name: globally unique (it becomes <name>.postgres.database.azure.com). An existing server when createPostgres is false, the new one when true.')
param postgresServerName string

@description('true creates a Burstable B1ms server named postgresServerName. false uses an existing server in this resource group.')
param createPostgres bool = false

@description('Only used when createPostgres is true. Admin login for the new server.')
param postgresAdminUser string = 'xconnectadmin'

@secure()
@description('Only used when createPostgres is true. Required then: an empty password fails the deployment.')
param postgresAdminPassword string = ''

@description('Only used when createPostgres is true. Database created on the new server.')
param postgresDatabaseName string = 'xconnect'

@allowed([
  '14'
  '15'
  '16'
  '17'
])
@description('Only used when createPostgres is true. Major version of the new server.')
param postgresVersion string = '16'

@description('Optional. Your public IP, to open a firewall rule so you can run migrations or psql from your machine. Empty adds no rule.')
param clientIpAddress string = ''

@secure()
@description('Only used when createPostgres is false: postgres://user:password@<server>.postgres.database.azure.com:5432/postgres?sslmode=require')
param databaseUrl string = ''

// --- Backend settings. All optional: an empty value leaves the variable unset in the container. ---
// Sign-in is on when FIREBASE_PROJECT_ID is set, or when both AUTH_AUTHORITY and AUTH_AUDIENCE are.
// None of these three are secrets (a project id and public token-check settings).

@description('Google sign-in (Firebase): the Firebase project id. Sets FIREBASE_PROJECT_ID.')
param firebaseProjectId string = ''

@description('Microsoft/OpenID sign-in: the authority URL. Sets AUTH_AUTHORITY.')
param authAuthority string = ''

@description('Microsoft/OpenID sign-in: the app registration client id. Sets AUTH_AUDIENCE.')
param authAudience string = ''

@description('Comma-separated admin email addresses. Sets ADMIN_EMAILS.')
param adminEmails string = ''

@description('The company Entra tenant id (a GUID). A Microsoft sign-in from this tenant may become admin by email. Unset means no Microsoft sign-in can; Google sign-in still can. Sets ADMIN_TENANT_ID.')
param adminTenantId string = ''

@description('true creates a Notification Hubs namespace and hub here, and the API gets its connection string automatically. false uses an existing hub: then set notificationHubConnectionString below. Push credentials (Firebase Cloud Messaging for Android, an APNs key for iOS) are not set by this template: add them to the hub in the portal afterwards.')
param createNotificationHub bool = false

@description('Notification Hubs namespace name, only used when createNotificationHub is true. Globally unique: it becomes <name>.servicebus.windows.net. 6 to 50 letters, numbers and hyphens, starting with a letter.')
param notificationNamespaceName string = ''

@allowed([
  'Free'
  'Basic'
  'Standard'
])
@description('Only used when createNotificationHub is true. Free is enough to try it (limited pushes and active devices). Check the current limits and prices before production.')
param notificationHubSku string = 'Free'

@description('Azure Notification Hub name. The name of the hub to create when createNotificationHub is true, otherwise the name of the existing hub. Sets AZURE_NOTIFICATION_HUB_NAME.')
param notificationHubName string = ''

@secure()
@description('Only used when createNotificationHub is false: the existing hub\'s connection string. Stored as a Container Apps secret and passed as AZURE_NOTIFICATION_HUB_CONNECTION_STRING.')
param notificationHubConnectionString string = ''

@description('Postgres connections per API process. Sets DB_POOL_MAX; empty uses the backend default (20).')
param dbPoolMax string = ''

@description('Motion detection sliding window size. Sets MOTION_SLIDING_WINDOW_SIZE; empty uses the backend default.')
param motionSlidingWindowSize string = ''

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

// Created with the apps (deployApp), not in pass 1: pass 1 only needs the registry, and some
// subscriptions (the free trial) allow just one environment in total.
resource env 'Microsoft.App/managedEnvironments@2024-03-01' = if (deployApp && empty(existingEnvironmentId)) {
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

// The connection string the API gets. Built from the new server when createPostgres is true; the
// server name is a global DNS name, so it needs no reference to the resource.
// uriComponent keeps a password with characters like @ or / from breaking the URL.
var postgresHost = '${postgresServerName}.postgres.database.azure.com'
var effectiveDatabaseUrl = createPostgres
  ? 'postgres://${postgresAdminUser}:${uriComponent(postgresAdminPassword)}@${postgresHost}:5432/${postgresDatabaseName}?sslmode=require'
  : databaseUrl

// Plain (non-secret) backend settings, in one list: any with an empty value are dropped, so an
// unset parameter leaves the variable out of the container instead of setting it to "".
var optionalEnv = filter([
  { name: 'FIREBASE_PROJECT_ID', value: firebaseProjectId }
  { name: 'AUTH_AUTHORITY', value: authAuthority }
  { name: 'AUTH_AUDIENCE', value: authAudience }
  { name: 'ADMIN_EMAILS', value: adminEmails }
  { name: 'ADMIN_TENANT_ID', value: adminTenantId }
  { name: 'AZURE_NOTIFICATION_HUB_NAME', value: notificationHubName }
  { name: 'DB_POOL_MAX', value: dbPoolMax }
  { name: 'MOTION_SLIDING_WINDOW_SIZE', value: motionSlidingWindowSize }
], setting => !empty(setting.value))

// The connection string is a secret, so it's a Container Apps secret plus a secretRef env var, and
// only exists when there is one (an empty secret value is rejected by Container Apps). It comes
// from the hub created below, or from the parameter for an existing hub.
var hasNotificationSecret = createNotificationHub || !empty(notificationHubConnectionString)
var notificationEnv = hasNotificationSecret ? [
  {
    name: 'AZURE_NOTIFICATION_HUB_CONNECTION_STRING'
    secretRef: 'notification-hub-connection'
  }
] : []

// --- Push notifications: a Notification Hubs namespace and hub (createNotificationHub = true). ---
// A module, not three resources here: the app reads the hub's connection string, and a direct
// dependency on a conditional resource whose names are empty (when no hub is created) is rejected
// by Azure as a malformed resource id. The phone-platform credentials (FCM, APNs) live on the hub
// itself and are added in the portal.
module notificationHubModule 'notificationhub.bicep' = if (createNotificationHub) {
  name: 'notification-hub'
  params: {
    location: location
    namespaceName: notificationNamespaceName
    hubName: notificationHubName
    sku: notificationHubSku
  }
}

// A reference to the access rule the module creates, only to read its key. `existing` adds no
// dependency of its own, so the app waits for the module explicitly (dependsOn below) instead.
resource notificationRule 'Microsoft.NotificationHubs/namespaces/notificationHubs/authorizationRules@2023-09-01' existing = if (createNotificationHub) {
  name: '${notificationNamespaceName}/${notificationHubName}/xconnect-api'
}

// --- New server: Burstable B1ms, 32 GiB (the smallest disk), no high availability. ---
// Storage auto-grow stays off: it can't be undone, and a year of data is well under the 32 GiB.
// LRS backups, 7 days of point-in-time restore. Public access with firewall rules (below), the
// same model as the existing server.
resource postgresNew 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = if (createPostgres) {
  name: postgresServerName
  location: postgresLocation
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    version: postgresVersion
    administratorLogin: postgresAdminUser
    administratorLoginPassword: postgresAdminPassword
    storage: {
      storageSizeGB: 32
      autoGrow: 'Disabled'
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
    network: {
      publicNetworkAccess: 'Enabled'
    }
  }
}

resource postgresNewDb 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = if (createPostgres) {
  parent: postgresNew
  name: postgresDatabaseName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

// Firewall rules on a new server are created one at a time: Azure rejects them in parallel.
// 0.0.0.0-0.0.0.0 is Azure's special rule for "any Azure service". Needed because a
// Consumption-plan Container App has no fixed outbound IP to allowlist instead.
resource postgresNewAllowAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = if (createPostgres) {
  parent: postgresNew
  name: 'AllowAllAzureServices'
  dependsOn: [
    postgresNewDb
  ]
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource postgresNewAllowClient 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = if (createPostgres && !empty(clientIpAddress)) {
  parent: postgresNew
  name: 'AllowClient'
  dependsOn: [
    postgresNewAllowAzure
  ]
  properties: {
    startIpAddress: clientIpAddress
    endIpAddress: clientIpAddress
  }
}

// --- Existing server (createPostgres = false): only adds the firewall rule. ---
resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2022-12-01' existing = {
  name: postgresServerName
}

resource postgresAllowAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2022-12-01' = if (!createPostgres) {
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
    managedEnvironmentId: empty(existingEnvironmentId) ? env!.id : existingEnvironmentId
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
    postgresNewDb
    postgresNewAllowAzure
    notificationHubModule
  ]
  properties: {
    managedEnvironmentId: empty(existingEnvironmentId) ? env!.id : existingEnvironmentId
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
      secrets: concat([
        {
          name: 'acr-password'
          value: acr.listCredentials().passwords[0].value
        }
        {
          name: 'database-url'
          value: effectiveDatabaseUrl
        }
      ], hasNotificationSecret ? [
        {
          name: 'notification-hub-connection'
          value: createNotificationHub ? notificationRule!.listKeys().primaryConnectionString : notificationHubConnectionString
        }
      ] : [])
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
          ] : [], optionalEnv, notificationEnv)
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
output postgresHost string = postgresHost
output apiUrl string = deployApp ? 'https://${app!.properties.configuration.ingress.fqdn}' : ''
