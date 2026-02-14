import React from 'react';
import { describe, expect, test } from 'bun:test';
import { render } from 'ink';
import { PassThrough } from 'stream';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getSecurityLogger } from '@hasna/assistants-core';
import { DEFAULT_MODEL } from '@hasna/assistants-shared';

const { LogsPanel } = await import('../src/components/LogsPanel');
const { SecretsPanel } = await import('../src/components/SecretsPanel');
const { WorkspacePanel } = await import('../src/components/WorkspacePanel');
const { SkillsPanel } = await import('../src/components/SkillsPanel');
const { IdentityPanel } = await import('../src/components/IdentityPanel');
const { BudgetPanel } = await import('../src/components/BudgetPanel');
const { BudgetsPanel } = await import('../src/components/BudgetsPanel');
const { ModelPanel } = await import('../src/components/ModelPanel');
const { ProjectsPanel } = await import('../src/components/ProjectsPanel');
const { ConnectorsPanel } = await import('../src/components/ConnectorsPanel');
const { TasksPanel } = await import('../src/components/TasksPanel');
const { SchedulesPanel } = await import('../src/components/SchedulesPanel');
const { HooksPanel } = await import('../src/components/HooksPanel');
const { InboxPanel } = await import('../src/components/InboxPanel');
const { WalletPanel } = await import('../src/components/WalletPanel');
const { PlansPanel } = await import('../src/components/PlansPanel');
const { ConfigPanel } = await import('../src/components/ConfigPanel');
const { GuardrailsPanel } = await import('../src/components/GuardrailsPanel');
const { ResumePanel } = await import('../src/components/ResumePanel');
const { OnboardingPanel } = await import('../src/components/OnboardingPanel');
const { OrdersPanel } = await import('../src/components/OrdersPanel');
const { JobsPanel } = await import('../src/components/JobsPanel');
const { DocsPanel } = await import('../src/components/DocsPanel');
const { TelephonyPanel } = await import('../src/components/TelephonyPanel');

