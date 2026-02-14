import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { useSafeInput as useInput } from '../hooks/useSafeInput';
import { useTypewriter } from '../hooks/useTypewriter';
import { useGradientCycle } from '../hooks/useGradientCycle';
import {
  ALL_MODELS,
  LLM_PROVIDERS,
  getProviderInfo,
  getProviderLabel,
  getProviderForModel,
  type LLMProvider,
  type Skill,
} from '@hasna/assistants-shared';

// ============================================
// Types
// ============================================

export interface OnboardingResult {
  apiKey: string;
  provider: LLMProvider;
  model: string;
  connectors: string[];
  connectorKeys: Record<string, string>;
  skills: string[];
}

interface OnboardingPanelProps {
  onComplete: (result: OnboardingResult) => Promise<void>;
  onCancel: () => void;
  existingApiKeys?: Record<LLMProvider, string>;
  existingModel?: string;
  discoveredConnectors: string[];
  discoveredSkills?: Skill[];
}

type Step = 'welcome' | 'intro' | 'provider-select' | 'model-select' | 'api-key' | 'connectors' | 'skills' | 'connector-keys' | 'summary';

const STEPS: Step[] = ['welcome', 'intro', 'provider-select', 'model-select', 'api-key', 'connectors', 'skills', 'connector-keys', 'summary'];

const POPULAR_CONNECTORS: Record<string, { desc: string; install: string }> = {
  notion: { desc: 'Notion workspace', install: 'bun add -g connect-notion' },
  gmail: { desc: 'Gmail email', install: 'bun add -g connect-gmail' },
  googledrive: { desc: 'Google Drive files', install: 'bun add -g connect-googledrive' },
  slack: { desc: 'Slack messaging', install: 'bun add -g connect-slack' },
  github: { desc: 'GitHub repos & issues', install: 'bun add -g connect-github' },
  calendar: { desc: 'Google Calendar', install: 'bun add -g connect-calendar' },
};

const LOGO_LINES = [
  '  █████  ███████ ███████ ██ ███████ ████████  █████  ███    ██ ████████ ███████',
  ' ██   ██ ██      ██      ██ ██         ██    ██   ██ ████   ██    ██    ██     ',
  ' ███████ ███████ ███████ ██ ███████    ██    ███████ ██ ██  ██    ██    ███████',
  ' ██   ██      ██      ██ ██      ██    ██    ██   ██ ██  ██ ██    ██         ██',
  ' ██   ██ ███████ ███████ ██ ███████    ██    ██   ██ ██   ████    ██    ███████',
];

// Gradient colors applied per line (top to bottom)
const GRADIENT_COLORS = ['#7dd3fc', '#38bdf8', '#0ea5e9', '#0284c7', '#0369a1'] as const;

const COMPACT_LOGO = 'ASSISTANTS';

const INTRO_FEATURES = [
  'Chat with AI models - Claude, GPT, and more',
  'Install connectors to integrate Notion, Gmail, Google Drive & more',
  'Install skills to automate your workflows',
  'Persistent memory across conversations',
  'Schedules, webhooks, and autonomous operation',
];

const MAX_VISIBLE_CONNECTORS = 5;

function getVisibleRange(
  selectedIndex: number,
  totalItems: number,
  maxVisible: number = MAX_VISIBLE_CONNECTORS
): { start: number; end: number; hasMore: { above: number; below: number } } {
  if (totalItems <= maxVisible) {
    return {
      start: 0,
      end: totalItems,
      hasMore: { above: 0, below: 0 },
    };
  }

  const halfWindow = Math.floor(maxVisible / 2);
  let start = selectedIndex - halfWindow;
  let end = selectedIndex + (maxVisible - halfWindow);

  if (start < 0) {
    start = 0;
    end = maxVisible;
  }

  if (end > totalItems) {
    end = totalItems;
    start = Math.max(0, totalItems - maxVisible);
  }

  return {
    start,
    end,
    hasMore: {
      above: start,
      below: totalItems - end,
    },
  };
}

// ============================================
// Sub-components
// ============================================

