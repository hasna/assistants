import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import type { GuardrailsConfig, GuardrailsPolicy, PolicyAction, PolicyScope, ToolPolicyRule } from '@hasna/assistants-core';
import { useSafeInput as useInput } from '../hooks/useSafeInput';

interface PolicyInfo {
  id: string;
  name: string;
  scope: string;
  enabled: boolean;
  location: 'user' | 'project' | 'local' | 'system';
  policy: GuardrailsPolicy;
}

interface GuardrailsPanelProps {
  config: GuardrailsConfig;
  policies: PolicyInfo[];
  onToggleEnabled: (enabled: boolean) => void;
  onTogglePolicy: (policyId: string, enabled: boolean) => void;
  onSetPreset: (preset: 'permissive' | 'restrictive') => void;
  onAddPolicy: (policy: GuardrailsPolicy) => void;
  onRemovePolicy: (policyId: string) => void;
  onUpdatePolicy: (policyId: string, updates: Partial<GuardrailsPolicy>) => void;
  onCancel: () => void;
}

type Mode =
  | 'overview'
  | 'policies'
  | 'policy-detail'
  | 'policy-create'
  | 'tools'
  | 'rule-create'
  | 'delete-confirm'
  | 'preset-select';

const SCOPE_COLORS: Record<string, string> = {
  system: 'red',
  organization: 'magenta',
  project: 'yellow',
  session: 'green',
};

const ACTION_COLORS: Record<PolicyAction, string> = {
  allow: 'green',
  deny: 'red',
  require_approval: 'yellow',
  warn: 'cyan',
};

const SCOPES: PolicyScope[] = ['system', 'organization', 'project', 'session'];
const ACTIONS: PolicyAction[] = ['allow', 'deny', 'warn', 'require_approval'];

