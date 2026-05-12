/**
 * Chippi Proprietary Lead Scoring — Public API
 *
 * Drop-in replacement for the old LLM-only scoring in lib/lead-scoring.ts.
 * Same input/output shape so all existing callers (API routes, UI) work unchanged.
 *
 * How it works:
 *   1. Deterministic engine computes the score (fast, consistent, no API call)
 *   2. AI enhancement adds qualitative summary + recommendations (optional, async)
 *   3. If AI fails, deterministic fallbacks produce the same output shape
 */

export { computeLeadScore, DEFAULT_WEIGHTS, BUYER_WEIGHTS } from './engine';
export type { ScoringEngineResult, ScoringInput, CategoryResult, ScoringWeights } from './engine';
export { enhanceWithAI } from './enhance';

// Dynamic form scoring
export { computeDeterministicScore, computeModelBasedScore } from './deterministic-scorer';
export type { DeterministicScoringResult, DeterministicBreakdownItem, ModelScoringResult } from './deterministic-scorer';
export { buildDynamicScoringPrompt, buildDynamicSystemPrompt } from './dynamic-prompt-builder';

// AI-generated scoring models
export { generateScoringModel, generateFallbackModel } from './generate-scoring-model';
export type { ScoringModel, QuestionScoringModel, NumberRange, ScoringModelAIResponse } from './scoring-model-types';
