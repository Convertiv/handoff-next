'use client';

import { createContext, createElement, useContext, type ReactNode } from 'react';
import type { GuardrailConfig } from '@/lib/authoring-guardrails';

/**
 * The brief's content limits, made available to the block editor's individual fields.
 *
 * Deliberately its own tiny module rather than a slice of `PlaygroundContext`, for two reasons:
 *
 * 1. **The field layer must not reach server code.** `PlaygroundContext` imports `@/app/actions/patterns`
 *    (server actions, and therefore `server-only`). Importing it from a field drags that whole graph into
 *    every consumer of `renderFormFields`, which stops them loading at all — a real coupling, not a test
 *    artifact, though `test/field-array-coercion.test.ts` is what surfaced it.
 * 2. **Fields render outside the playground.** `ComponentWorkbenchDialog` renders the same fields in the
 *    component docs, with no `PlaygroundProvider` anywhere above them. `usePlayground()` *throws* there, so a
 *    field reaching for it would take that dialog down. The default below means "no brief, no limits".
 *
 * Plain `createElement` rather than JSX so this stays a `.ts` module that renders under any JSX runtime.
 */

const FieldGuardrailsContext = createContext<GuardrailConfig>({});

export function FieldGuardrailsProvider({ value, children }: { value: GuardrailConfig; children: ReactNode }) {
  return createElement(FieldGuardrailsContext.Provider, { value }, children);
}

/** The guardrails in force, or `{}` when a field renders outside a brief. Never throws. */
export function useFieldGuardrails(): GuardrailConfig {
  return useContext(FieldGuardrailsContext);
}
