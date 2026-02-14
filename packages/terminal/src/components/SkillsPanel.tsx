import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import type { Skill } from '@hasna/assistants-shared';
import { useSafeInput as useInput } from '../hooks/useSafeInput';
import type { CreateSkillOptions, CreateSkillResult, SkillScope } from '@hasna/assistants-core';

interface SkillsPanelProps {
  skills: Skill[];
  onExecute: (name: string) => void;
  onCreate: (options: CreateSkillOptions) => Promise<CreateSkillResult>;
  onGenerateDraft?: (prompt: string, scope: SkillScope) => Promise<SkillDraft>;
  onDelete: (name: string, filePath: string) => Promise<void>;
  onRefresh: () => Promise<Skill[]>;
  onEnsureContent: (name: string) => Promise<Skill | null>;
  onClose: () => void;
  cwd: string;
}

type Mode = 'list' | 'detail' | 'delete-confirm' | 'create';
type CreateStep = 'scope' | 'prompt' | 'name' | 'description' | 'tools' | 'hint' | 'content' | 'confirm';
type CreateMode = 'manual' | 'prompt';

type SkillDraft = {
  name?: string;
  description?: string;
  allowedTools?: string[];
  argumentHint?: string;
  content?: string;
};

const SCOPE_OPTIONS: { id: SkillScope; label: string; desc: string }[] = [
  { id: 'project', label: 'Project', desc: 'Local to this project (.skill/)' },
  { id: 'global', label: 'Global', desc: 'Available everywhere (~/.skill/)' },
];

const MAX_VISIBLE_SKILLS = 10;