function ProgressBar({ step, total }: { step: number; total: number }) {
  const width = 30;
  const filled = Math.round((step / total) * width);
  const empty = width - filled;
  const pct = Math.round((step / total) * 100);
  return (
    <Box marginBottom={1}>
      <Text color="gray">Step {step} of {total}  [</Text>
      <Text color="cyan">{'='.repeat(filled)}</Text>
      <Text color="gray">{' '.repeat(empty)}</Text>
      <Text color="gray">] {pct}%</Text>
    </Box>
  );
}

function MaskedInput({ value, onChange, onSubmit, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  placeholder?: string;
}) {
  // Show first 7 chars + mask the rest
  const masked = value.length > 7
    ? value.slice(0, 7) + '*'.repeat(Math.min(value.length - 7, 32))
    : value;

  return (
    <Box>
      <Text color="cyan">&gt; </Text>
      {value.length === 0 ? (
        <TextInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          placeholder={placeholder}
        />
      ) : (
        <TextInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          placeholder={placeholder}
        />
      )}
    </Box>
  );
}

// ============================================
// Main Component
// ============================================

export function OnboardingPanel({
  onComplete,
  onCancel,
  existingApiKeys,
  existingModel,
  discoveredConnectors,
  discoveredSkills,
}: OnboardingPanelProps) {
  const [currentStep, setCurrentStep] = useState<Step>('welcome');
  const initialProvider = (existingModel && getProviderForModel(existingModel)) || 'anthropic';
  const initialProviderIndex = Math.max(0, LLM_PROVIDERS.findIndex((p) => p.id === initialProvider));
  const initialModels = ALL_MODELS.filter((m) => m.provider === initialProvider);
  const initialModelList = initialModels.length > 0 ? initialModels : ALL_MODELS;
  const initialModelIndex = existingModel
    ? initialModelList.findIndex((m) => m.id === existingModel)
    : 0;
  const [selectedProviderIndex, setSelectedProviderIndex] = useState(initialProviderIndex);
  const [selectedModelIndex, setSelectedModelIndex] = useState(initialModelIndex >= 0 ? initialModelIndex : 0);
  const [apiKey, setApiKey] = useState(existingApiKeys?.[initialProvider] || '');
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [apiKeyValidated, setApiKeyValidated] = useState(!!existingApiKeys?.[initialProvider]);
  const [enabledConnectors, setEnabledConnectors] = useState<Set<string>>(
    () => new Set(discoveredConnectors)
  );
  const [connectorKeysNeeded] = useState<string[]>([]); // Connectors needing API keys
  const currentStepRef = useRef(currentStep);
  currentStepRef.current = currentStep;

  // useSafeInput handles Escape; avoid toggling raw mode directly to prevent conflicts.
  const [connectorKeys, setConnectorKeys] = useState<Record<string, string>>({});
  const [connectorKeyIndex, setConnectorKeyIndex] = useState(0);
  const [connectorKeyValue, setConnectorKeyValue] = useState('');
  const [introRevealCount, setIntroRevealCount] = useState(0);
  const [isCompact, setIsCompact] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const submitGuardRef = useRef(false);

  // Skills state
  const skillsList = discoveredSkills || [];
  const [selectedSkillIndex, setSelectedSkillIndex] = useState(0);

  const selectedProvider = LLM_PROVIDERS[selectedProviderIndex]?.id || 'anthropic';
  const providerModels = ALL_MODELS.filter((m) => m.provider === selectedProvider);
  const availableModels = providerModels.length > 0 ? providerModels : ALL_MODELS;

  useEffect(() => {
    const existingKey = existingApiKeys?.[selectedProvider] || '';
    setApiKey(existingKey);
    setApiKeyValidated(!!existingKey);
    setApiKeyError(null);
    if (selectedModelIndex >= availableModels.length) {
      setSelectedModelIndex(0);
    }
  }, [selectedProvider, existingApiKeys, availableModels.length]);

  useEffect(() => {
    submitGuardRef.current = false;
  }, [currentStep]);

  const logoColor = useGradientCycle(600);
  const { displayed: subtitle, done: subtitleDone } = useTypewriter(
    'Your personal AI assistant for the terminal.',
    25,
    currentStep === 'welcome'
  );

  // Check terminal width for compact mode
  useEffect(() => {
    const cols = process.stdout.columns || 80;
    setIsCompact(cols < 60);
  }, []);

  // Animate intro bullets
  useEffect(() => {
    if (currentStep !== 'intro') return;
    if (introRevealCount >= INTRO_FEATURES.length) return;

    const timer = setTimeout(() => {
      setIntroRevealCount((prev) => prev + 1);
    }, 400);

    return () => clearTimeout(timer);
  }, [currentStep, introRevealCount]);

  const stepIndex = STEPS.indexOf(currentStep) + 1;

  const goNext = useCallback(() => {
    const idx = STEPS.indexOf(currentStep);
    if (idx < STEPS.length - 1) {
      let nextStep = STEPS[idx + 1];
      // Skip connector-keys step if no keys needed
      if (nextStep === 'connector-keys' && connectorKeysNeeded.length === 0) {
        nextStep = 'summary';
      }
      setCurrentStep(nextStep);
    }
  }, [currentStep, connectorKeysNeeded]);

  const goBack = useCallback(() => {
    const idx = STEPS.indexOf(currentStep);
    if (idx > 0) {
      let prevStep = STEPS[idx - 1];
      // Skip connector-keys step going back too
      if (prevStep === 'connector-keys' && connectorKeysNeeded.length === 0) {
        prevStep = 'skills';
      }
      setCurrentStep(prevStep);
    }
  }, [currentStep, connectorKeysNeeded]);

  const handleComplete = useCallback(async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      const selectedModel = availableModels[selectedModelIndex] || availableModels[0];
      await onComplete({
        apiKey,
        provider: selectedProvider,
        model: selectedModel ? selectedModel.id : (existingModel || ''),
        connectors: Array.from(enabledConnectors),
        connectorKeys,
        skills: skillsList.map(s => s.name),
      });
    } finally {
      setIsSaving(false);
    }
  }, [apiKey, selectedModelIndex, enabledConnectors, connectorKeys, onComplete, isSaving, selectedProvider, availableModels, existingModel, skillsList]);

  const submitApiKey = useCallback((value: string) => {
    if (submitGuardRef.current) return;
    submitGuardRef.current = true;
    const key = value.trim();
    const existingKey = existingApiKeys?.[selectedProvider];
    if (!key && existingKey) {
      // Keep existing key
      setApiKey(existingKey);
      setApiKeyValidated(true);
      goNext();
      return;
    }
    if (!key) {
      setApiKeyError('API key is required');
      submitGuardRef.current = false;
      return;
    }
    if (selectedProvider === 'anthropic' && !key.startsWith('sk-ant-')) {
      setApiKeyError('Invalid key format. Anthropic keys start with "sk-ant-"');
      submitGuardRef.current = false;
      return;
    }
    setApiKeyValidated(true);
    goNext();
  }, [existingApiKeys, selectedProvider, goNext]);

  const submitConnectorKey = useCallback((value: string) => {
    if (submitGuardRef.current) return;
    submitGuardRef.current = true;
    const currentConnector = connectorKeysNeeded[connectorKeyIndex];
    if (!currentConnector) {
      goNext();
      return;
    }
    const trimmed = value.trim();
    if (trimmed) {
      setConnectorKeys((prev) => ({ ...prev, [currentConnector]: trimmed }));
    }
    setConnectorKeyValue('');
    if (connectorKeyIndex < connectorKeysNeeded.length - 1) {
      setConnectorKeyIndex((prev) => prev + 1);
      submitGuardRef.current = false;
    } else {
      goNext();
    }
  }, [connectorKeysNeeded, connectorKeyIndex, goNext]);

  // Input handling
  useInput((input, key) => {
    if (key.escape) {
      if (currentStep === 'welcome') {
        onCancel();
      } else {
        goBack();
      }
      return;
    }
    if (key.leftArrow || key.backspace || input === 'b' || input === 'B') {
      if (currentStep !== 'welcome') {
        goBack();
        return;
      }
    }

    // Step-specific input handling
    switch (currentStep) {
      case 'welcome':
        if (key.return) goNext();
        break;

      case 'intro':
        if (key.return) goNext();
        break;

      case 'provider-select':
        if (key.upArrow) {
          setSelectedProviderIndex((prev) => Math.max(0, prev - 1));
        } else if (key.downArrow) {
          setSelectedProviderIndex((prev) => Math.min(LLM_PROVIDERS.length - 1, prev + 1));
        } else if (key.return) {
          goNext();
        }
        break;

      case 'api-key':
        // TextInput handles this
        break;

      case 'model-select':
        if (key.upArrow) {
          setSelectedModelIndex((prev) => Math.max(0, prev - 1));
        } else if (key.downArrow) {
          setSelectedModelIndex((prev) => Math.min(availableModels.length - 1, prev + 1));
        } else if (key.return) {
          goNext();
        }
        break;

      case 'connectors': {
        const connectorList = getConnectorDisplayList();
        if (key.upArrow) {
          setSelectedConnectorIndex((prev) => Math.max(0, prev - 1));
        } else if (key.downArrow) {
          setSelectedConnectorIndex((prev) => Math.min(connectorList.length - 1, prev + 1));
        } else if (input === ' ') {
          // Toggle connector (only installed ones)
          const item = connectorList[selectedConnectorIndex];
          if (item && item.installed) {
            setEnabledConnectors((prev) => {
              const next = new Set(prev);
              if (next.has(item.name)) {
                next.delete(item.name);
              } else {
                next.add(item.name);
              }
              return next;
            });
          }
        } else if (key.return) {
          goNext();
        }
        break;
      }

      case 'skills':
        if (key.upArrow) {
          setSelectedSkillIndex((prev) => Math.max(0, prev - 1));
        } else if (key.downArrow) {
          setSelectedSkillIndex((prev) => Math.min(Math.max(0, skillsList.length - 1), prev + 1));
        } else if (key.return) {
          goNext();
        }
        break;

      case 'connector-keys':
        // TextInput handles this
        break;

      case 'summary':
        if (key.return) {
          handleComplete();
        } else if (!isSaving && input) {
          const keyInput = input.toLowerCase();
          if (keyInput === 'p') {
            setCurrentStep('provider-select');
          } else if (keyInput === 'm') {
            setCurrentStep('model-select');
          } else if (keyInput === 'k') {
            setCurrentStep('api-key');
          } else if (keyInput === 'c') {
            setCurrentStep('connectors');
          } else if (keyInput === 's') {
            setCurrentStep('skills');
          }
        }
        break;
    }
  }, { isActive: currentStep !== 'api-key' && currentStep !== 'connector-keys' });

  // Handle Escape on text-input steps; TextInput owns enter/typing behavior.
  useInput((_input, key) => {
    if (currentStep === 'api-key') {
      if (key.escape) {
        goBack();
      }
      return;
    }
    if (currentStep === 'connector-keys') {
      if (key.escape) {
        goBack();
      }
    }
  }, { isActive: currentStep === 'api-key' || currentStep === 'connector-keys' });

  // Connector display list
  const [selectedConnectorIndex, setSelectedConnectorIndex] = useState(0);

  const getConnectorDisplayList = useCallback(() => {
    const items: Array<{ name: string; desc: string; installed: boolean; install?: string }> = [];

    // Installed connectors first
    for (const name of discoveredConnectors) {
      const info = POPULAR_CONNECTORS[name];
      items.push({
        name,
        desc: info?.desc || `${name} connector`,
        installed: true,
      });
    }

    // Popular uninstalled suggestions
    for (const [name, info] of Object.entries(POPULAR_CONNECTORS)) {
      if (!discoveredConnectors.includes(name)) {
        items.push({
          name,
          desc: info.desc,
          installed: false,
          install: info.install,
        });
      }
    }

    return items;
  }, [discoveredConnectors]);

  useEffect(() => {
    const list = getConnectorDisplayList();
    setSelectedConnectorIndex((prev) => Math.min(prev, Math.max(0, list.length - 1)));
  }, [getConnectorDisplayList]);

  // ============================================
  // Render: Welcome
  // ============================================
  if (currentStep === 'welcome') {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box marginTop={1} marginBottom={0} flexDirection="column">
          {isCompact ? (
            <Text bold color={logoColor}>{COMPACT_LOGO}</Text>
          ) : (
            LOGO_LINES.map((line, i) => (
              <Text key={i} color={GRADIENT_COLORS[i] || GRADIENT_COLORS[GRADIENT_COLORS.length - 1]}>{line}</Text>
            ))
          )}
        </Box>
        <Box marginBottom={1}>
          <Text dimColor>  by </Text><Text color="#94a3b8" bold>hasna</Text>
        </Box>
        <Box marginBottom={1}>
          <Text color="cyan">&gt; </Text>
          <Text>{subtitle}</Text>
          {!subtitleDone && <Text color="cyan">_</Text>}
        </Box>
        <Text color="gray">Press Enter to get started...</Text>
        <Text color="gray" dimColor>Press Escape to skip</Text>
      </Box>
    );
  }

  // ============================================
  // Render: Intro
  // ============================================
  if (currentStep === 'intro') {
    return (
      <Box flexDirection="column" paddingX={1}>
        <ProgressBar step={stepIndex} total={STEPS.length} />
        <Text bold>What can assistants do?</Text>
        <Box flexDirection="column" marginTop={1} marginBottom={1}>
          {INTRO_FEATURES.slice(0, introRevealCount).map((feature, i) => (
            <Box key={i}>
              <Text color="cyan">  &gt; </Text>
              <Text>{feature}</Text>
            </Box>
          ))}
          {introRevealCount < INTRO_FEATURES.length && (
            <Text color="gray">  ...</Text>
          )}
        </Box>
        <Text color="gray">Press Enter to continue...</Text>
        <Text color="gray">Esc or B to go back</Text>
      </Box>
    );
  }

  // ============================================
  // Render: Provider Select
  // ============================================
  if (currentStep === 'provider-select') {
    return (
      <Box flexDirection="column" paddingX={1}>
        <ProgressBar step={stepIndex} total={STEPS.length} />
        <Text bold>Choose your provider</Text>
        <Box flexDirection="column" marginTop={1} marginBottom={1}>
          {LLM_PROVIDERS.map((provider, i) => (
            <Box key={provider.id}>
              <Text color={i === selectedProviderIndex ? 'cyan' : 'gray'}>
                {i === selectedProviderIndex ? '  > ' : '    '}
              </Text>
              <Text bold={i === selectedProviderIndex} color={i === selectedProviderIndex ? 'white' : undefined}>
                {provider.label}
              </Text>
              <Text color="gray">  {provider.description}</Text>
            </Box>
          ))}
        </Box>
        <Text color="gray">Arrow keys to move, Enter to continue</Text>
        <Text color="gray">Esc or B to go back</Text>
      </Box>
    );
  }

  // ============================================
  // Render: API Key
  // ============================================
  if (currentStep === 'api-key') {
    const providerInfo = getProviderInfo(selectedProvider);
    const providerLabel = getProviderLabel(selectedProvider);
    const envName = providerInfo?.apiKeyEnv || 'API_KEY';
    const existingKey = existingApiKeys?.[selectedProvider];
    return (
      <Box flexDirection="column" paddingX={1}>
        <ProgressBar step={stepIndex} total={STEPS.length} />
        <Text bold>Let's set up your API key</Text>
        <Box marginTop={1} marginBottom={1} flexDirection="column">
          <Text>assistants uses {providerLabel}. You'll need an API key.</Text>
          {providerInfo?.docsUrl ? (
            <Text>Get one at: <Text color="cyan" underline>{providerInfo.docsUrl}</Text></Text>
          ) : null}
        </Box>
        {existingKey ? (
          <Box flexDirection="column">
            <Text color="green">Existing API key detected: {existingKey.slice(0, 10)}...{existingKey.slice(-4)}</Text>
            <Box marginTop={1}>
              <Text color="gray">Press Enter to keep it, or type a new key:</Text>
            </Box>
          </Box>
        ) : null}
        <Box marginTop={1}>
          <Text>Enter your {providerLabel} API key ({envName}):</Text>
        </Box>
        <Box>
          <Text color="cyan">&gt; </Text>
            <TextInput
              value={apiKey}
              onChange={(v) => {
                setApiKey(v);
                setApiKeyError(null);
                setApiKeyValidated(false);
              }}
              onSubmit={submitApiKey}
              focus
              placeholder={selectedProvider === 'anthropic' ? 'sk-ant-...' : 'api-key'}
            />
        </Box>
        {apiKeyError && (
          <Box marginTop={1}>
            <Text color="red">{apiKeyError}</Text>
          </Box>
        )}
        {apiKeyValidated && (
          <Box marginTop={1}>
            <Text color="green">Key validated successfully!</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text color="gray">Escape to go back</Text>
        </Box>
      </Box>
    );
  }

  // ============================================
  // Render: Model Selection
  // ============================================
  if (currentStep === 'model-select') {
    return (
      <Box flexDirection="column" paddingX={1}>
        <ProgressBar step={stepIndex} total={STEPS.length} />
        <Text bold>Choose your default model</Text>
        <Box flexDirection="column" marginTop={1} marginBottom={1}>
          {availableModels.map((model, i) => (
            <Box key={model.id}>
              <Text color={i === selectedModelIndex ? 'cyan' : 'gray'}>
                {i === selectedModelIndex ? '  > ' : '    '}
              </Text>
              <Text bold={i === selectedModelIndex} color={i === selectedModelIndex ? 'white' : undefined}>
                {model.name}
              </Text>
              <Text color="gray">  {model.description}</Text>
            </Box>
          ))}
        </Box>
        <Text color="gray">Arrow keys to select, Enter to confirm</Text>
        <Text color="gray">Esc or B to go back</Text>
      </Box>
    );
  }

  // ============================================
  // Render: Connectors
  // ============================================
  if (currentStep === 'connectors') {
    const connectorList = getConnectorDisplayList();
    const visibleRange = getVisibleRange(selectedConnectorIndex, connectorList.length);
    const visibleConnectors = connectorList.slice(visibleRange.start, visibleRange.end);

    return (
      <Box flexDirection="column" paddingX={1}>
        <ProgressBar step={stepIndex} total={STEPS.length} />
        <Text bold>Connectors</Text>
        <Box marginTop={1} marginBottom={1} flexDirection="column">
          <Text color="gray">Connectors integrate external services. Install packages to add more.</Text>
          <Text color="gray" dimColor>Coming soon: <Text color="cyan">bun add -g @hasna/connectors</Text></Text>
        </Box>
        <Box flexDirection="column">
          {visibleRange.hasMore.above > 0 && (
            <Text dimColor>  ^ {visibleRange.hasMore.above} more above</Text>
          )}
          {visibleConnectors.map((connector, visibleIdx) => {
            const actualIdx = visibleRange.start + visibleIdx;
            const isSelected = actualIdx === selectedConnectorIndex;
            const enabled = connector.installed && enabledConnectors.has(connector.name);
            const desc = connector.desc || '';
            const descDisplay = desc.length > 32 ? desc.slice(0, 29) + '...' : desc;
            const checkbox = connector.installed ? (enabled ? 'x' : ' ') : ' ';
            return (
              <Box key={connector.name}>
                <Text color={isSelected ? 'cyan' : 'gray'}>
                  {isSelected ? '> ' : '  '}
                </Text>
                <Text color={connector.installed ? (enabled ? 'green' : 'gray') : 'gray'}>
                  [{checkbox}]
                </Text>
                <Text> {connector.name}</Text>
                {connector.installed ? (
                  <Text color="gray">  {descDisplay}</Text>
                ) : (
                  <Text dimColor>  (not installed) {connector.install}</Text>
                )}
              </Box>
            );
          })}
          {visibleRange.hasMore.below > 0 && (
            <Text dimColor>  v {visibleRange.hasMore.below} more below</Text>
          )}
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text color="gray">Arrow keys to move, Space to toggle installed, Enter to continue</Text>
          <Text color="gray">Esc or B to go back</Text>
        </Box>
      </Box>
    );
  }

  // ============================================
  // Render: Skills
  // ============================================
  if (currentStep === 'skills') {
    return (
      <Box flexDirection="column" paddingX={1}>
        <ProgressBar step={stepIndex} total={STEPS.length} />
        <Text bold>Skills</Text>
        <Box marginTop={1} marginBottom={1} flexDirection="column">
          <Text color="gray">Skills teach your assistant specialized workflows.</Text>
          <Text color="gray" dimColor>Coming soon: <Text color="cyan">bun add -g @hasna/skills</Text></Text>
        </Box>
        {skillsList.length > 0 ? (
          <Box flexDirection="column">
            {skillsList.map((skill, i) => {
              const isSelected = i === selectedSkillIndex;
              return (
                <Box key={skill.name}>
                  <Text color={isSelected ? 'cyan' : 'gray'}>
                    {isSelected ? '> ' : '  '}
                  </Text>
                  <Text color="green">[x]</Text>
                  <Text> /{skill.name}</Text>
                  {skill.description && (
                    <Text color="gray">  {skill.description.length > 40 ? skill.description.slice(0, 37) + '...' : skill.description}</Text>
                  )}
                </Box>
              );
            })}
          </Box>
        ) : (
          <Box marginBottom={1}>
            <Text dimColor>  No skills discovered. Add SKILL.md files to ~/.assistants/skills/</Text>
          </Box>
        )}
        <Box marginTop={1} flexDirection="column">
          <Text color="gray">Press Enter to continue...</Text>
          <Text color="gray">Esc or B to go back</Text>
        </Box>
      </Box>
    );
  }

  // ============================================
  // Render: Connector Keys
  // ============================================
  if (currentStep === 'connector-keys') {
    const currentConnector = connectorKeysNeeded[connectorKeyIndex];
    if (!currentConnector) {
      // No more keys needed, advance
      goNext();
      return null;
    }

    return (
      <Box flexDirection="column" paddingX={1}>
        <ProgressBar step={stepIndex} total={STEPS.length} />
        <Text bold>Configure connector: {currentConnector}</Text>
        <Box marginTop={1}>
          <Text>Enter API key for {currentConnector}:</Text>
        </Box>
        <Box>
          <Text color="cyan">&gt; </Text>
          <TextInput
            value={connectorKeyValue}
            onChange={setConnectorKeyValue}
            onSubmit={submitConnectorKey}
            focus
            placeholder="Enter API key or press Enter to skip"
          />
        </Box>
        <Box marginTop={1}>
          <Text color="gray">{connectorKeyIndex + 1} of {connectorKeysNeeded.length} connectors</Text>
        </Box>
      </Box>
    );
  }

  // ============================================
  // Render: Summary
  // ============================================
  if (currentStep === 'summary') {
    const maskedKey = apiKey.length > 14
      ? apiKey.slice(0, 10) + '...' + apiKey.slice(-4)
      : apiKey.slice(0, 7) + '...';
    const selectedModel = availableModels[selectedModelIndex] || availableModels[0];
    const modelLabel = selectedModel ? `${selectedModel.name} (${getProviderLabel(selectedProvider)})` : 'unknown';
    const connectorList = Array.from(enabledConnectors).join(', ') || 'none';
    const skillsDisplay = skillsList.length > 0 ? skillsList.map(s => s.name).join(', ') : 'none';
    const modelDisplay = modelLabel.length > 24 ? modelLabel.slice(0, 21) + '...' : modelLabel.padEnd(24);

    return (
      <Box flexDirection="column" paddingX={1}>
        <ProgressBar step={stepIndex} total={STEPS.length} />
        <Text bold color="green">You're all set!</Text>
        <Box marginTop={1} flexDirection="column">
          <Text color="gray">{'┌─────────────────────────────────────┐'}</Text>
          <Text color="gray">{'│'} <Text bold>Configuration Summary</Text>{'              │'}</Text>
          <Text color="gray">{'├─────────────────────────────────────┤'}</Text>
          <Text color="gray">{'│'} API Key:    <Text>{maskedKey.padEnd(24)}</Text>{'│'}</Text>
          <Text color="gray">{'│'} Model:      <Text>{modelDisplay}</Text>{'│'}</Text>
          <Text color="gray">{'│'} Connectors: <Text>{connectorList.length > 24 ? connectorList.slice(0, 21) + '...' : connectorList.padEnd(24)}</Text>{'│'}</Text>
          <Text color="gray">{'│'} Skills:     <Text>{skillsDisplay.length > 24 ? skillsDisplay.slice(0, 21) + '...' : skillsDisplay.padEnd(24)}</Text>{'│'}</Text>
          <Text color="gray">{'│'} Config:     <Text>{'~/.assistants/'.padEnd(24)}</Text>{'│'}</Text>
          <Text color="gray">{'└─────────────────────────────────────┘'}</Text>
        </Box>
        <Box marginTop={1}>
          {isSaving ? (
            <Text color="yellow">Saving configuration...</Text>
          ) : (
            <Text color="gray">Press Enter to start chatting...</Text>
          )}
        </Box>
        {!isSaving && (
          <Box marginTop={1} flexDirection="column">
            <Text color="gray">Edit: (P)rovider  (M)odel  (K)ey  (C)onnectors  (S)kills</Text>
            <Text color="gray">Esc or B to go back</Text>
          </Box>
        )}
      </Box>
    );
  }

  return null;
}
