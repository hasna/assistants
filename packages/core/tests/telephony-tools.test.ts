import { describe, expect, it } from 'bun:test';
import { createTelephonyToolExecutors, telephonyTools } from '../src/telephony/tools';

describe('telephony tools executors', () => {
  it('telephony_status includes default number source', async () => {
    const manager = {
      getStatus: () => ({
        enabled: true,
        twilioConfigured: true,
        elevenLabsConfigured: false,
        phoneNumbers: 1,
        activeCalls: 0,
        routingRules: 0,
        recentCalls: 0,
        recentMessages: 0,
        defaultPhoneNumber: '+15550001111',
        defaultPhoneNumberSource: 'local' as const,
      }),
    };

    const executors = createTelephonyToolExecutors(() => manager as any);
    const output = await executors.telephony_status({});

    expect(output).toContain('Default number');
    expect(output).toContain('+15550001111');
    expect(output).toContain('(local)');
  });

  it('telephony_phone_numbers points to /communication sync', async () => {
    const manager = {
      listPhoneNumbers: () => [],
    };

    const executors = createTelephonyToolExecutors(() => manager as any);
    const output = await executors.telephony_phone_numbers({});

    expect(output).toContain('/communication sync');
  });

  it('telephony_routing_rules create uses current assistant identity', async () => {
    let createdRule: any;
    const manager = {
      listRoutingRules: () => [],
      createRoutingRule: (rule: any) => {
        createdRule = rule;
        return { success: true, message: 'ok' };
      },
      getAssistantId: () => 'assistant-1',
      getAssistantName: () => 'Tester',
    };

    const executors = createTelephonyToolExecutors(() => manager as any);
    const output = await executors.telephony_routing_rules({ action: 'create', name: 'Rule A' });

    expect(output).toContain('ok');
    expect(createdRule.targetAssistantId).toBe('assistant-1');
    expect(createdRule.targetAssistantName).toBe('Tester');
  });

  it('returns error when telephony manager is unavailable', async () => {
    const executors = createTelephonyToolExecutors(() => null);

    const smsResult = await executors.telephony_send_sms({ to: '+15551234567', body: 'Hello' });
    const whatsappResult = await executors.telephony_send_whatsapp({ to: '+15551234567', body: 'Hello' });
    const callResult = await executors.telephony_call({ to: '+15551234567' });
    const numbersResult = await executors.telephony_phone_numbers({});
    const statusResult = await executors.telephony_status({});

    expect(smsResult).toContain('Telephony is not enabled');
    expect(whatsappResult).toContain('Telephony is not enabled');
    expect(callResult).toContain('Telephony is not enabled');
    expect(numbersResult).toContain('Telephony is not enabled');
    expect(statusResult).toContain('Telephony is not enabled');
  });

  it('validates inputs for send and call tools', async () => {
    let sentArgs: { to: string; body: string; from?: string } | null = null;
    let callArgs: { to: string; from?: string } | null = null;

    const manager = {
      sendSms: async (to: string, body: string, from?: string) => {
        sentArgs = { to, body, from };
        return { success: true, message: 'SMS sent.' };
      },
      sendWhatsApp: async () => ({ success: true, message: 'WhatsApp sent.' }),
      makeCall: async (to: string, from?: string, firstMessage?: string) => {
        callArgs = { to, from, firstMessage };
        return { success: true, message: 'Call started.' };
      },
    };

    const executors = createTelephonyToolExecutors(() => manager as any);

    expect(await executors.telephony_send_sms({ body: 'Hello' })).toContain('Recipient phone number');
    expect(await executors.telephony_send_sms({ to: '+15551230000' })).toContain('Message body');
    expect(await executors.telephony_send_sms({ to: '+15551230000', body: 'Hi', from: '+15550000000' }))
      .toContain('SMS sent');
    expect(sentArgs).toEqual({ to: '+15551230000', body: 'Hi', from: '+15550000000' });

    expect(await executors.telephony_send_whatsapp({ body: 'Hello' })).toContain('Recipient phone number');
    expect(await executors.telephony_send_whatsapp({ to: '+15551230000' })).toContain('Message body');

    expect(await executors.telephony_call({})).toContain('contact_name is required');
    expect(await executors.telephony_call({ to: '+15551230000', from: '+15550000000' }))
      .toContain('Call started');
    expect(callArgs!.to).toBe('+15551230000');
    expect(callArgs!.from).toBe('+15550000000');
  });

  it('formats phone numbers and routing rules lists', async () => {
    const manager = {
      listPhoneNumbers: () => [
        {
          number: '+15551230000',
          friendlyName: 'Main',
          capabilities: { voice: true, sms: true, whatsapp: false },
        },
      ],
      listRoutingRules: () => [
        {
          id: 'rule-1',
          name: 'Default',
          priority: 1,
          messageType: 'sms',
          targetAssistantName: 'Helper',
          enabled: false,
          fromPattern: '+1555*',
          toPattern: null,
          keyword: 'help',
        },
      ],
    };

    const executors = createTelephonyToolExecutors(() => manager as any);
    const numbersOutput = await executors.telephony_phone_numbers({});
    const rulesOutput = await executors.telephony_routing_rules({ action: 'list' });

    expect(numbersOutput).toContain('Phone Numbers (1)');
    expect(numbersOutput).toContain('+15551230000 (Main) [voice, sms]');
    expect(rulesOutput).toContain('Routing Rules (1)');
    expect(rulesOutput).toContain('Default');
    expect(rulesOutput).toContain('[DISABLED]');
    expect(rulesOutput).toContain('From: +1555*');
    expect(rulesOutput).toContain('Keyword: help');
  });

  it('handles routing rule delete and unknown actions', async () => {
    let deletedRuleId: string | null = null;
    const manager = {
      deleteRoutingRule: (ruleId: string) => {
        deletedRuleId = ruleId;
        return { success: true, message: 'Deleted.' };
      },
    };

    const executors = createTelephonyToolExecutors(() => manager as any);
    expect(await executors.telephony_routing_rules({ action: 'delete' }))
      .toContain('Rule ID is required');

    expect(await executors.telephony_routing_rules({ action: 'delete', rule_id: 'rule-1' }))
      .toContain('Deleted');
    expect(deletedRuleId).toBe('rule-1');

    expect(await executors.telephony_routing_rules({ action: 'other' }))
      .toContain("Unknown action: other");
  });

  it('telephonyTools array has 12 tools', () => {
    expect(telephonyTools.length).toBe(12);
    const names = telephonyTools.map((t) => t.name);
    expect(names).toContain('telephony_hold');
    expect(names).toContain('telephony_resume');
    expect(names).toContain('telephony_end_call');
    expect(names).toContain('telephony_active_calls');
    expect(names).toContain('telephony_call');
    expect(names).toContain('telephony_send_sms');
    expect(names).toContain('telephony_send_whatsapp');
    expect(names).toContain('telephony_status');
  });

  it('telephony_call resolves contact_name to phone number', async () => {
    let calledTo: string | null = null;
    const manager = {
      makeCall: async (to: string) => {
        calledTo = to;
        return { success: true, message: `Calling ${to}...` };
      },
    };
    const contactsManager = {
      searchContacts: (query: string) => {
        if (query === 'John Doe') {
          return [{ id: 'c1', name: 'John Doe', primaryPhone: '+15559990000', favorite: false, tags: [], relationship: 'friend' }];
        }
        return [];
      },
    };

    const executors = createTelephonyToolExecutors(
      () => manager as any,
      () => contactsManager as any
    );
    const output = await executors.telephony_call({ contact_name: 'John Doe' });
    expect(output).toContain('Calling +15559990000');
    expect(calledTo).toBe('+15559990000');
  });

  it('telephony_call returns error when contact has no phone', async () => {
    const manager = {
      makeCall: async () => ({ success: true, message: 'ok' }),
    };
    const contactsManager = {
      searchContacts: () => [{ id: 'c2', name: 'Jane', primaryPhone: undefined, favorite: false, tags: [], relationship: 'friend' }],
    };

    const executors = createTelephonyToolExecutors(
      () => manager as any,
      () => contactsManager as any
    );
    const output = await executors.telephony_call({ contact_name: 'Jane' });
    expect(output).toContain('no phone number');
  });

  it('telephony_call returns error when contact not found', async () => {
    const manager = {
      makeCall: async () => ({ success: true, message: 'ok' }),
    };
    const contactsManager = {
      searchContacts: () => [],
    };

    const executors = createTelephonyToolExecutors(
      () => manager as any,
      () => contactsManager as any
    );
    const output = await executors.telephony_call({ contact_name: 'Unknown' });
    expect(output).toContain('No contact found');
  });

  it('telephony_call passes first_message to makeCall', async () => {
    let receivedFirstMessage: string | undefined;
    const manager = {
      makeCall: async (_to: string, _from?: string, firstMessage?: string) => {
        receivedFirstMessage = firstMessage;
        return { success: true, message: 'Calling...' };
      },
    };

    const executors = createTelephonyToolExecutors(() => manager as any);
    await executors.telephony_call({ to: '+15551230000', first_message: 'Hi there!' });
    expect(receivedFirstMessage).toBe('Hi there!');
  });

  it('telephony_hold calls manager.holdCall', async () => {
    let holdCallSid: string | undefined;
    const manager = {
      holdCall: async (callSid?: string) => {
        holdCallSid = callSid;
        return { success: true, message: 'Call on hold.' };
      },
    };

    const executors = createTelephonyToolExecutors(() => manager as any);
    const output = await executors.telephony_hold({});
    expect(output).toContain('Call on hold');
    expect(holdCallSid).toBeUndefined();

    await executors.telephony_hold({ call_sid: 'CA123' });
    expect(holdCallSid).toBe('CA123');
  });

  it('telephony_resume calls manager.resumeCall', async () => {
    let resumeCallSid: string | undefined;
    const manager = {
      resumeCall: async (callSid?: string) => {
        resumeCallSid = callSid;
        return { success: true, message: 'Call resumed.' };
      },
    };

    const executors = createTelephonyToolExecutors(() => manager as any);
    const output = await executors.telephony_resume({});
    expect(output).toContain('Call resumed');
    expect(resumeCallSid).toBeUndefined();
  });

  it('telephony_end_call calls manager.endCall', async () => {
    let endCallSid: string | undefined;
    const manager = {
      endCall: async (callSid?: string) => {
        endCallSid = callSid;
        return { success: true, message: 'Call ended.' };
      },
    };

    const executors = createTelephonyToolExecutors(() => manager as any);
    const output = await executors.telephony_end_call({});
    expect(output).toContain('Call ended');
    expect(endCallSid).toBeUndefined();

    await executors.telephony_end_call({ call_sid: 'CA456' });
    expect(endCallSid).toBe('CA456');
  });

  it('telephony_active_calls formats output correctly', async () => {
    const manager = {
      getActiveCalls: () => [
        {
          callSid: 'CA789',
          fromNumber: '+15551110000',
          toNumber: '+15552220000',
          direction: 'outbound' as const,
          state: 'active' as const,
          durationSeconds: 125,
          streamSid: null,
          assistantId: null,
          bridgeId: null,
          startedAt: Date.now() - 125000,
          lastActivityAt: Date.now(),
        },
      ],
    };

    const executors = createTelephonyToolExecutors(() => manager as any);
    const output = await executors.telephony_active_calls({});
    expect(output).toContain('Active Calls (1)');
    expect(output).toContain('[OUT]');
    expect(output).toContain('+15551110000');
    expect(output).toContain('+15552220000');
    expect(output).toContain('active');
    expect(output).toContain('2m 5s');
    expect(output).toContain('CA789');
  });

  it('telephony_active_calls returns empty message when no calls', async () => {
    const manager = {
      getActiveCalls: () => [],
    };

    const executors = createTelephonyToolExecutors(() => manager as any);
    const output = await executors.telephony_active_calls({});
    expect(output).toContain('No active calls');
  });

  it('new tool executors return error when manager unavailable', async () => {
    const executors = createTelephonyToolExecutors(() => null);

    expect(await executors.telephony_hold({})).toContain('Telephony is not enabled');
    expect(await executors.telephony_resume({})).toContain('Telephony is not enabled');
    expect(await executors.telephony_end_call({})).toContain('Telephony is not enabled');
    expect(await executors.telephony_active_calls({})).toContain('Telephony is not enabled');
  });
});
