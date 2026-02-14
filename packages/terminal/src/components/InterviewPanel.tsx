import React, { useState, useCallback, useMemo } from 'react';
import { Box, Text } from 'ink';
import type { InterviewQuestion, InterviewRequest, InterviewResponse } from '@hasna/assistants-shared';
import { useSafeInput as useInput } from '../hooks/useSafeInput';

// ============================================
// Types
// ============================================

interface InterviewState {
  currentIndex: number;
  answers: Record<string, string | string[]>;
  // Per-question UI state: which option is highlighted
  selectedOptions: Record<string, number>;
  // For "Other" text input per question
  otherText: Record<string, string>;
  // Whether user is in text input mode for "Other"
  isInOtherInput: boolean;
  // For the bottom menu (Chat about this / Skip)
  bottomMenuIndex: number;
  // Whether bottom menu is focused
  isInBottomMenu: boolean;
}

interface InterviewPanelProps {
  request: InterviewRequest;
  onComplete: (response: InterviewResponse) => void;
  onCancel: () => void;
  isActive: boolean;
}

// ============================================
// Symbols
// ============================================

const CHECKBOX_ON = '☑';
const CHECKBOX_OFF = '☐';
const POINTER = '❯';
const TICK = '✓';
const BULLET = '•';

// ============================================
// Tab Bar Component
// ============================================

function QuestionTabs({
  questions,
  currentIndex,
  answers,
}: {
  questions: InterviewQuestion[];
  currentIndex: number;
  answers: Record<string, string | string[]>;
}) {
  const isSubmitTab = currentIndex === questions.length;
  const singleQuestion = questions.length === 1;

  if (singleQuestion) return null;

  return (
    <Box flexDirection="row" marginBottom={1}>
      <Text color={currentIndex === 0 ? undefined : 'gray'}>← </Text>
      {questions.map((q, idx) => {
        const isAnswered = q.id in answers;
        const isCurrent = idx === currentIndex;
        const checkbox = isAnswered ? CHECKBOX_ON : CHECKBOX_OFF;
        const label = q.header || `Q${idx + 1}`;

        if (isCurrent) {
          return (
            <Text key={q.id} backgroundColor="blue" color="white">
              {' '}{checkbox} {label}{' '}
            </Text>
          );
        }
        return (
          <Text key={q.id}>
            {' '}{checkbox} {label}{' '}
          </Text>
        );
      })}
      <Box key="submit">
        {isSubmitTab ? (
          <Text backgroundColor="blue" color="white"> {TICK} Submit </Text>
        ) : (
          <Text> {TICK} Submit </Text>
        )}
      </Box>
      <Text color={isSubmitTab ? undefined : 'gray'}> →</Text>
    </Box>
  );
}

// ============================================
// Option List Component
// ============================================