const stripAnsi = (text: string) => text.replace(/\x1B\[[0-9;]*m/g, '');

const createInkTestEnv = () => {
  const stdout = new PassThrough();
  let output = '';
  stdout.on('data', (chunk) => {
    output += String(chunk);
  });
  const stdin = new PassThrough() as any;
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  stdin.ref = () => {};
  stdin.unref = () => {};
  stdin.resume = () => {};
  stdin.pause = () => {};
  return { stdout, stdin, getOutput: () => stripAnsi(output) };
};

const createTelephonyManagerStub = (options: {
  defaultNumber?: string | null;
  defaultSource?: 'config' | 'local' | 'env' | null;
  numbers?: Array<{
    id: string;
    number: string;
    friendlyName: string | null;
    twilioSid: string | null;
    status: 'active';
    capabilities: { voice: boolean; sms: boolean; whatsapp: boolean };
    createdAt: string;
    updatedAt: string;
  }>;
} = {}) => {
  let status = {
    enabled: true,
    twilioConfigured: true,
    elevenLabsConfigured: false,
    phoneNumbers: options.numbers?.length ?? 0,
    activeCalls: 0,
    routingRules: 0,
    recentCalls: 0,
    recentMessages: 0,
    defaultPhoneNumber: options.defaultNumber ?? null,
    defaultPhoneNumberSource: options.defaultSource ?? null,
  };

  return {
    getStatus: () => status,
    getCallHistory: () => [],
    getSmsHistory: () => [],
    listPhoneNumbers: () => options.numbers ?? [],
    listRoutingRules: () => [],
    setDefaultPhoneNumber: (number: string) => {
      status = {
        ...status,
        defaultPhoneNumber: number,
        defaultPhoneNumberSource: 'local',
      };
      return { success: true, message: `Default phone number set to ${number}.` };
    },
    sendSms: async () => ({ success: true, message: 'ok' }),
    makeCall: async () => ({ success: true, message: 'ok' }),
  };
};

const setupIsolatedSecurityLog = () => {
  const logger = getSecurityLogger();
  const tempDir = mkdtempSync(join(tmpdir(), 'assistants-logs-panel-'));
  logger.setLogFile(join(tempDir, 'security.log'));
  logger.clear();
  return () => {
    logger.clear();
    rmSync(tempDir, { recursive: true, force: true });
  };
};

describe('terminal panels', () => {
  test('LogsPanel renders empty state', async () => {
    const cleanup = setupIsolatedSecurityLog();
    try {
      const env = createInkTestEnv();
      const instance = render(<LogsPanel onCancel={() => {}} />, { stdout: env.stdout, stdin: env.stdin });
      await new Promise((resolve) => setTimeout(resolve, 0));
      const frame = env.getOutput();
      expect(frame).toContain('Security Logs');
      expect(frame).toContain('No security events recorded.');
      instance.unmount();
    } finally {
      cleanup();
    }
  });

  test('LogsPanel renders list entry when events exist', async () => {
    const cleanup = setupIsolatedSecurityLog();
    try {
      const logger = getSecurityLogger();
      logger.log({
        eventType: 'blocked_command',
        severity: 'high',
        sessionId: 's1',
        details: { reason: 'Blocked command pattern: rm -rf /', command: 'rm -rf /', tool: 'bash' },
      });
      const env = createInkTestEnv();
      const instance = render(<LogsPanel onCancel={() => {}} />, { stdout: env.stdout, stdin: env.stdin });
      await new Promise((resolve) => setTimeout(resolve, 0));
      const frame = env.getOutput();
      expect(frame).toContain('Security Logs');
      expect(frame).toContain('blocked_command');
      instance.unmount();
    } finally {
      cleanup();
    }
  });

  test('LogsPanel refreshes while open', async () => {
    const cleanup = setupIsolatedSecurityLog();
    try {
      const logger = getSecurityLogger();
      const env = createInkTestEnv();
      const instance = render(<LogsPanel onCancel={() => {}} />, { stdout: env.stdout, stdin: env.stdin });
      await new Promise((resolve) => setTimeout(resolve, 0));
      let frame = env.getOutput();
      expect(frame).toContain('No security events recorded.');

      logger.log({
        eventType: 'validation_failure',
        severity: 'medium',
        sessionId: 's-refresh',
        details: { reason: 'bad input' },
      });

      env.stdin.write('r');
      const started = Date.now();
      while (Date.now() - started < 1200) {
        frame = env.getOutput();
        if (frame.includes('validation_failure')) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(frame).toContain('validation_failure');
      instance.unmount();
    } finally {
      cleanup();
    }
  });

  test('SecretsPanel renders empty state', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <SecretsPanel
        secrets={[]}
        onGet={async () => ''}
        onAdd={async () => {}}
        onDelete={async () => {}}
        onClose={() => {}}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Secrets');
    expect(frame).toContain('No secrets stored.');
    instance.unmount();
  });

  test('WorkspacePanel renders empty state', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <WorkspacePanel
        workspaces={[]}
        onArchive={async () => {}}
        onDelete={async () => {}}
        onClose={() => {}}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Workspaces');
    expect(frame).toContain('No workspaces found.');
    instance.unmount();
  });

  test('ProjectsPanel renders empty state and new project option', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <ProjectsPanel
        projects={[]}
        onSelect={() => {}}
        onCreate={async () => {}}
        onDelete={async () => {}}
        onViewPlans={() => {}}
        onCancel={() => {}}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Projects');
    expect(frame).toContain('No projects yet. Press n to create one.');
    expect(frame).toContain('New project');
    instance.unmount();
  });

  test('ConnectorsPanel renders empty state', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <ConnectorsPanel
        connectors={[]}
        onCheckAuth={async () => ({ authenticated: false })}
        onClose={() => {}}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Connectors');
    expect(frame).toContain('No connectors found.');
    instance.unmount();
  });

  test('ConnectorsPanel remains interactive while navigating and searching', async () => {
    const env = createInkTestEnv();
    let closed = false;
    const instance = render(
      <ConnectorsPanel
        connectors={[
          {
            name: 'alpha',
            cli: 'connect-alpha',
            description: 'Alpha connector',
            commands: [
              { name: 'help', description: 'Show help', args: [], options: [] },
              { name: 'sync', description: 'Sync data', args: [], options: [] },
            ],
          } as any,
          {
            name: 'beta',
            cli: 'connect-beta',
            description: 'Beta connector',
            commands: [
              { name: 'help', description: 'Show help', args: [], options: [] },
            ],
          } as any,
        ]}
        onCheckAuth={async () => ({ authenticated: true })}
        onClose={() => {
          closed = true;
        }}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    let frame = env.getOutput();
    expect(frame).toContain('alpha');
    expect(frame).toContain('beta');

    env.stdin.write('q'); // quit panel
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(closed).toBe(true);

    instance.unmount();
  });

  test('TelephonyPanel shows quick setup and default number', async () => {
    const env = createInkTestEnv();
    const manager = createTelephonyManagerStub({
      defaultNumber: '+15550001111',
      defaultSource: 'local',
    });
    const instance = render(
      <TelephonyPanel manager={manager as any} onClose={() => {}} />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    // Wait for useEffect to run and trigger re-render
    const started = Date.now();
    let frame = env.getOutput();
    while (Date.now() - started < 800) {
      frame = env.getOutput();
      if (frame.includes('Quick Setup')) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(frame).toContain('Communication');
    expect(frame).toContain('Quick Setup');
    expect(frame).toContain('+15550001111');
    instance.unmount();
  });

  test('TelephonyPanel highlights default number in numbers tab', async () => {
    const env = createInkTestEnv();
    const manager = createTelephonyManagerStub({
      defaultNumber: '+15550002222',
      defaultSource: 'local',
      numbers: [
        {
          id: 'ph-1',
          number: '+15550002222',
          friendlyName: 'Main',
          twilioSid: 'sid',
          status: 'active',
          capabilities: { voice: true, sms: true, whatsapp: false },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    const instance = render(
      <TelephonyPanel manager={manager as any} onClose={() => {}} />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    env.stdin.write('4');
    const started = Date.now();
    let frame = env.getOutput();
    while (Date.now() - started < 800) {
      frame = env.getOutput();
      if (frame.includes('★')) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(frame).toContain('★');
    expect(frame).toContain('default');
    instance.unmount();
  });

  test('TelephonyPanel sets default number with d key', async () => {
    const env = createInkTestEnv();
    const manager = createTelephonyManagerStub({
      numbers: [
        {
          id: 'ph-1',
          number: '+15550003333',
          friendlyName: null,
          twilioSid: 'sid',
          status: 'active',
          capabilities: { voice: true, sms: true, whatsapp: false },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    const instance = render(
      <TelephonyPanel manager={manager as any} onClose={() => {}} />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    env.stdin.write('4');
    await new Promise((resolve) => setTimeout(resolve, 20));
    env.stdin.write('d');
    const started = Date.now();
    let frame = env.getOutput();
    while (Date.now() - started < 800) {
      frame = env.getOutput();
      if (frame.includes('Default phone number set to +15550003333')) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(frame).toContain('Default phone number set to +15550003333');
    instance.unmount();
  });

  test('ConnectorsPanel does not auto-enter search mode when typing letters', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <ConnectorsPanel
        connectors={[
          {
            name: 'alpha',
            cli: 'connect-alpha',
            description: 'Alpha connector',
            commands: [{ name: 'help', description: 'Show help', args: [], options: [] }],
          } as any,
        ]}
        onCheckAuth={async () => ({ authenticated: true })}
        onClose={() => {}}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    env.stdin.write('a');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).not.toContain('Search:');
    expect(frame).toContain('Connectors');

    instance.unmount();
  });

  test('TasksPanel renders empty state', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <TasksPanel
        tasks={[]}
        paused={false}
        onAdd={async () => {}}
        onDelete={async () => {}}
        onRun={async () => {}}
        onClearPending={async () => {}}
        onClearCompleted={async () => {}}
        onTogglePause={async () => {}}
        onChangePriority={async () => {}}
        onClose={() => {}}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Tasks');
    expect(frame).toContain('No tasks yet. Press n to add one.');
    instance.unmount();
  });

  test('SchedulesPanel renders empty state', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <SchedulesPanel
        schedules={[]}
        sessionId="s1"
        onPause={async () => {}}
        onResume={async () => {}}
        onDelete={async () => {}}
        onRun={async () => {}}
        onCreate={async () => {}}
        onRefresh={async () => {}}
        onClose={() => {}}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Schedules');
    expect(frame).toContain('No schedules. Press n to create one.');
    instance.unmount();
  });

  test('HooksPanel renders empty state', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <HooksPanel
        hooks={{} as any}
        nativeHooks={[]}
        onToggle={() => {}}
        onToggleNative={() => {}}
        onDelete={async () => {}}
        onAdd={async () => {}}
        onCancel={() => {}}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Hooks');
    expect(frame).toContain('No hooks configured.');
    instance.unmount();
  });

  test('ResumePanel renders empty state', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <ResumePanel
        sessions={[]}
        activeCwd="/tmp"
        initialFilter="cwd"
        onResume={() => {}}
        onRefresh={async () => {}}
        onClose={() => {}}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Resume Sessions');
    expect(frame).toContain('No saved sessions for this folder.');
    instance.unmount();
  });

  test('InboxPanel renders empty state', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <InboxPanel
        emails={[]}
        onRead={async () => ({}) as any}
        onDelete={async () => {}}
        onFetch={async () => 0}
        onMarkRead={async () => {}}
        onMarkUnread={async () => {}}
        onReply={() => {}}
        onClose={() => {}}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Inbox');
    expect(frame).toContain('No emails in inbox.');
    instance.unmount();
  });

  test('WalletPanel renders empty state', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <WalletPanel
        cards={[]}
        onGet={async () => ({ id: 'c1', name: 'Test', last4: '0000' })}
        onAdd={async () => {}}
        onRemove={async () => {}}
        onClose={() => {}}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Wallet');
    expect(frame).toContain('No cards stored in wallet.');
    instance.unmount();
  });

  test('PlansPanel renders empty state', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <PlansPanel
        project={{ id: 'p1', name: 'Demo', plans: [], context: [], description: '', createdAt: 0, updatedAt: 0 } as any}
        onCreatePlan={async () => {}}
        onDeletePlan={async () => {}}
        onAddStep={async () => {}}
        onUpdateStep={async () => {}}
        onRemoveStep={async () => {}}
        onBack={() => {}}
        onClose={() => {}}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Plans for "Demo"');
    expect(frame).toContain('No plans yet. Press n to create one.');
    instance.unmount();
  });

  test('ConfigPanel renders overview', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <ConfigPanel
        config={{ llm: { model: DEFAULT_MODEL, maxTokens: 8192 } } as any}
        userConfig={null}
        projectConfig={null}
        localConfig={null}
        onSave={async () => {}}
        onCancel={() => {}}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Configuration');
    expect(frame).toContain('Configuration Overview');
    instance.unmount();
  });

  test('GuardrailsPanel renders overview', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <GuardrailsPanel
        config={{ enabled: false, defaultAction: 'allow' } as any}
        policies={[]}
        onToggleEnabled={() => {}}
        onTogglePolicy={() => {}}
        onSetPreset={() => {}}
        onAddPolicy={() => {}}
        onRemovePolicy={() => {}}
        onUpdatePolicy={() => {}}
        onCancel={() => {}}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Guardrails');
    expect(frame).toContain('Disabled');
    instance.unmount();
  });

  test('SkillsPanel renders empty list state', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <SkillsPanel
        skills={[]}
        onExecute={() => {}}
        onCreate={async () => ({ success: true })}
        onDelete={async () => {}}
        onRefresh={async () => []}
        onEnsureContent={async () => null}
        onClose={() => {}}
        cwd="/tmp"
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Skills');
    expect(frame).toContain('No skills loaded. Press n to create one.');
    instance.unmount();
  });

  test('SkillsPanel renders grouped skills', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <SkillsPanel
        skills={[
          { name: 'alpha', description: 'Project skill', filePath: '/tmp/.assistants/skills/alpha.md' } as any,
          { name: 'beta', description: 'Global skill', filePath: '/Users/me/.assistants/shared/skills/beta.md' } as any,
        ]}
        onExecute={() => {}}
        onCreate={async () => ({ success: true })}
        onDelete={async () => {}}
        onRefresh={async () => []}
        onEnsureContent={async () => null}
        onClose={() => {}}
        cwd="/tmp"
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Project Skills');
    expect(frame).toContain('Global Skills');
    expect(frame).toContain('alpha');
    expect(frame).toContain('beta');
    instance.unmount();
  });

  test('IdentityPanel renders empty state', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <IdentityPanel
        identities={[]}
        templates={[]}
        onSwitch={async () => {}}
        onCreate={async () => {}}
        onCreateFromTemplate={async () => {}}
        onUpdate={async () => {}}
        onSetDefault={async () => {}}
        onDelete={async () => {}}
        onClose={() => {}}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Identities');
    expect(frame).toContain('No identities found.');
    instance.unmount();
  });

  test('IdentityPanel renders identity list', async () => {
    const env = createInkTestEnv();
    const identity = {
      id: 'id-1',
      name: 'primary',
      isDefault: true,
      profile: {
        displayName: 'Ada Lovelace',
        title: 'Engineer',
        company: 'Analytical Engines',
        timezone: 'UTC',
        locale: 'en-US',
      },
      contacts: {
        emails: [{ value: 'ada@example.com', isPrimary: true }],
        phones: [],
        addresses: [],
        virtualAddresses: [],
      },
      preferences: {
        language: 'en',
        dateFormat: 'YYYY-MM-DD',
        communicationStyle: 'professional',
        responseLength: 'balanced',
        custom: {},
      },
      context: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const instance = render(
      <IdentityPanel
        identities={[identity as any]}
        activeIdentityId="id-1"
        templates={[]}
        onSwitch={async () => {}}
        onCreate={async () => {}}
        onCreateFromTemplate={async () => {}}
        onUpdate={async () => {}}
        onSetDefault={async () => {}}
        onDelete={async () => {}}
        onClose={() => {}}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Identities');
    expect(frame).toContain('Ada Lovelace');
    instance.unmount();
  });

  test('BudgetPanel renders overview with usage', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <BudgetPanel
        config={{
          enabled: true,
          onExceeded: 'warn',
          session: {
            maxTotalTokens: 1000,
            maxLlmCalls: 10,
            maxToolCalls: 5,
            maxDurationMs: 60_000,
          },
        }}
        sessionStatus={{
          scope: 'session',
          limits: {
            maxTotalTokens: 1000,
            maxLlmCalls: 10,
            maxToolCalls: 5,
            maxDurationMs: 60_000,
          },
          usage: {
            inputTokens: 4,
            outputTokens: 6,
            totalTokens: 10,
            llmCalls: 1,
            toolCalls: 2,
            durationMs: 5_000,
          },
          checks: {},
          overallExceeded: false,
          warningsCount: 0,
        }}
        swarmStatus={{
          scope: 'swarm',
          limits: {},
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            llmCalls: 0,
            toolCalls: 0,
            durationMs: 0,
          },
          checks: {},
          overallExceeded: false,
          warningsCount: 0,
        }}
        onToggleEnabled={() => {}}
        onReset={() => {}}
        onSetLimits={() => {}}
        onSetOnExceeded={() => {}}
        onCancel={() => {}}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Budget');
    expect(frame).toContain('Enforcing');
    expect(frame).toContain('Within limits');
    expect(frame).toContain('Session Usage');
    instance.unmount();
  });

  test('BudgetsPanel renders profile list', async () => {
    const env = createInkTestEnv();
    const now = Date.now();
    const instance = render(
      <BudgetsPanel
        profiles={[
          {
            id: 'default',
            name: 'Default',
            description: 'Default budget profile',
            config: { enabled: true, onExceeded: 'warn', session: { maxTotalTokens: 1000 } },
            createdAt: now,
            updatedAt: now,
          },
        ]}
        activeProfileId="default"
        sessionStatus={{
          scope: 'session',
          limits: { maxTotalTokens: 1000 },
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            llmCalls: 0,
            toolCalls: 0,
            durationMs: 0,
          },
          checks: {},
          overallExceeded: false,
          warningsCount: 0,
        }}
        swarmStatus={{
          scope: 'swarm',
          limits: {},
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            llmCalls: 0,
            toolCalls: 0,
            durationMs: 0,
          },
          checks: {},
          overallExceeded: false,
          warningsCount: 0,
        }}
        onSelectProfile={() => {}}
        onCreateProfile={async () => {}}
        onDeleteProfile={async () => {}}
        onUpdateProfile={async () => {}}
        onReset={() => {}}
        onCancel={() => {}}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    let frame = env.getOutput();
    expect(frame).toContain('Budgets');
    expect(frame).toContain('Default');

    expect(frame).toContain('[n]ew');
    instance.unmount();
  });

  test('ModelPanel renders current model and list', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <ModelPanel
        currentModelId={DEFAULT_MODEL}
        assistantName="Default Assistant"
        onSelectModel={async () => {}}
        onCancel={() => {}}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('Model Selector');
    expect(frame).toContain('Default Assistant');
    expect(frame).toContain(DEFAULT_MODEL);
    instance.unmount();
  });

  test('OrdersPanel renders table view with tabs', async () => {
    const env = createInkTestEnv();
    const manager = {
      listOrders: () => ([
        {
          id: 'ord_alpha',
          storeName: 'Amazon',
          orderNumber: 'A-100',
          description: 'Laptop',
          status: 'pending',
          totalAmount: 1299,
          currency: 'USD',
          itemCount: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]),
      listStores: () => ([
        { id: 'str_amazon', name: 'Amazon', category: 'retail', url: 'https://amazon.com', orderCount: 1, lastOrderAt: new Date().toISOString() },
      ]),
      getOrder: () => null,
      getStoreDetails: () => null,
      createOrder: () => ({ success: true, message: 'created', orderId: 'ord_alpha' }),
      addStore: () => ({ success: true, message: 'added', storeId: 'str_amazon' }),
      cancelOrder: () => ({ success: true, message: 'cancelled', orderId: 'ord_alpha' }),
      getTracking: () => null,
    } as any;

    const instance = render(
      <OrdersPanel
        manager={manager}
        onClose={() => {}}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = env.getOutput();
    expect(frame).toContain('1:orders');
    expect(frame).toContain('2:stores');
    expect(frame).toContain('3:overview');
    expect(frame).toContain('Status filter:');
    instance.unmount();
  });

  test('OrdersPanel supports up/down row selection', async () => {
    const env = createInkTestEnv();
    const nowIso = new Date().toISOString();
    const manager = {
      listOrders: () => ([
        {
          id: 'ord_first',
          storeName: 'Store One',
          orderNumber: '001',
          description: 'First order',
          status: 'pending',
          totalAmount: 10,
          currency: 'USD',
          itemCount: 1,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
        {
          id: 'ord_second',
          storeName: 'Store Two',
          orderNumber: '002',
          description: 'Second order',
          status: 'processing',
          totalAmount: 20,
          currency: 'USD',
          itemCount: 2,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
      ]),
      listStores: () => [],
      getOrder: (id: string) => ({
        order: {
          id,
          storeId: `str_${id}`,
          storeName: id === 'ord_second' ? 'Store Two' : 'Store One',
          orderNumber: id === 'ord_second' ? '002' : '001',
          description: id === 'ord_second' ? 'Second order' : 'First order',
          status: id === 'ord_second' ? 'processing' : 'pending',
          totalAmount: id === 'ord_second' ? 20 : 10,
          currency: 'USD',
          shippingAddress: null,
          paymentMethod: null,
          trackingNumber: null,
          trackingUrl: null,
          notes: null,
          connectorOrderId: null,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
        items: [],
      }),
      getStoreDetails: () => null,
      createOrder: () => ({ success: true, message: 'created', orderId: 'ord_first' }),
      addStore: () => ({ success: true, message: 'added', storeId: 'str_store' }),
      cancelOrder: () => ({ success: true, message: 'cancelled', orderId: 'ord_first' }),
      getTracking: () => null,
    } as any;

    const instance = render(
      <OrdersPanel
        manager={manager}
        onClose={() => {}}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );

    const waitForText = async (text: string, timeoutMs: number = 1200) => {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        if (env.getOutput().includes(text)) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(`Timed out waiting for text: ${text}`);
    };

    await waitForText('> ord_first');
    env.stdin.write('j');
    await waitForText('> ord_second');
    instance.unmount();
  });

  test('OrdersPanel switches tabs with keyboard shortcuts', async () => {
    const env = createInkTestEnv();
    const nowIso = new Date().toISOString();
    const manager = {
      listOrders: () => ([
        {
          id: 'ord_only',
          storeName: 'Shop One',
          orderNumber: '001',
          description: 'Single order',
          status: 'pending',
          totalAmount: 35,
          currency: 'USD',
          itemCount: 1,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
      ]),
      listStores: () => [],
      getOrder: () => null,
      getStoreDetails: () => null,
      createOrder: () => ({ success: true, message: 'created', orderId: 'ord_only' }),
      addStore: () => ({ success: true, message: 'added', storeId: 'str_store' }),
      cancelOrder: () => ({ success: true, message: 'cancelled', orderId: 'ord_only' }),
      getTracking: () => null,
    } as any;

    const instance = render(
      <OrdersPanel
        manager={manager}
        onClose={() => {}}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );

    const waitForText = async (text: string, timeoutMs: number = 1200) => {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        if (env.getOutput().includes(text)) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(`Timed out waiting for text: ${text}`);
    };

    await waitForText('1:orders');
    env.stdin.write('2');
    await waitForText('No stores yet. Press a to add one.');
    env.stdin.write('3');
    await waitForText('Summary');
    instance.unmount();
  });

  test('OrdersPanel applies status filter via bracket keys', async () => {
    const env = createInkTestEnv();
    const nowIso = new Date().toISOString();
    const manager = {
      listOrders: () => ([
        {
          id: 'ord_shipped',
          storeName: 'Ship Store',
          orderNumber: 'S-100',
          description: 'Shipped package',
          status: 'shipped',
          totalAmount: 99,
          currency: 'USD',
          itemCount: 1,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
      ]),
      listStores: () => [],
      getOrder: () => null,
      getStoreDetails: () => null,
      createOrder: () => ({ success: true, message: 'created', orderId: 'ord_shipped' }),
      addStore: () => ({ success: true, message: 'added', storeId: 'str_store' }),
      cancelOrder: () => ({ success: true, message: 'cancelled', orderId: 'ord_shipped' }),
      getTracking: () => null,
    } as any;

    const instance = render(
      <OrdersPanel
        manager={manager}
        onClose={() => {}}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );

    const waitForText = async (text: string, timeoutMs: number = 1200) => {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        if (env.getOutput().includes(text)) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(`Timed out waiting for text: ${text}`);
    };

    await waitForText('Status filter:');
    env.stdin.write(']');
    await waitForText('No orders for this filter. Press n to create an order.');
    instance.unmount();
  });

  test('JobsPanel renders empty state', async () => {
    const env = createInkTestEnv();
    const manager = {
      listSessionJobs: async () => [],
      cancelJob: async () => false,
      getJobStatus: async () => null,
    } as any;

    const instance = render(
      <JobsPanel
        manager={manager}
        onClose={() => {}}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );

    const waitForText = async (text: string, timeoutMs: number = 1200) => {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        if (env.getOutput().includes(text)) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(`Timed out waiting for text: ${text}`);
    };

    await waitForText('No jobs in this session.');
    const frame = env.getOutput();
    expect(frame).toContain('Jobs');
    expect(frame).toContain('1:all');
    expect(frame).toContain('2:active');
    expect(frame).toContain('3:done');
    instance.unmount();
  });

  test('JobsPanel kills selected running job with x', async () => {
    const env = createInkTestEnv();
    const jobs = [
      {
        id: 'job_run',
        sessionId: 'session-1',
        connectorName: 'browseruse',
        command: 'crawl https://example.com',
        input: {},
        status: 'running',
        createdAt: Date.now() - 10000,
        startedAt: Date.now() - 9000,
        timeoutMs: 60000,
      },
      {
        id: 'job_done',
        sessionId: 'session-1',
        connectorName: 'slack',
        command: 'send update',
        input: {},
        status: 'completed',
        createdAt: Date.now() - 20000,
        startedAt: Date.now() - 19000,
        completedAt: Date.now() - 18000,
        timeoutMs: 60000,
        result: { content: 'ok', exitCode: 0 },
      },
    ] as any[];
    const cancelled: string[] = [];

    const manager = {
      listSessionJobs: async () => jobs.map((job) => ({ ...job })),
      cancelJob: async (jobId: string) => {
        const job = jobs.find((item) => item.id === jobId);
        if (!job || !['pending', 'running'].includes(job.status)) {
          return false;
        }
        cancelled.push(jobId);
        job.status = 'cancelled';
        job.completedAt = Date.now();
        job.error = { code: 'JOB_CANCELLED', message: 'Job was cancelled by user' };
        return true;
      },
      getJobStatus: async (jobId: string) => jobs.find((job) => job.id === jobId) || null,
    } as any;

    const instance = render(
      <JobsPanel
        manager={manager}
        onClose={() => {}}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );

    const waitForText = async (text: string, timeoutMs: number = 1600) => {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        if (env.getOutput().includes(text)) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(`Timed out waiting for text: ${text}`);
    };

    await waitForText('job_run');
    env.stdin.write('x');
    await waitForText('Killed job_run.');
    await waitForText('CANCELLED');
    expect(cancelled).toEqual(['job_run']);
    instance.unmount();
  });

  test('JobsPanel kills all active jobs with K', async () => {
    const env = createInkTestEnv();
    const jobs = [
      {
        id: 'job_run_a',
        sessionId: 'session-1',
        connectorName: 'browseruse',
        command: 'crawl https://a.example.com',
        input: {},
        status: 'running',
        createdAt: Date.now() - 10000,
        startedAt: Date.now() - 9000,
        timeoutMs: 60000,
      },
      {
        id: 'job_run_b',
        sessionId: 'session-1',
        connectorName: 'slack',
        command: 'send status',
        input: {},
        status: 'pending',
        createdAt: Date.now() - 11000,
        timeoutMs: 60000,
      },
      {
        id: 'job_done',
        sessionId: 'session-1',
        connectorName: 'notion',
        command: 'write page',
        input: {},
        status: 'completed',
        createdAt: Date.now() - 22000,
        startedAt: Date.now() - 21000,
        completedAt: Date.now() - 19000,
        timeoutMs: 60000,
        result: { content: 'ok', exitCode: 0 },
      },
    ] as any[];
    const cancelled: string[] = [];

    const manager = {
      listSessionJobs: async () => jobs.map((job) => ({ ...job })),
      cancelJob: async (jobId: string) => {
        const job = jobs.find((item) => item.id === jobId);
        if (!job || !['pending', 'running'].includes(job.status)) {
          return false;
        }
        cancelled.push(jobId);
        job.status = 'cancelled';
        job.completedAt = Date.now();
        return true;
      },
      getJobStatus: async (jobId: string) => jobs.find((job) => job.id === jobId) || null,
    } as any;

    const instance = render(
      <JobsPanel
        manager={manager}
        onClose={() => {}}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );

    const waitForText = async (text: string, timeoutMs: number = 1800) => {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        if (env.getOutput().includes(text)) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(`Timed out waiting for text: ${text}`);
    };

    await waitForText('job_run_a');
    env.stdin.write('K');
    await waitForText('Killed 2 active jobs.');
    await waitForText('CANCELLED');
    expect(cancelled.sort()).toEqual(['job_run_a', 'job_run_b']);
    instance.unmount();
  });

  test('DocsPanel renders section index with quick-start content', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <DocsPanel onClose={() => {}} />,
      { stdout: env.stdout, stdin: env.stdin }
    );

    const waitForText = async (text: string, timeoutMs: number = 1400) => {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        if (env.getOutput().includes(text)) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(`Timed out waiting for text: ${text}`);
    };

    await waitForText('Documentation');
    const frame = env.getOutput();
    expect(frame).toContain('Quick Start');
    expect(frame).toContain('sections');
    expect(frame).toContain('[Enter] open');
    instance.unmount();
  });

  test('DocsPanel opens selected section and returns to index', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <DocsPanel onClose={() => {}} />,
      { stdout: env.stdout, stdin: env.stdin }
    );

    const waitForText = async (text: string, timeoutMs: number = 1800) => {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        if (env.getOutput().includes(text)) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(`Timed out waiting for text: ${text}`);
    };

    await waitForText('Quick Start');
    env.stdin.write('j');
    await waitForText('> 2. Core Workflow');
    env.stdin.write('\r');
    await waitForText('Lines 1-');
    env.stdin.write('b');
    await waitForText('Documentation');
    instance.unmount();
  });

  test('OnboardingPanel advances from api-key to connectors on enter', async () => {
    const env = createInkTestEnv();
    const instance = render(
      <OnboardingPanel
        onComplete={async () => {}}
        onCancel={() => {}}
        discoveredConnectors={[]}
      />,
      { stdout: env.stdout, stdin: env.stdin }
    );

    const waitForText = async (text: string, timeoutMs: number = 2500) => {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        if (env.getOutput().includes(text)) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(`Timed out waiting for text: ${text}`);
    };

    await waitForText('Press Enter to get started');
    env.stdin.write('\r');
    await new Promise((resolve) => setTimeout(resolve, 20));
    await waitForText('What can assistants do?');
    env.stdin.write('\r');
    await new Promise((resolve) => setTimeout(resolve, 20));
    await waitForText('Choose your provider');
    env.stdin.write('\r');
    await new Promise((resolve) => setTimeout(resolve, 20));
    await waitForText('Choose your default model');
    env.stdin.write('\r');
    await new Promise((resolve) => setTimeout(resolve, 20));
    await waitForText('Enter your');

    env.stdin.write('sk-ant-test-key');
    await new Promise((resolve) => setTimeout(resolve, 40));
    env.stdin.write('\r');
    await waitForText('Connect your tools');
    instance.unmount();
  });
});
