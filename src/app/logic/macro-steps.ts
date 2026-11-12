/**
 * Macro steps as the editor shows them (chips), and recording key presses
 * into steps. Built on the core macro expression language.
 */
import {expressionToSequence, sequenceToExpression, type OptimizedMacroAction} from '../../core/index.ts';
import {heldModifiers, isModifierEvent, modifierKeyName, qmkCodeForEvent, typedCharacter, type KeyEventLike} from './browser-keys.ts';

export type MacroStep = OptimizedMacroAction;

export const stepsFromExpression = (expression: string): MacroStep[] => expressionToSequence(expression);

export const expressionFromSteps = (steps: readonly MacroStep[]): string => sequenceToExpression(steps);

export interface StepText {
  readonly verb: string;
  readonly what: string;
}

/** Plain wording for one step, such as {verb: 'presses', what: 'Ctrl + C'}. */
export const describeStep = (step: MacroStep, keyName: (code: string) => string): StepText => {
  switch (step.type) {
    case 'text':
      return {verb: 'types', what: step.text};
    case 'tap':
      return {verb: 'presses', what: keyName(step.key)};
    case 'chord':
      return {verb: 'presses', what: step.keys.map(keyName).join(' + ')};
    case 'down':
      return {verb: 'holds', what: keyName(step.key)};
    case 'up':
      return {verb: 'lets go of', what: keyName(step.key)};
    case 'delay':
      return {verb: 'waits', what: `${step.ms} ms`};
    default: {
      const unreachable: never = step;
      return unreachable;
    }
  }
};

/** Appends text, merging it into a trailing text step. */
export const appendText = (steps: readonly MacroStep[], text: string): MacroStep[] => {
  if (text.length === 0) {
    return [...steps];
  }
  const last = steps[steps.length - 1];
  if (last?.type === 'text') {
    return [...steps.slice(0, -1), {type: 'text', text: last.text + text}];
  }
  return [...steps, {type: 'text', text}];
};

export type RecordResult =
  | {readonly kind: 'added'; readonly steps: MacroStep[]}
  /** A modifier on its own: wait for the key it goes with. */
  | {readonly kind: 'waiting'}
  | {readonly kind: 'unsupported'; readonly key: string};

/**
 * Adds one key press to a recording. Printable characters become text;
 * keys held with Ctrl, Alt or Cmd become a combination; other keys
 * (Enter, arrows, F keys) become a key press.
 */
export const recordKeyPress = (steps: readonly MacroStep[], event: KeyEventLike): RecordResult => {
  if (isModifierEvent(event)) {
    return {kind: 'waiting'};
  }
  const typed = typedCharacter(event);
  if (typed !== null) {
    return {kind: 'added', steps: appendText(steps, typed)};
  }
  const code = qmkCodeForEvent(event);
  if (code === null) {
    return {kind: 'unsupported', key: event.key};
  }
  const mods = heldModifiers(event);
  if (mods.length === 0) {
    return {kind: 'added', steps: [...steps, {type: 'tap', key: code}]};
  }
  return {kind: 'added', steps: [...steps, {type: 'chord', keys: [...mods.map(modifierKeyName), code]}]};
};