function OptionList({
  question,
  selectedOptionIndex,
  otherText,
  isInOtherInput,
  answer,
  isMultiSelect,
}: {
  question: InterviewQuestion;
  selectedOptionIndex: number;
  otherText: string;
  isInOtherInput: boolean;
  answer?: string | string[];
  isMultiSelect?: boolean;
}) {
  const options = question.options || [];
  const otherIndex = options.length;
  const multiAnswers = Array.isArray(answer) ? answer : [];

  return (
    <Box flexDirection="column" marginTop={1}>
      {options.map((opt, idx) => {
        const isSelected = selectedOptionIndex === idx && !isInOtherInput;
        const isChecked = isMultiSelect
          ? multiAnswers.includes(opt.label)
          : answer === opt.label;
        const pointer = isSelected ? POINTER : ' ';
        const checkbox = isMultiSelect
          ? (isChecked ? CHECKBOX_ON : CHECKBOX_OFF)
          : (isChecked ? BULLET : ' ');

        return (
          <Box key={opt.label} flexDirection="column">
            <Box>
              <Text color={isSelected ? 'cyan' : undefined}>
                {pointer} {idx + 1}. {isMultiSelect ? `${checkbox} ` : ''}{opt.label}
              </Text>
            </Box>
            {opt.description && (
              <Box marginLeft={6}>
                <Text dimColor>{opt.description}</Text>
              </Box>
            )}
          </Box>
        );
      })}

      {/* "Other" / type something option */}
      <Box flexDirection="column" marginTop={0}>
        <Box>
          <Text color={selectedOptionIndex === otherIndex || isInOtherInput ? 'cyan' : undefined}>
            {selectedOptionIndex === otherIndex && !isInOtherInput ? POINTER : ' '} {options.length + 1}. Type something.
          </Text>
        </Box>
        {isInOtherInput && (
          <Box marginLeft={6}>
            <Text color="cyan">{otherText || ''}</Text>
            <Text inverse> </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}

// ============================================
// Review Panel Component
// ============================================

function ReviewPanel({
  questions,
  answers,
  onSubmit,
  onCancel,
  selectedIndex,
}: {
  questions: InterviewQuestion[];
  answers: Record<string, string | string[]>;
  onSubmit: () => void;
  onCancel: () => void;
  selectedIndex: number;
}) {
  const allAnswered = questions.every((q) => q.id in answers);

  return (
    <Box flexDirection="column" marginTop={1}>
      {!allAnswered && (
        <Box marginBottom={1}>
          <Text color="yellow">⚠ You have not answered all questions</Text>
        </Box>
      )}

      {Object.keys(answers).length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          {questions
            .filter((q) => q.id in answers)
            .map((q) => {
              const answer = answers[q.id];
              const displayAnswer = Array.isArray(answer) ? answer.join(', ') : answer;
              return (
                <Box key={q.id} flexDirection="column" marginLeft={1}>
                  <Text>{BULLET} {q.header || q.question}</Text>
                  <Box marginLeft={2}>
                    <Text color="green">→ {displayAnswer}</Text>
                  </Box>
                </Box>
              );
            })}
        </Box>
      )}

      <Text dimColor>Ready to submit your answers?</Text>
      <Box flexDirection="column" marginTop={1}>
        <Text color={selectedIndex === 0 ? 'cyan' : undefined}>
          {selectedIndex === 0 ? POINTER : ' '} Submit answers
        </Text>
        <Text color={selectedIndex === 1 ? 'cyan' : undefined}>
          {selectedIndex === 1 ? POINTER : ' '} Cancel
        </Text>
      </Box>
    </Box>
  );
}

// ============================================
// Main InterviewPanel Component
// ============================================

export function InterviewPanel({
  request,
  onComplete,
  onCancel,
  isActive,
}: InterviewPanelProps) {
  const { questions } = request;

  const [state, setState] = useState<InterviewState>({
    currentIndex: 0,
    answers: {},
    selectedOptions: {},
    otherText: {},
    isInOtherInput: false,
    bottomMenuIndex: -1,
    isInBottomMenu: false,
  });

  const [reviewIndex, setReviewIndex] = useState(0);

  const currentQuestion = questions[state.currentIndex] || null;
  const isOnReview = state.currentIndex === questions.length;
  const optionCount = currentQuestion?.options?.length || 0;
  const currentSelectedOption = state.selectedOptions[currentQuestion?.id || ''] ?? 0;

  const goToQuestion = useCallback((index: number) => {
    const clamped = Math.max(0, Math.min(index, questions.length));
    setState((prev) => ({
      ...prev,
      currentIndex: clamped,
      isInOtherInput: false,
      isInBottomMenu: false,
      bottomMenuIndex: -1,
    }));
    setReviewIndex(0);
  }, [questions.length]);

  const setAnswer = useCallback((questionId: string, answer: string | string[]) => {
    setState((prev) => ({
      ...prev,
      answers: { ...prev.answers, [questionId]: answer },
    }));
  }, []);

  const toggleMultiSelectAnswer = useCallback((questionId: string, label: string) => {
    setState((prev) => {
      const current = prev.answers[questionId];
      const arr = Array.isArray(current) ? [...current] : [];
      const idx = arr.indexOf(label);
      if (idx >= 0) {
        arr.splice(idx, 1);
      } else {
        arr.push(label);
      }
      return {
        ...prev,
        answers: { ...prev.answers, [questionId]: arr },
      };
    });
  }, []);

  const handleSubmit = useCallback(() => {
    onComplete({ answers: state.answers });
  }, [state.answers, onComplete]);

  const handleChatAboutThis = useCallback(() => {
    onComplete({
      answers: state.answers,
      chatRequested: true,
      chatMessage: '',
    });
  }, [state.answers, onComplete]);

  // Keyboard handler
  useInput((input: string, key: { upArrow: boolean; downArrow: boolean; leftArrow: boolean; rightArrow: boolean; return: boolean; escape: boolean; tab: boolean; backspace: boolean; delete: boolean }) => {
    if (!isActive) return;

    // Escape: cancel interview
    if (key.escape) {
      if (state.isInOtherInput) {
        setState((prev) => ({ ...prev, isInOtherInput: false }));
        return;
      }
      onCancel();
      return;
    }

    // On review panel
    if (isOnReview) {
      if (key.upArrow) {
        setReviewIndex((prev) => Math.max(0, prev - 1));
      } else if (key.downArrow) {
        setReviewIndex((prev) => Math.min(1, prev + 1));
      } else if (key.return) {
        if (reviewIndex === 0) handleSubmit();
        else onCancel();
      } else if (key.leftArrow) {
        goToQuestion(questions.length - 1);
      }
      return;
    }

    if (!currentQuestion) return;

    // In "Other" text input mode
    if (state.isInOtherInput) {
      if (key.return) {
        const text = state.otherText[currentQuestion.id] || '';
        if (text.trim()) {
          setAnswer(currentQuestion.id, text.trim());
          // Auto-advance to next question
          goToQuestion(state.currentIndex + 1);
        }
        return;
      }
      if (key.backspace || key.delete) {
        setState((prev) => {
          const current = prev.otherText[currentQuestion.id] || '';
          return {
            ...prev,
            otherText: { ...prev.otherText, [currentQuestion.id]: current.slice(0, -1) },
          };
        });
        return;
      }
      if (key.escape) {
        setState((prev) => ({ ...prev, isInOtherInput: false }));
        return;
      }
      // Regular character input
      if (input && input.length === 1 && input.charCodeAt(0) >= 32) {
        setState((prev) => {
          const current = prev.otherText[currentQuestion.id] || '';
          return {
            ...prev,
            otherText: { ...prev.otherText, [currentQuestion.id]: current + input },
          };
        });
        return;
      }
      return;
    }

    // In bottom menu (Chat about this / Skip)
    if (state.isInBottomMenu) {
      if (key.upArrow) {
        if (state.bottomMenuIndex <= 0) {
          // Go back to options
          setState((prev) => ({ ...prev, isInBottomMenu: false, bottomMenuIndex: -1 }));
        } else {
          setState((prev) => ({ ...prev, bottomMenuIndex: prev.bottomMenuIndex - 1 }));
        }
        return;
      }
      if (key.downArrow) {
        setState((prev) => ({
          ...prev,
          bottomMenuIndex: Math.min(1, prev.bottomMenuIndex + 1),
        }));
        return;
      }
      if (key.return) {
        if (state.bottomMenuIndex === 0) {
          handleChatAboutThis();
        }
        // Index 1 = Skip interview would go here if needed
        return;
      }
      return;
    }

    // Left/right: navigate between questions
    if (key.leftArrow || key.tab) {
      // Tab goes right actually, but left arrow goes back
      if (key.leftArrow) {
        goToQuestion(state.currentIndex - 1);
      } else {
        goToQuestion(state.currentIndex + 1);
      }
      return;
    }
    if (key.rightArrow) {
      goToQuestion(state.currentIndex + 1);
      return;
    }

    // Up/down: navigate options
    if (key.upArrow) {
      setState((prev) => {
        const currentIdx = prev.selectedOptions[currentQuestion.id] ?? 0;
        const newIdx = Math.max(0, currentIdx - 1);
        return {
          ...prev,
          selectedOptions: { ...prev.selectedOptions, [currentQuestion.id]: newIdx },
        };
      });
      return;
    }
    if (key.downArrow) {
      const maxIdx = optionCount; // +1 for "Other" option
      const currentIdx = state.selectedOptions[currentQuestion.id] ?? 0;
      if (currentIdx >= maxIdx) {
        // Move to bottom menu
        setState((prev) => ({ ...prev, isInBottomMenu: true, bottomMenuIndex: 0 }));
      } else {
        setState((prev) => ({
          ...prev,
          selectedOptions: { ...prev.selectedOptions, [currentQuestion.id]: currentIdx + 1 },
        }));
      }
      return;
    }

    // Enter: select option
    if (key.return) {
      const selectedIdx = state.selectedOptions[currentQuestion.id] ?? 0;
      const options = currentQuestion.options || [];

      if (selectedIdx < options.length) {
        const selected = options[selectedIdx];
        if (currentQuestion.multiSelect) {
          toggleMultiSelectAnswer(currentQuestion.id, selected.label);
        } else {
          setAnswer(currentQuestion.id, selected.label);
          // Auto-advance for single-select
          goToQuestion(state.currentIndex + 1);
        }
      } else {
        // "Other" option selected -> enter text input mode
        setState((prev) => ({ ...prev, isInOtherInput: true }));
      }
      return;
    }

    // Number keys 1-9 for quick selection
    const num = parseInt(input, 10);
    if (num >= 1 && num <= optionCount + 1) {
      const idx = num - 1;
      const options = currentQuestion.options || [];
      if (idx < options.length) {
        if (currentQuestion.multiSelect) {
          toggleMultiSelectAnswer(currentQuestion.id, options[idx].label);
        } else {
          setAnswer(currentQuestion.id, options[idx].label);
          goToQuestion(state.currentIndex + 1);
        }
      } else if (idx === options.length) {
        // "Other"
        setState((prev) => ({
          ...prev,
          selectedOptions: { ...prev.selectedOptions, [currentQuestion.id]: idx },
          isInOtherInput: true,
        }));
      }
    }
  }, { isActive });

  // Separator line
  const Divider = useMemo(() => (
    <Box marginY={0}>
      <Text dimColor>{'─'.repeat(60)}</Text>
    </Box>
  ), []);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="#d4d4d8"
      borderLeft={false}
      borderRight={false}
      paddingX={1}
      marginY={0}
    >
      {/* Title */}
      {request.title && (
        <Box marginBottom={0}>
          <Text color="cyan" bold>{request.title}</Text>
        </Box>
      )}
      {request.description && (
        <Box marginBottom={0}>
          <Text dimColor>{request.description}</Text>
        </Box>
      )}

      {Divider}

      {/* Tab bar */}
      <QuestionTabs
        questions={questions}
        currentIndex={state.currentIndex}
        answers={state.answers}
      />

      {/* Question content or review panel */}
      {isOnReview ? (
        <ReviewPanel
          questions={questions}
          answers={state.answers}
          onSubmit={handleSubmit}
          onCancel={onCancel}
          selectedIndex={reviewIndex}
        />
      ) : currentQuestion ? (
        <Box flexDirection="column">
          {/* Question text */}
          <Text bold>{currentQuestion.question}</Text>

          {/* Options */}
          <OptionList
            question={currentQuestion}
            selectedOptionIndex={currentSelectedOption}
            otherText={state.otherText[currentQuestion.id] || ''}
            isInOtherInput={state.isInOtherInput}
            answer={state.answers[currentQuestion.id]}
            isMultiSelect={currentQuestion.multiSelect}
          />

          {/* Bottom menu */}
          {Divider}
          <Box flexDirection="column">
            <Box flexDirection="row" gap={1}>
              <Text color={state.isInBottomMenu && state.bottomMenuIndex === 0 ? 'cyan' : undefined}>
                {state.isInBottomMenu && state.bottomMenuIndex === 0 ? POINTER : ' '}
              </Text>
              <Text color={state.isInBottomMenu && state.bottomMenuIndex === 0 ? 'cyan' : undefined}>
                {optionCount + 2}. Chat about this
              </Text>
            </Box>
          </Box>
        </Box>
      ) : null}

      {/* Help text */}
      <Box marginTop={1}>
        <Text dimColor>
          Enter to select · {questions.length > 1 ? '←/→ to navigate · ' : ''}↑/↓ to browse · Esc to cancel
        </Text>
      </Box>
    </Box>
  );
}