function getVisibleRange(
  selectedIndex: number,
  totalItems: number,
  maxVisible: number = MAX_VISIBLE_SKILLS
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

function getSkillScope(filePath: string): 'global' | 'project' {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const globalPrefix = `${home}/.skill/`;
  if (filePath.startsWith(globalPrefix) || filePath.includes('/.skill/') && filePath.includes(home)) {
    return 'global';
  }
  return 'project';
}

export function SkillsPanel({
  skills: initialSkills,
  onExecute,
  onCreate,
  onGenerateDraft,
  onDelete,
  onRefresh,
  onEnsureContent,
  onClose,
  cwd,
}: SkillsPanelProps) {
  const [skills, setSkills] = useState(initialSkills);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<Mode>('list');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [detailSkill, setDetailSkill] = useState<Skill | null>(null);

  // Create flow state
  const [createMode, setCreateMode] = useState<CreateMode>('manual');
  const [createStep, setCreateStep] = useState<CreateStep>('scope');
  const [createScopeIndex, setCreateScopeIndex] = useState(0);
  const [createPrompt, setCreatePrompt] = useState('');
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createTools, setCreateTools] = useState('');
  const [createHint, setCreateHint] = useState('');
  const [createContent, setCreateContent] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  // Group skills by scope
  const projectSkills = skills.filter(s => getSkillScope(s.filePath) === 'project');
  const globalSkills = skills.filter(s => getSkillScope(s.filePath) === 'global');
  const sortedSkills = [...projectSkills, ...globalSkills];
  const totalItems = sortedSkills.length + 1; // +1 for "New skill" action

  useEffect(() => {
    setSkills(initialSkills);
  }, [initialSkills]);

  useEffect(() => {
    setSelectedIndex((prev) => Math.min(prev, Math.max(0, totalItems - 1)));
  }, [totalItems]);

  const selectedSkill = selectedIndex < sortedSkills.length ? sortedSkills[selectedIndex] : undefined;

  useEffect(() => {
    if (mode === 'detail' && !detailSkill) {
      setMode('list');
    }
  }, [mode, detailSkill]);

  useEffect(() => {
    if (mode === 'delete-confirm' && !selectedSkill) {
      setMode('list');
    }
  }, [mode, selectedSkill]);

  function resetCreateState() {
    setCreateMode('manual');
    setCreateStep('scope');
    setCreateScopeIndex(0);
    setCreatePrompt('');
    setCreateName('');
    setCreateDescription('');
    setCreateTools('');
    setCreateHint('');
    setCreateContent('');
    setCreateError(null);
  }

  function normalizeDraftName(name: string): string {
    const trimmed = name.trim();
    if (!trimmed) return '';
    const withoutPrefix = trimmed.replace(/^skill[-\s]*/i, '').replace(/\bskill\b/gi, '').trim();
    return withoutPrefix || trimmed;
  }

  async function handlePromptSubmit() {
    const prompt = createPrompt.trim();
    if (!prompt) {
      setCreateError('Prompt is required');
      return;
    }
    if (!onGenerateDraft) {
      setCreateError('Skill generation is not available.');
      return;
    }

    setIsSubmitting(true);
    setCreateError(null);
    try {
      const scope = SCOPE_OPTIONS[createScopeIndex].id;
      const draft = await onGenerateDraft(prompt, scope);
      const normalizedName = draft.name ? normalizeDraftName(draft.name) : '';
      if (normalizedName) setCreateName(normalizedName);
      if (draft.description) setCreateDescription(draft.description);
      if (draft.allowedTools && draft.allowedTools.length > 0) {
        setCreateTools(draft.allowedTools.join(', '));
      }
      if (draft.argumentHint) setCreateHint(draft.argumentHint);
      if (draft.content) setCreateContent(draft.content);
      if (!normalizedName) {
        setCreateError('Draft missing name. Please enter one.');
        setCreateStep('name');
        return;
      }
      setCreateStep('confirm');
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCreateSubmit() {
    const scope = SCOPE_OPTIONS[createScopeIndex].id;
    const name = createName.trim();
    if (!name) {
      setCreateError('Name is required');
      setCreateStep('name');
      return;
    }

    const tools = createTools.trim()
      ? createTools.split(',').map(t => t.trim()).filter(Boolean)
      : undefined;

    setIsSubmitting(true);
    setCreateError(null);
    try {
      await onCreate({
        name,
        scope,
        description: createDescription.trim() || undefined,
        allowedTools: tools,
        argumentHint: createHint.trim() || undefined,
        content: createContent.trim() || undefined,
        cwd,
      });
      const refreshed = await onRefresh();
      setSkills(refreshed);
      resetCreateState();
      setMode('list');
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  // Create mode input - non-text steps
  useInput((input, key) => {
    if (mode !== 'create') return;

    // Steps that use TextInput handle their own input
    if (['prompt', 'name', 'description', 'tools', 'hint', 'content'].includes(createStep)) return;

    if (key.escape) {
      if (createStep === 'scope') {
        resetCreateState();
        setMode('list');
      } else {
        const stepOrder: CreateStep[] = createMode === 'prompt'
          ? ['scope', 'prompt', 'name', 'description', 'tools', 'hint', 'content', 'confirm']
          : ['scope', 'name', 'description', 'tools', 'hint', 'content', 'confirm'];
        const currentIdx = stepOrder.indexOf(createStep);
        if (currentIdx > 0) {
          setCreateStep(stepOrder[currentIdx - 1]);
        } else {
          resetCreateState();
          setMode('list');
        }
      }
      return;
    }

    // Scope selection
    if (createStep === 'scope') {
      if (key.upArrow) {
        setCreateScopeIndex((prev) => (prev === 0 ? SCOPE_OPTIONS.length - 1 : prev - 1));
        return;
      }
      if (key.downArrow) {
        setCreateScopeIndex((prev) => (prev === SCOPE_OPTIONS.length - 1 ? 0 : prev + 1));
        return;
      }
      if (key.return) {
        setCreateStep(createMode === 'prompt' ? 'prompt' : 'name');
        return;
      }
    }

    // Confirm step
    if (createStep === 'confirm') {
      if (key.return || input === 'y' || input === 'Y') {
        handleCreateSubmit();
        return;
      }
      if (input === 'n' || input === 'N') {
        resetCreateState();
        setMode('list');
        return;
      }
    }
  }, { isActive: mode === 'create' && !['prompt', 'name', 'description', 'tools', 'hint', 'content'].includes(createStep) });

  // Create mode input - text steps (escape/back)
  useInput((input, key) => {
    if (mode !== 'create') return;
    if (!['prompt', 'name', 'description', 'tools', 'hint', 'content'].includes(createStep)) return;
    if (!key.escape) return;

    const stepOrder: CreateStep[] = createMode === 'prompt'
      ? ['scope', 'prompt', 'name', 'description', 'tools', 'hint', 'content', 'confirm']
      : ['scope', 'name', 'description', 'tools', 'hint', 'content', 'confirm'];
    const currentIdx = stepOrder.indexOf(createStep);
    if (currentIdx > 0) {
      setCreateStep(stepOrder[currentIdx - 1]);
    } else {
      resetCreateState();
      setMode('list');
    }
  }, { isActive: mode === 'create' && ['prompt', 'name', 'description', 'tools', 'hint', 'content'].includes(createStep) });

  // List/detail/delete mode input
  useInput((input, key) => {
    if (mode === 'create') return;

    if (mode === 'delete-confirm') {
      if (input === 'y' || input === 'Y') {
        if (selectedSkill) {
          setIsSubmitting(true);
          onDelete(selectedSkill.name, selectedSkill.filePath).then(() => {
            return onRefresh();
          }).then((refreshed) => {
            setSkills(refreshed);
            setMode('list');
          }).finally(() => {
            setIsSubmitting(false);
          });
        }
        return;
      }
      if (input === 'n' || input === 'N' || key.escape) {
        setMode('list');
        return;
      }
      return;
    }

    if (mode === 'detail') {
      if (key.escape || input === 'q' || input === 'Q') {
        setDetailSkill(null);
        setMode('list');
        return;
      }
      if (input === 'x' || input === 'X') {
        if (detailSkill) {
          onExecute(detailSkill.name);
          setDetailSkill(null);
          setMode('list');
          onClose();
        }
        return;
      }
      if (input === 'd' || input === 'D') {
        setMode('delete-confirm');
        return;
      }
      return;
    }

    // List mode
    if (key.escape || input === 'q' || input === 'Q') {
      onClose();
      return;
    }

    if (input === 'n' || input === 'N') {
      resetCreateState();
      setCreateMode('manual');
      setMode('create');
      return;
    }
    if (input === 'p' || input === 'P') {
      resetCreateState();
      setCreateMode('prompt');
      setMode('create');
      return;
    }

    if (key.return) {
      if (selectedIndex === sortedSkills.length) {
        // "New skill" option at bottom
        resetCreateState();
        setCreateMode('manual');
        setMode('create');
      } else if (selectedSkill) {
        // Open detail view, loading content if needed
        setIsSubmitting(true);
        onEnsureContent(selectedSkill.name).then((loaded) => {
          if (loaded) {
            setDetailSkill(loaded);
          } else {
            setDetailSkill(selectedSkill);
          }
          setMode('detail');
        }).finally(() => {
          setIsSubmitting(false);
        });
      }
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((prev) => (prev === 0 ? totalItems - 1 : prev - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((prev) => (prev === totalItems - 1 ? 0 : prev + 1));
      return;
    }

    if (input === 'x' || input === 'X') {
      if (selectedSkill) {
        onExecute(selectedSkill.name);
        onClose();
      }
      return;
    }

    if (input === 'd' || input === 'D') {
      if (selectedSkill) setMode('delete-confirm');
      return;
    }

    if (input === 'f' || input === 'F') {
      setIsSubmitting(true);
      onRefresh().then((refreshed) => {
        setSkills(refreshed);
      }).finally(() => {
        setIsSubmitting(false);
      });
      return;
    }

    const num = parseInt(input, 10);
    if (!isNaN(num) && num >= 1 && num <= sortedSkills.length) {
      setSelectedIndex(num - 1);
      return;
    }
  }, { isActive: mode !== 'create' });

  // ── Create mode UI ──────────────────────────────────────────────

  if (mode === 'create') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">
            {createMode === 'prompt' ? 'New Skill (Prompt)' : 'New Skill'}
          </Text>
        </Box>

        <Box flexDirection="column" borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} paddingX={1} paddingY={1}>
          {/* Step 1: Scope selection */}
          {createStep === 'scope' && (
            <Box flexDirection="column">
              <Text bold>Select scope:</Text>
              <Box flexDirection="column" marginTop={1}>
                {SCOPE_OPTIONS.map((opt, idx) => (
                  <Box key={opt.id}>
                    <Text inverse={idx === createScopeIndex}>
                      {idx === createScopeIndex ? '>' : ' '} {opt.label.padEnd(10)} <Text dimColor>{opt.desc}</Text>
                    </Text>
                  </Box>
                ))}
              </Box>
              <Box marginTop={1}>
                <Text dimColor>↑↓ select | Enter confirm | Esc cancel</Text>
              </Box>
            </Box>
          )}

          {/* Step 2: Prompt */}
          {createStep === 'prompt' && (
            <Box flexDirection="column">
              <Text bold>Describe what this skill should do:</Text>
              <Box marginTop={1}>
                <TextInput
                  value={createPrompt}
                  onChange={setCreatePrompt}
                  onSubmit={handlePromptSubmit}
                  focus
                  placeholder="e.g. Summarize meeting notes and draft follow-up"
                />
              </Box>
              <Box marginTop={1}>
                <Text dimColor>Enter generate | Esc back</Text>
              </Box>
            </Box>
          )}

          {/* Step 2: Name */}
          {createStep === 'name' && (
            <Box flexDirection="column">
              <Text bold>Enter skill name:</Text>
              <Box marginTop={1}>
                <Text>Name: </Text>
                <TextInput
                  value={createName}
                  onChange={setCreateName}
                  onSubmit={() => {
                    if (createName.trim()) setCreateStep('description');
                  }}
                  focus
                  placeholder="e.g. my-helper"
                />
              </Box>
              <Box marginTop={1}>
                <Text dimColor>Enter next | Esc back</Text>
              </Box>
            </Box>
          )}

          {/* Step 3: Description */}
          {createStep === 'description' && (
            <Box flexDirection="column">
              <Text bold>Description (optional):</Text>
              <Box marginTop={1}>
                <TextInput
                  value={createDescription}
                  onChange={setCreateDescription}
                  onSubmit={() => setCreateStep('tools')}
                  focus
                  placeholder="What does this skill do?"
                />
              </Box>
              <Box marginTop={1}>
                <Text dimColor>Enter next | Esc back</Text>
              </Box>
            </Box>
          )}

          {/* Step 4: Allowed tools */}
          {createStep === 'tools' && (
            <Box flexDirection="column">
              <Text bold>Allowed tools (optional, comma-separated):</Text>
              <Box marginTop={1}>
                <TextInput
                  value={createTools}
                  onChange={setCreateTools}
                  onSubmit={() => setCreateStep('hint')}
                  focus
                  placeholder="e.g. bash, filesystem"
                />
              </Box>
              <Box marginTop={1}>
                <Text dimColor>Enter next | Esc back</Text>
              </Box>
            </Box>
          )}

          {/* Step 5: Argument hint */}
          {createStep === 'hint' && (
            <Box flexDirection="column">
              <Text bold>Argument hint (optional):</Text>
              <Box marginTop={1}>
                <TextInput
                  value={createHint}
                  onChange={setCreateHint}
                  onSubmit={() => setCreateStep('content')}
                  focus
                  placeholder="e.g. [filename] [options]"
                />
              </Box>
              <Box marginTop={1}>
                <Text dimColor>Enter next | Esc back</Text>
              </Box>
            </Box>
          )}

          {/* Step 6: Content */}
          {createStep === 'content' && (
            <Box flexDirection="column">
              <Text bold>Skill content (optional, single line):</Text>
              <Box marginTop={1}>
                <TextInput
                  value={createContent}
                  onChange={setCreateContent}
                  onSubmit={() => setCreateStep('confirm')}
                  focus
                  placeholder="Instructions for the skill (or leave empty for default template)"
                />
              </Box>
              <Box marginTop={1}>
                <Text dimColor>Enter next | Esc back</Text>
              </Box>
            </Box>
          )}

          {/* Step 7: Confirm */}
          {createStep === 'confirm' && (
            <Box flexDirection="column">
              <Text bold>Confirm new skill:</Text>
              <Box flexDirection="column" marginTop={1} marginLeft={1}>
                <Text>Scope: <Text color="cyan">{SCOPE_OPTIONS[createScopeIndex].label}</Text></Text>
                <Text>Name: <Text color="cyan">{createName}</Text></Text>
                {createDescription && <Text>Description: <Text dimColor>{createDescription}</Text></Text>}
                {createTools && <Text>Tools: <Text dimColor>{createTools}</Text></Text>}
                {createHint && <Text>Hint: <Text dimColor>{createHint}</Text></Text>}
                {createContent && (
                  <>
                    <Text>Content:</Text>
                    <Box marginLeft={2} flexDirection="column">
                      {createContent.split('\n').slice(0, 6).map((line, i) => (
                        <Text key={i} dimColor>{line}</Text>
                      ))}
                      {createContent.split('\n').length > 6 && (
                        <Text dimColor>... ({createContent.split('\n').length - 6} more lines)</Text>
                      )}
                    </Box>
                  </>
                )}
              </Box>
              <Box marginTop={1}>
                <Text dimColor>Enter/y create | n cancel | Esc back</Text>
              </Box>
            </Box>
          )}

          {createError && (
            <Box marginTop={1}>
              <Text color="red">{createError}</Text>
            </Box>
          )}
        </Box>

        {isSubmitting && (
          <Box marginTop={1}>
            <Text color="yellow">
              {createMode === 'prompt' && createStep === 'prompt' ? 'Generating draft...' : 'Creating skill...'}
            </Text>
          </Box>
        )}
      </Box>
    );
  }

  // ── Delete confirmation ─────────────────────────────────────────

  if (mode === 'delete-confirm') {
    const skill = detailSkill || selectedSkill;
    const displayName = skill?.name || '';
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="red">Delete Skill</Text>
        </Box>
        <Box marginBottom={1}>
          <Text>
            Delete skill &quot;{displayName}&quot;?
          </Text>
        </Box>
        {skill && (
          <Box marginBottom={1}>
            <Text dimColor>File: {skill.filePath}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text>
            Press <Text color="green" bold>y</Text> to confirm or{' '}
            <Text color="red" bold>n</Text> to cancel
          </Text>
        </Box>
      </Box>
    );
  }

  // ── Detail mode ─────────────────────────────────────────────────

  if (mode === 'detail' && detailSkill) {
    const s = detailSkill;
    const scope = getSkillScope(s.filePath);

    return (
      <Box flexDirection="column" paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color="cyan">Skill Details</Text>
        </Box>

        <Box flexDirection="column" borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} paddingX={1} paddingY={0}>
          <Box><Text bold>Name: </Text><Text color="cyan">{s.name}</Text></Box>
          <Box><Text bold>Scope: </Text><Text>{scope}</Text>{s.source && <Text dimColor> ({s.source})</Text>}{s.version && <Text dimColor> v{s.version}</Text>}</Box>
          {s.description && <Box><Text bold>Description: </Text><Text>{s.description}</Text></Box>}
          {s.argumentHint && <Box><Text bold>Argument Hint: </Text><Text>{s.argumentHint}</Text></Box>}
          {s.allowedTools && s.allowedTools.length > 0 && (
            <Box><Text bold>Allowed Tools: </Text><Text>{s.allowedTools.join(', ')}</Text></Box>
          )}
          {s.model && <Box><Text bold>Model: </Text><Text>{s.model}</Text></Box>}
          <Box><Text bold>File: </Text><Text dimColor>{s.filePath}</Text></Box>

          {s.contentLoaded && s.content && (
            <>
              <Box marginTop={1}><Text bold>Content:</Text></Box>
              <Box marginLeft={2} flexDirection="column">
                {s.content.split('\n').slice(0, 20).map((line, i) => (
                  <Text key={i} wrap="wrap" dimColor>{line}</Text>
                ))}
                {s.content.split('\n').length > 20 && (
                  <Text dimColor>... ({s.content.split('\n').length - 20} more lines)</Text>
                )}
              </Box>
            </>
          )}
        </Box>

        <Box marginTop={1}>
          <Text dimColor>
            [x]execute | [d]elete | Esc/q back
          </Text>
        </Box>

        {isSubmitting && <Box marginTop={1}><Text color="yellow">Loading...</Text></Box>}
      </Box>
    );
  }

  // ── List mode ───────────────────────────────────────────────────

  const totalSkills = sortedSkills.length;
  const selectedForRange = totalSkills === 0 ? 0 : Math.min(selectedIndex, totalSkills - 1);
  const skillRange = getVisibleRange(selectedForRange, totalSkills, MAX_VISIBLE_SKILLS);
  const visibleSkills = sortedSkills.slice(skillRange.start, skillRange.end);
  const visibleEntries = visibleSkills.map((skill, offset) => {
    const actualIdx = skillRange.start + offset;
    const group: 'project' | 'global' = actualIdx < projectSkills.length ? 'project' : 'global';
    return { skill, actualIdx, group };
  });
  let lastGroup: 'project' | 'global' | null = null;

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box marginBottom={1} justifyContent="space-between">
        <Text bold>Skills</Text>
        <Text dimColor>[n]ew [p]rompt [x]execute [d]elete [f]refresh</Text>
      </Box>

      <Box marginBottom={1}>
        <Text dimColor>
          {sortedSkills.length} skill(s) — {projectSkills.length} project, {globalSkills.length} global
        </Text>
      </Box>

      <Box flexDirection="column" borderStyle="round" borderColor="#d4d4d8" borderLeft={false} borderRight={false} paddingX={1}>
        {sortedSkills.length === 0 ? (
          <Box paddingY={1}>
            <Text dimColor>No skills loaded. Press n to create one.</Text>
          </Box>
        ) : (
          <>
            {skillRange.hasMore.above > 0 && (
              <Box paddingY={0}>
                <Text dimColor>  ↑ {skillRange.hasMore.above} more above</Text>
              </Box>
            )}
            {visibleEntries.map((entry) => {
              const desc = entry.skill.description ? ` - ${entry.skill.description}` : '';
              const isSelected = entry.actualIdx === selectedIndex;
              const header = entry.group !== lastGroup
                ? (
                  <Box marginTop={lastGroup ? 1 : 0}>
                    <Text bold dimColor>
                      {entry.group === 'project' ? 'Project Skills' : 'Global Skills'}
                    </Text>
                  </Box>
                )
                : null;
              lastGroup = entry.group;
              const badge = entry.skill.source === 'npm' ? ' [npm]' : '';
              return (
                <React.Fragment key={`${entry.skill.name}-${entry.actualIdx}`}>
                  {header}
                  <Box paddingY={0}>
                    <Text inverse={isSelected}>
                      {isSelected ? '>' : ' '} {(entry.actualIdx + 1).toString().padStart(2)}. {entry.skill.name.padEnd(20)}{desc.slice(0, 40)}{badge}
                    </Text>
                  </Box>
                </React.Fragment>
              );
            })}
            {skillRange.hasMore.below > 0 && (
              <Box paddingY={0}>
                <Text dimColor>  ↓ {skillRange.hasMore.below} more below</Text>
              </Box>
            )}
          </>
        )}

        {/* New skill option at bottom */}
        <Box marginTop={1} paddingY={0}>
          <Text
            inverse={selectedIndex === sortedSkills.length}
            dimColor={selectedIndex !== sortedSkills.length}
            color={selectedIndex === sortedSkills.length ? 'cyan' : undefined}
          >
            + New skill (n) | Prompt (p)
          </Text>
        </Box>
      </Box>

      {/* Compact preview of selected */}
      {selectedSkill && selectedIndex < sortedSkills.length && (
        <Box marginTop={1}>
          <Text dimColor>
            {getSkillScope(selectedSkill.filePath)} | {selectedSkill.argumentHint || 'no args'} | Enter for details
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>Enter view | ↑↓ navigate | [n]ew | [p]rompt | [d]elete | [x]execute | q quit</Text>
      </Box>

      {isSubmitting && <Box marginTop={1}><Text color="yellow">Processing...</Text></Box>}
    </Box>
  );
}
