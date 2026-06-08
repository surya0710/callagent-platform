import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const DEV_INTEGRATION_API_KEY =
  'avp_dev_driver_service_key_change_in_production';

const DEFAULT_PERMISSIONS = [
  { name: 'users.read', description: 'View users' },
  { name: 'users.write', description: 'Create and update users' },
  { name: 'customers.read', description: 'View customers' },
  { name: 'customers.write', description: 'Create and update customers' },
  { name: 'campaigns.read', description: 'View campaigns' },
  { name: 'campaigns.write', description: 'Create and update campaigns' },
  { name: 'calls.read', description: 'View calls' },
  { name: 'calls.write', description: 'Manage calls' },
  { name: 'analytics.read', description: 'View analytics' },
  { name: 'settings.write', description: 'Manage system settings' },
] as const;

const DEFAULT_ROLES: Record<
  string,
  { description: string; permissions: string[] }
> = {
  admin: {
    description: 'Full system access',
    permissions: DEFAULT_PERMISSIONS.map((p) => p.name),
  },
  manager: {
    description: 'Manage campaigns, customers, and calls',
    permissions: [
      'customers.read',
      'customers.write',
      'campaigns.read',
      'campaigns.write',
      'calls.read',
      'calls.write',
      'analytics.read',
    ],
  },
  agent: {
    description: 'View customers and calls',
    permissions: ['customers.read', 'calls.read', 'analytics.read'],
  },
};

async function seedPermissions() {
  for (const permission of DEFAULT_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { name: permission.name },
      update: { description: permission.description },
      create: permission,
    });
  }
}

async function seedRoles() {
  const allPermissions = await prisma.permission.findMany();

  for (const [roleName, roleConfig] of Object.entries(DEFAULT_ROLES)) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: { description: roleConfig.description },
      create: {
        name: roleName,
        description: roleConfig.description,
      },
    });

    const permissionIds = allPermissions
      .filter((p) => roleConfig.permissions.includes(p.name))
      .map((p) => p.id);

    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });

    for (const permissionId of permissionIds) {
      await prisma.rolePermission.create({
        data: { roleId: role.id, permissionId },
      });
    }
  }
}

async function seedDefaultAgentPrompt() {
  const existing = await prisma.agentPrompt.findFirst({
    where: { isActive: true },
  });

  if (existing) {
    return;
  }

  await prisma.agentPrompt.create({
    data: {
      name: 'Default Outbound Agent',
      description: 'Default AI voice agent for outbound calls',
      systemPrompt:
        'You are a professional outbound calling agent. Be concise, polite, and helpful. Follow compliance rules and never share sensitive data.',
      isActive: true,
      version: 1,
    },
  });
}

async function seedSystemSettings() {
  await prisma.systemSetting.upsert({
    where: { key: 'platform.initialized' },
    update: {},
    create: {
      key: 'platform.initialized',
      value: { seededAt: new Date().toISOString() },
    },
  });
}

async function seedDevIntegrationApiKey() {
  const keyPrefix = DEV_INTEGRATION_API_KEY.slice(0, 12);
  const keyHash = await bcrypt.hash(DEV_INTEGRATION_API_KEY, 10);

  await prisma.apiKey.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: { name: 'Driver Service (Dev)', keyPrefix, keyHash, isActive: true },
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Driver Service (Dev)',
      keyPrefix,
      keyHash,
    },
  });

  console.log('Dev integration API key (local only):');
  console.log(DEV_INTEGRATION_API_KEY);
}

function shouldSeedDevIntegrationApiKey() {
  const explicitValue = process.env.SEED_DEV_INTEGRATION_API_KEY;

  if (explicitValue !== undefined) {
    return explicitValue === 'true';
  }

  return false;
}

async function main() {
  await seedPermissions();
  await seedRoles();
  await seedDefaultAgentPrompt();
  await seedSystemSettings();
  if (shouldSeedDevIntegrationApiKey()) {
    await seedDevIntegrationApiKey();
  } else {
    console.log('Skipping dev integration API key seed.');
  }
  console.log('Database seed completed.');
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
