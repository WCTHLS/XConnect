// A Notification Hubs namespace and hub, plus an access rule for the API. Its own module so main.bicep
// can create it only when createNotificationHub is true without depending on these names when it
// isn't (an empty namespace name made the app's dependency on the rule a malformed resource id).
//
// The phone-platform credentials (Firebase Cloud Messaging for Android, an APNs key for iOS) are
// not set here: add them to the hub in the portal afterwards.

param location string

@description('Globally unique: it becomes <name>.servicebus.windows.net. 6 to 50 letters, numbers and hyphens, starting with a letter.')
param namespaceName string

param hubName string

@allowed([
  'Free'
  'Basic'
  'Standard'
])
param sku string = 'Free'

resource namespace 'Microsoft.NotificationHubs/namespaces@2023-09-01' = {
  name: namespaceName
  location: location
  sku: {
    name: sku
  }
  properties: {
    namespaceType: 'NotificationHub'
  }
}

resource hub 'Microsoft.NotificationHubs/namespaces/notificationHubs@2023-09-01' = {
  parent: namespace
  name: hubName
  location: location
  properties: {}
}

// The same rights as the default full-access rule: Listen, Send, Manage. main.bicep reads this
// rule's key by name ('xconnect-api'), since Bicep won't pass a secure module output through the
// secrets array.
resource rule 'Microsoft.NotificationHubs/namespaces/notificationHubs/authorizationRules@2023-09-01' = {
  parent: hub
  name: 'xconnect-api'
  properties: {
    rights: [
      'Listen'
      'Send'
      'Manage'
    ]
  }
}
