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
  { name: 'training.read', description: 'View training recordings, datasets, and jobs' },
  { name: 'training.write', description: 'Manage training data and fine-tuning jobs' },
  { name: 'knowledge_base.read', description: 'View knowledge base entries' },
  { name: 'knowledge_base.write', description: 'Manage knowledge base entries' },
  { name: 'tickets.read', description: 'View support tickets' },
  { name: 'tickets.write', description: 'Manage support tickets' },
  { name: 'cx_agent.read', description: 'View CX agent examples and configuration' },
  { name: 'cx_agent.write', description: 'Run CX agent simulations and manage examples' },
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
      'training.read',
      'training.write',
      'knowledge_base.read',
      'knowledge_base.write',
      'tickets.read',
      'tickets.write',
      'cx_agent.read',
      'cx_agent.write',
    ],
  },
  agent: {
    description: 'View customers and calls',
    permissions: [
      'customers.read',
      'calls.read',
      'analytics.read',
      'training.read',
      'knowledge_base.read',
      'tickets.read',
      'cx_agent.read',
    ],
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

const CX_DEPARTMENT = 'customer_experience';

async function seedCustomerExperienceKnowledgeBase() {
  const entries = [
    {
      title: 'Post-Trip Feedback Call Script',
      category: 'scripts',
      tags: ['feedback', 'greeting', 'flow'],
      content:
        'Greet the customer by name. Confirm the recent trip date and route if available. Ask one open question about their experience. Listen without interrupting. If positive, thank them and close. If negative, empathize and ask one follow-up before offering ticket or executive callback.',
    },
    {
      title: 'Issue Categories Reference',
      category: 'issue_categories',
      tags: ['classification', 'issues'],
      content:
        'Categories: driver_behavior (rude, unsafe driving), vehicle_cleanliness, late_pickup, billing_issue (overcharge, wrong fare), route_issue, safety_concern, lost_item, app_booking_issue, general_feedback, other.',
    },
    {
      title: 'Ticket Creation Rules',
      category: 'ticket_rules',
      tags: ['ticket', 'escalation'],
      content:
        'Create a ticket when the customer confirms they want one, or when an unresolved issue needs follow-up. Set priority: critical for safety, high for billing/executive requests, medium for service issues, low for general feedback.',
    },
    {
      title: 'Executive Handoff Rules',
      category: 'handoff_rules',
      tags: ['executive', 'callback'],
      content:
        'Offer executive callback when the customer asks to speak with a manager, is upset after an issue, or requests human support. Do not promise exact callback time; say a team member will reach out shortly.',
    },
    {
      title: 'Refund and Escalation Policy',
      category: 'policies',
      tags: ['refund', 'escalation'],
      content:
        'Do not promise refunds on the call. Note the concern and escalate to the billing team via ticket. Safety concerns must be escalated immediately with critical priority.',
    },
  ];

  for (const entry of entries) {
    const existing = await prisma.knowledgeBaseEntry.findFirst({
      where: { title: entry.title, department: CX_DEPARTMENT },
    });

    if (!existing) {
      await prisma.knowledgeBaseEntry.create({
        data: {
          title: entry.title,
          content: entry.content,
          department: CX_DEPARTMENT,
          category: entry.category,
          tags: entry.tags,
        },
      });
    }
  }
}

async function seedCustomerExperienceExamples() {
  const examples = [
    {
      title: 'Positive feedback - smooth trip',
      summary: 'Customer had a great trip, no issues reported.',
      goodPractices:
        'Warm greeting, confirm trip, single open question, positive acknowledgment, polite close.',
      transcript: `Agent: Hello Mr. Sharma, this is Priya from customer experience. I am calling about your trip yesterday from Koramangala to the airport. Do you have a minute?
Customer: Yes, sure.
Agent: How was your overall experience?
Customer: It was great, the driver was on time and the car was clean.
Agent: That is wonderful to hear. Thank you for sharing. Is there anything else you would like us to note?
Customer: No, everything was fine.
Agent: Thank you for your time. Have a great day!`,
      tags: ['positive', 'no_issue'],
    },
    {
      title: 'Late pickup issue with ticket offer',
      summary: 'Customer reports late pickup; agent gathers details and offers ticket.',
      goodPractices:
        'Empathize first, ask one follow-up, classify issue, offer ticket without pressure.',
      transcript: `Agent: Hello, I am calling about your recent trip. How did everything go?
Customer: The driver was 20 minutes late. I almost missed my meeting.
Agent: I am sorry to hear that. That must have been stressful. Was the driver in contact with you during the wait?
Customer: No, I had to call support.
Agent: Thank you for explaining. Would you like me to create a ticket so our team can review this?
Customer: Yes, please do.
Agent: I have noted the late pickup issue. Our team will follow up with you. Is there anything else?
Customer: No, that is all.`,
      tags: ['late_pickup', 'ticket'],
    },
    {
      title: 'Billing concern - executive callback',
      summary: 'Customer disputes fare; agent offers executive callback.',
      goodPractices:
        'Do not promise refund on call, acknowledge concern, offer human follow-up.',
      transcript: `Agent: Hello, I am following up on your completed trip. How was your experience?
Customer: The trip was fine but I was charged twice.
Agent: I understand that is frustrating. I want to make sure we look into this properly. Would you like an executive to call you back about the billing?
Customer: Yes, I want someone to call me.
Agent: Absolutely. I will arrange a callback from our team. They will reach out shortly. Thank you for your patience.`,
      tags: ['billing_issue', 'executive'],
    },
  ];

  for (const example of examples) {
    const existing = await prisma.conversationExample.findFirst({
      where: { title: example.title, department: CX_DEPARTMENT },
    });

    if (!existing) {
      await prisma.conversationExample.create({
        data: {
          title: example.title,
          department: CX_DEPARTMENT,
          transcript: example.transcript,
          summary: example.summary,
          goodPractices: example.goodPractices,
          tags: example.tags,
          isApproved: true,
        },
      });
    }
  }
}

async function main() {
  await seedPermissions();
  await seedRoles();
  await seedDefaultAgentPrompt();
  await seedSystemSettings();
  await seedCustomerExperienceKnowledgeBase();
  await seedCustomerExperienceExamples();
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
