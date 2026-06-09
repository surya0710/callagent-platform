export const PERMISSIONS = {
  USERS_READ: 'users.read',
  USERS_WRITE: 'users.write',
  CUSTOMERS_READ: 'customers.read',
  CUSTOMERS_WRITE: 'customers.write',
  CAMPAIGNS_READ: 'campaigns.read',
  CAMPAIGNS_WRITE: 'campaigns.write',
  CALLS_READ: 'calls.read',
  CALLS_WRITE: 'calls.write',
  ANALYTICS_READ: 'analytics.read',
  SETTINGS_WRITE: 'settings.write',
  TRAINING_READ: 'training.read',
  TRAINING_WRITE: 'training.write',
} as const;

export type PermissionName = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