export function GuardrailsPanel({
  config,
  policies,
  onToggleEnabled,
  onTogglePolicy,
  onSetPreset,
  onAddPolicy,
  onRemovePolicy,
  onUpdatePolicy,
  onCancel,
}: GuardrailsPanelProps) {
  const [mode, setMode] = useState<Mode>('overview');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [detailPolicyId, setDetailPolicyId] = useState<string | null>(null);
  const [ruleIndex, setRuleIndex] = useState(0);

  // Delete confirm state
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'policy' | 'rule'; id: string; label: string; ruleIdx?: number } | null>(null);

  // Create policy form state
  const [createName, setCreateName] = useState('');
  const [createScopeIdx, setCreateScopeIdx] = useState(2); // default: project
  const [createActionIdx, setCreateActionIdx] = useState(0); // default: allow
  const [createField, setCreateField] = useState(0); // 0=name, 1=scope, 2=action

  // Create rule form state
  const [rulePattern, setRulePattern] = useState('');
  const [ruleActionIdx, setRuleActionIdx] = useState(0);
  const [ruleReason, setRuleReason] = useState('');
  const [ruleField, setRuleField] = useState(0); // 0=pattern, 1=action, 2=reason

  // Flatten tool rules for tool view
  const toolRules = useMemo(() => {
    const rules: Array<{ policyId: string; policyName: string; rule: ToolPolicyRule }> = [];
    for (const policyInfo of policies) {
      if (!policyInfo.policy.tools?.rules) continue;
      for (const rule of policyInfo.policy.tools.rules) {
        rules.push({ policyId: policyInfo.id, policyName: policyInfo.name, rule });
      }
    }
    return rules;
  }, [policies]);

  const detailPolicy = detailPolicyId ? policies.find(p => p.id === detailPolicyId) : null;
  const detailRules = detailPolicy?.policy.tools?.rules || [];

  useEffect(() => {
    if (detailPolicyId && !detailPolicy && mode !== 'overview') {
      setDetailPolicyId(null);
      setRuleIndex(0);
      setMode('policies');
    }
  }, [detailPolicyId, detailPolicy, mode]);

  const currentList = mode === 'policies' ? policies : mode === 'tools' ? toolRules : [];
  const totalItems = currentList.length;

  useInput((input, key) => {
    // --- Preset selection ---
    if (mode === 'preset-select') {
      if (input === '1') { onSetPreset('permissive'); setMode('overview'); return; }
      if (input === '2') { onSetPreset('restrictive'); setMode('overview'); return; }
      if (key.escape || input === 'q' || input === 'Q') { setMode('overview'); return; }
      return;
    }

    // --- Delete confirmation ---
    if (mode === 'delete-confirm' && deleteTarget) {
      if (input === 'y' || input === 'Y') {
        if (deleteTarget.type === 'policy') {
          onRemovePolicy(deleteTarget.id);
          setDeleteTarget(null);
          setDetailPolicyId(null);
          setMode('policies');
          setSelectedIndex(0);
        } else if (deleteTarget.type === 'rule' && detailPolicy && deleteTarget.ruleIdx !== undefined) {
          const existingRules = [...(detailPolicy.policy.tools?.rules || [])];
          existingRules.splice(deleteTarget.ruleIdx, 1);
          onUpdatePolicy(detailPolicy.id, {
            tools: { ...detailPolicy.policy.tools!, rules: existingRules },
          });
          setDeleteTarget(null);
          setMode('policy-detail');
          setRuleIndex(Math.max(0, ruleIndex - 1));
        }
        return;
      }
      if (input === 'n' || input === 'N' || key.escape) {
        setDeleteTarget(null);
        setMode('policy-detail');
        return;
      }
      return;
    }

    // --- Policy create form ---
    if (mode === 'policy-create') {
      if (key.escape) { setMode('policies'); return; }

      if (key.tab) {
        setCreateField((prev) => (prev + 1) % 3);
        return;
      }

      if (key.return) {
        if (!createName.trim()) return;
        const newPolicy: GuardrailsPolicy = {
          name: createName.trim(),
          scope: SCOPES[createScopeIdx],
          enabled: true,
          tools: { defaultAction: ACTIONS[createActionIdx], rules: [] },
        };
        onAddPolicy(newPolicy);
        setCreateName('');
        setCreateField(0);
        setMode('policies');
        return;
      }

      // Handle text input for name field
      if (createField === 0) {
        if (input === '\x7f' || input === '\x08' || key.backspace || key.delete) {
          setCreateName(prev => prev.slice(0, -1));
          return;
        }
        const charCode = input?.charCodeAt(0) ?? 0;
        if (input && charCode >= 32 && charCode !== 127) {
          setCreateName(prev => prev + input);
          return;
        }
      }

      // Cycle scope with arrows
      if (createField === 1) {
        if (key.leftArrow || key.upArrow) { setCreateScopeIdx(prev => (prev - 1 + SCOPES.length) % SCOPES.length); return; }
        if (key.rightArrow || key.downArrow) { setCreateScopeIdx(prev => (prev + 1) % SCOPES.length); return; }
      }

      // Cycle action with arrows
      if (createField === 2) {
        if (key.leftArrow || key.upArrow) { setCreateActionIdx(prev => (prev - 1 + ACTIONS.length) % ACTIONS.length); return; }
        if (key.rightArrow || key.downArrow) { setCreateActionIdx(prev => (prev + 1) % ACTIONS.length); return; }
      }
      return;
    }

    // --- Rule create form ---
    if (mode === 'rule-create') {
      if (key.escape) { setMode('policy-detail'); return; }

      if (key.tab) {
        setRuleField((prev) => (prev + 1) % 3);
        return;
      }

      if (key.return) {
        if (!rulePattern.trim()) return;
        if (!detailPolicy) return;
        const newRule: ToolPolicyRule = {
          pattern: rulePattern.trim(),
          action: ACTIONS[ruleActionIdx],
          ...(ruleReason.trim() ? { reason: ruleReason.trim() } : {}),
        };
        const existingRules = [...(detailPolicy.policy.tools?.rules || [])];
        existingRules.push(newRule);
        onUpdatePolicy(detailPolicy.id, {
          tools: { ...(detailPolicy.policy.tools || { defaultAction: 'allow', rules: [] }), rules: existingRules },
        });
        setRulePattern('');
        setRuleReason('');
        setRuleField(0);
        setMode('policy-detail');
        return;
      }

      // Text input for pattern (field 0) or reason (field 2)
      if (ruleField === 0 || ruleField === 2) {
        if (input === '\x7f' || input === '\x08' || key.backspace || key.delete) {
          if (ruleField === 0) setRulePattern(prev => prev.slice(0, -1));
          else setRuleReason(prev => prev.slice(0, -1));
          return;
        }
        const charCode = input?.charCodeAt(0) ?? 0;
        if (input && charCode >= 32 && charCode !== 127) {
          if (ruleField === 0) setRulePattern(prev => prev + input);
          else setRuleReason(prev => prev + input);
          return;
        }
      }

      // Cycle action (field 1)
      if (ruleField === 1) {
        if (key.leftArrow || key.upArrow) { setRuleActionIdx(prev => (prev - 1 + ACTIONS.length) % ACTIONS.length); return; }
        if (key.rightArrow || key.downArrow) { setRuleActionIdx(prev => (prev + 1) % ACTIONS.length); return; }
      }
      return;
    }

    // --- Policy detail ---
    if (mode === 'policy-detail' && detailPolicy) {
      if (key.escape || input === 'b' || input === 'B') {
        setDetailPolicyId(null);
        setRuleIndex(0);
        setMode('policies');
        return;
      }

      if (key.upArrow && detailRules.length > 0) {
        setRuleIndex(prev => (prev === 0 ? detailRules.length - 1 : prev - 1));
        return;
      }
      if (key.downArrow && detailRules.length > 0) {
        setRuleIndex(prev => (prev >= detailRules.length - 1 ? 0 : prev + 1));
        return;
      }

      if (input === 'a' || input === 'A') {
        if (detailPolicy.location !== 'system') {
          setRulePattern('');
          setRuleActionIdx(0);
          setRuleReason('');
          setRuleField(0);
          setMode('rule-create');
        }
        return;
      }

      if (input === 'x' || input === 'X') {
        if (detailPolicy.location !== 'system') {
          setDeleteTarget({ type: 'policy', id: detailPolicy.id, label: detailPolicy.name || detailPolicy.id });
          setMode('delete-confirm');
        }
        return;
      }

      if (key.delete && detailRules.length > 0 && detailPolicy.location !== 'system') {
        const rule = detailRules[ruleIndex];
        if (rule) {
          setDeleteTarget({ type: 'rule', id: detailPolicy.id, label: rule.pattern, ruleIdx: ruleIndex });
          setMode('delete-confirm');
        }
        return;
      }

      if (input === 'e' || input === 'E') {
        if (detailPolicy.location !== 'system') onTogglePolicy(detailPolicy.id, true);
        return;
      }
      if (input === 'd' || input === 'D') {
        if (detailPolicy.location !== 'system') onTogglePolicy(detailPolicy.id, false);
        return;
      }

      if (input === 'q' || input === 'Q') { onCancel(); return; }
      return;
    }

    // --- Policies list ---
    if (mode === 'policies') {
      // Navigate including the "+ New policy" row at the end
      const policiesListSize = policies.length + 1;
      if (key.upArrow) { setSelectedIndex(prev => (prev === 0 ? policiesListSize - 1 : prev - 1)); return; }
      if (key.downArrow) { setSelectedIndex(prev => (prev >= policiesListSize - 1 ? 0 : prev + 1)); return; }

      if (key.return) {
        if (selectedIndex === policies.length) {
          // "New policy" option
          setCreateName('');
          setCreateScopeIdx(2);
          setCreateActionIdx(0);
          setCreateField(0);
          setMode('policy-create');
        } else {
          const policy = policies[selectedIndex];
          if (policy) {
            setDetailPolicyId(policy.id);
            setRuleIndex(0);
            setMode('policy-detail');
          }
        }
        return;
      }

      if (input === 'e' || input === 'E') {
        const policy = policies[selectedIndex];
        if (policy && policy.location !== 'system') onTogglePolicy(policy.id, true);
        return;
      }
      if (input === 'd' || input === 'D') {
        const policy = policies[selectedIndex];
        if (policy && policy.location !== 'system') onTogglePolicy(policy.id, false);
        return;
      }

      if (input === 'n' || input === 'N') {
        setCreateName('');
        setCreateScopeIdx(2);
        setCreateActionIdx(0);
        setCreateField(0);
        setMode('policy-create');
        return;
      }

      if (key.escape || input === 'b' || input === 'B') { setMode('overview'); setSelectedIndex(0); return; }
    }

    // --- Tools rules ---
    if (mode === 'tools') {
      if (key.upArrow) { setSelectedIndex(prev => (prev === 0 ? Math.max(0, totalItems - 1) : prev - 1)); return; }
      if (key.downArrow) { setSelectedIndex(prev => (prev >= totalItems - 1 ? 0 : prev + 1)); return; }
      if (key.escape || input === 'b' || input === 'B') { setMode('overview'); setSelectedIndex(0); return; }
    }

    // --- Overview ---
    if (mode === 'overview') {
      if (input === 'e' || input === 'E') { onToggleEnabled(true); return; }
      if (input === 'd' || input === 'D') { onToggleEnabled(false); return; }
      if (input === 'p' || input === 'P') { setMode('policies'); setSelectedIndex(0); return; }
      if (input === 't' || input === 'T') { setMode('tools'); setSelectedIndex(0); return; }
      if (input === 's' || input === 'S') { setMode('preset-select'); return; }
    }

    // Quit
    if (key.escape || input === 'q' || input === 'Q') { onCancel(); return; }
  }, { isActive: true });

  // --- RENDER: Delete confirmation ---
  if (mode === 'delete-confirm' && deleteTarget) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="red">Delete {deleteTarget.type === 'policy' ? 'Policy' : 'Rule'}</Text>
        </Box>
        <Box flexDirection="column" borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} paddingX={1} paddingY={1}>
          <Text>Are you sure you want to delete this {deleteTarget.type}?</Text>
          <Text dimColor>{deleteTarget.label}</Text>
          <Text dimColor>This action cannot be undone.</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>y confirm | n cancel</Text>
        </Box>
      </Box>
    );
  }

  // --- RENDER: Policy create form ---
  if (mode === 'policy-create') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}><Text bold>Create New Policy</Text></Box>
        <Box flexDirection="column" borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} paddingX={1} paddingY={1}>
          <Box>
            <Text dimColor>Name: </Text>
            <Text inverse={createField === 0}>{createName || ' '}</Text>
            {createField === 0 && <Text color="cyan">|</Text>}
          </Box>
          <Box>
            <Text dimColor>Scope: </Text>
            <Text inverse={createField === 1} color={SCOPE_COLORS[SCOPES[createScopeIdx]]}>{SCOPES[createScopeIdx]}</Text>
            {createField === 1 && <Text dimColor> ←/→</Text>}
          </Box>
          <Box>
            <Text dimColor>Default Action: </Text>
            <Text inverse={createField === 2} color={ACTION_COLORS[ACTIONS[createActionIdx]]}>{ACTIONS[createActionIdx]}</Text>
            {createField === 2 && <Text dimColor> ←/→</Text>}
          </Box>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Tab next field | Enter save | Esc cancel</Text>
        </Box>
      </Box>
    );
  }

  // --- RENDER: Rule create form ---
  if (mode === 'rule-create') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold>Add Tool Rule</Text>
          {detailPolicy && <Text dimColor> to {detailPolicy.name || detailPolicy.id}</Text>}
        </Box>
        <Box flexDirection="column" borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} paddingX={1} paddingY={1}>
          <Box>
            <Text dimColor>Pattern: </Text>
            <Text inverse={ruleField === 0}>{rulePattern || ' '}</Text>
            {ruleField === 0 && <Text color="cyan">|</Text>}
          </Box>
          <Box>
            <Text dimColor>Action: </Text>
            <Text inverse={ruleField === 1} color={ACTION_COLORS[ACTIONS[ruleActionIdx]]}>{ACTIONS[ruleActionIdx]}</Text>
            {ruleField === 1 && <Text dimColor> ←/→</Text>}
          </Box>
          <Box>
            <Text dimColor>Reason: </Text>
            <Text inverse={ruleField === 2}>{ruleReason || ' '}</Text>
            {ruleField === 2 && <Text color="cyan">|</Text>}
            {ruleField !== 2 && <Text dimColor> (optional)</Text>}
          </Box>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Tab next field | Enter save | Esc cancel</Text>
        </Box>
      </Box>
    );
  }

  // --- RENDER: Policy detail ---
  if (mode === 'policy-detail' && detailPolicy) {
    const isSystem = detailPolicy.location === 'system';
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1} justifyContent="space-between">
          <Box>
            <Text bold>{detailPolicy.name || detailPolicy.id}</Text>
            <Text color={detailPolicy.enabled ? 'green' : 'red'}> [{detailPolicy.enabled ? 'on' : 'off'}]</Text>
          </Box>
          <Text color={SCOPE_COLORS[detailPolicy.scope]}>{detailPolicy.scope}</Text>
        </Box>

        <Box flexDirection="column" borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} paddingX={1} paddingY={1}>
          <Box><Text dimColor>ID: </Text><Text>{detailPolicy.id}</Text></Box>
          <Box><Text dimColor>Location: </Text><Text>{detailPolicy.location}</Text></Box>
          {detailPolicy.policy.tools && (
            <Box><Text dimColor>Default Action: </Text><Text color={ACTION_COLORS[detailPolicy.policy.tools.defaultAction]}>{detailPolicy.policy.tools.defaultAction}</Text></Box>
          )}
          {detailPolicy.policy.depth && (
            <Box><Text dimColor>Max Depth: </Text><Text>{detailPolicy.policy.depth.maxDepth}</Text></Box>
          )}
          {detailPolicy.policy.rateLimits && (
            <Box><Text dimColor>Rate Limits: </Text><Text>{detailPolicy.policy.rateLimits.toolCallsPerMinute || '-'} tools/min, {detailPolicy.policy.rateLimits.llmCallsPerMinute || '-'} llm/min</Text></Box>
          )}
        </Box>

        <Box marginTop={1} marginBottom={0}>
          <Text bold dimColor>Tool Rules ({detailRules.length})</Text>
        </Box>
        <Box flexDirection="column" borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} paddingX={1} height={Math.min(8, detailRules.length + 2)} overflowY="hidden">
          {detailRules.length === 0 ? (
            <Box paddingY={0}><Text dimColor>{isSystem ? 'No tool rules.' : 'No tool rules. Press a to add one.'}</Text></Box>
          ) : (
            detailRules.map((rule, idx) => {
              const isSelected = idx === ruleIndex;
              return (
                <Box key={`${rule.pattern}-${idx}`}>
                  <Text inverse={isSelected}>
                    {isSelected ? '>' : ' '}{' '}
                    <Text color={ACTION_COLORS[rule.action]}>[{rule.action.slice(0, 4).padEnd(4)}]</Text>{' '}
                    <Text bold={isSelected}>{rule.pattern.slice(0, 30).padEnd(30)}</Text>
                    {rule.reason && <Text dimColor> {rule.reason.slice(0, 20)}</Text>}
                  </Text>
                </Box>
              );
            })
          )}
        </Box>

        <Box marginTop={1}>
          <Text dimColor>
            {!isSystem ? '[e]nable [d]isable [a]dd rule [x] delete ' : ''}
            {!isSystem && detailRules.length > 0 ? '[del] rm rule ' : ''}
            [b]ack [q]uit | ↑↓ rules
          </Text>
        </Box>
      </Box>
    );
  }

  // --- RENDER: Preset selection ---
  if (mode === 'preset-select') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}><Text bold>Select Preset Policy</Text></Box>
        <Box flexDirection="column" borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} paddingX={1} paddingY={1}>
          <Box marginBottom={1}>
            <Text bold color="green">1.</Text>
            <Text> Permissive - Allow most, warn on dangerous</Text>
          </Box>
          <Box>
            <Text bold color="red">2.</Text>
            <Text> Restrictive - Deny by default, require approval</Text>
          </Box>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>[1] permissive [2] restrictive [q] cancel</Text>
        </Box>
      </Box>
    );
  }

  // --- RENDER: Policies list ---
  if (mode === 'policies') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1} justifyContent="space-between">
          <Text bold>Policies</Text>
          <Text dimColor>{policies.length} polic{policies.length !== 1 ? 'ies' : 'y'}</Text>
        </Box>
        <Box flexDirection="column" borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} paddingX={1} height={Math.min(12, policies.length + 2)} overflowY="hidden">
          {policies.length === 0 ? (
            <Box paddingY={1}><Text dimColor>No policies. Press n to create one.</Text></Box>
          ) : (
            policies.map((policy, index) => {
              const isSelected = index === selectedIndex;
              const scopeColor = SCOPE_COLORS[policy.scope] || 'white';
              return (
                <Box key={policy.id}>
                  <Text inverse={isSelected}>
                    {isSelected ? '>' : ' '}{' '}
                    <Text color={policy.enabled ? 'green' : 'red'}>[{policy.enabled ? 'on ' : 'off'}]</Text>{' '}
                    <Text bold={isSelected}>{(policy.name || policy.id).slice(0, 20).padEnd(20)}</Text>{' '}
                    <Text color={scopeColor}>{policy.scope.padEnd(10)}</Text>{' '}
                    <Text dimColor>{policy.location}</Text>
                  </Text>
                </Box>
              );
            })
          )}

          {/* New policy option */}
          <Box marginTop={policies.length > 0 ? 1 : 0} paddingY={0}>
            <Text
              inverse={selectedIndex === policies.length}
              dimColor={selectedIndex !== policies.length}
              color={selectedIndex === policies.length ? 'cyan' : undefined}
            >
              + New policy (n)
            </Text>
          </Box>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>[e]nable [d]isable [Enter] detail [b]ack [q]uit | ↑↓ navigate</Text>
        </Box>
      </Box>
    );
  }

  // --- RENDER: Tools rules ---
  if (mode === 'tools') {
    const selectedRule = toolRules[selectedIndex];
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1} justifyContent="space-between">
          <Text bold>Tool Rules</Text>
          <Text dimColor>{toolRules.length} rule{toolRules.length !== 1 ? 's' : ''}</Text>
        </Box>
        <Box flexDirection="column" borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} paddingX={1} height={Math.min(12, toolRules.length + 2)} overflowY="hidden">
          {toolRules.length === 0 ? (
            <Box paddingY={1}><Text dimColor>No tool rules configured.</Text></Box>
          ) : (
            toolRules.map((item, index) => {
              const isSelected = index === selectedIndex;
              const actionColor = ACTION_COLORS[item.rule.action];
              return (
                <Box key={`${item.policyId}-${item.rule.pattern}-${index}`}>
                  <Text inverse={isSelected}>
                    {isSelected ? '>' : ' '}{' '}
                    <Text color={actionColor}>[{item.rule.action.slice(0, 4).padEnd(4)}]</Text>{' '}
                    <Text bold={isSelected}>{item.rule.pattern.slice(0, 25).padEnd(25)}</Text>{' '}
                    <Text dimColor>{item.policyName.slice(0, 15)}</Text>
                  </Text>
                </Box>
              );
            })
          )}
        </Box>
        {selectedRule && (
          <Box marginTop={1} flexDirection="column">
            <Box><Text dimColor>Pattern: </Text><Text>{selectedRule.rule.pattern}</Text></Box>
            <Box><Text dimColor>Action: </Text><Text color={ACTION_COLORS[selectedRule.rule.action]}>{selectedRule.rule.action}</Text></Box>
            {selectedRule.rule.reason && (<Box><Text dimColor>Reason: </Text><Text>{selectedRule.rule.reason}</Text></Box>)}
            <Box><Text dimColor>Policy: </Text><Text>{selectedRule.policyName}</Text></Box>
          </Box>
        )}
        <Box marginTop={1}>
          <Text dimColor>[b]ack [q]uit | ↑↓ navigate</Text>
        </Box>
      </Box>
    );
  }

  // --- RENDER: Overview (default) ---
  const enabledPolicies = policies.filter(p => p.enabled).length;
  const totalRules = toolRules.length;
  const denyRules = toolRules.filter(r => r.rule.action === 'deny').length;
  const approvalRules = toolRules.filter(r => r.rule.action === 'require_approval').length;

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1} justifyContent="space-between">
        <Text bold>Guardrails</Text>
        <Text color={config.enabled ? 'green' : 'red'}>{config.enabled ? 'Enabled' : 'Disabled'}</Text>
      </Box>
      <Box flexDirection="column" borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} paddingX={1} paddingY={1}>
        <Box marginBottom={1}>
          <Text bold>Status: </Text>
          <Text color={config.enabled ? 'green' : 'red'}>
            {config.enabled ? 'Enforcing policies' : 'Not enforcing (all tools allowed)'}
          </Text>
        </Box>
        <Box marginBottom={1} flexDirection="column">
          <Box><Text dimColor>Policies: </Text><Text>{enabledPolicies}/{policies.length} enabled</Text></Box>
          <Box>
            <Text dimColor>Tool Rules: </Text><Text>{totalRules} total</Text>
            {denyRules > 0 && (
              <Text> (<Text color="red">{denyRules} deny</Text>
                {approvalRules > 0 && <Text>, </Text>}
                {approvalRules > 0 && <Text color="yellow">{approvalRules} approval</Text>})
              </Text>
            )}
          </Box>
          <Box><Text dimColor>Default Action: </Text><Text color={ACTION_COLORS[config.defaultAction]}>{config.defaultAction}</Text></Box>
        </Box>
        {policies.filter(p => p.enabled).length > 0 && (
          <Box flexDirection="column">
            <Text bold dimColor>Active Policies:</Text>
            {policies.filter(p => p.enabled).slice(0, 3).map(p => (
              <Box key={p.id} paddingLeft={1}>
                <Text>- {p.name || p.id}</Text><Text dimColor> ({p.scope})</Text>
              </Box>
            ))}
            {policies.filter(p => p.enabled).length > 3 && (
              <Box paddingLeft={1}><Text dimColor>+ {policies.filter(p => p.enabled).length - 3} more</Text></Box>
            )}
          </Box>
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>[e]nable [d]isable [p]olicies [t]ool rules [s]et preset [q]uit</Text>
      </Box>
    </Box>
  );
}
