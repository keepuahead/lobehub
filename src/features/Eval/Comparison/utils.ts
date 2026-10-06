import type {
  EvalReplayError,
  EvalReplayTarget,
  EvalReplayTargetMetrics,
  EvalReplayToolCall,
  EvalReplayUsage,
} from '@lobechat/types';

/** One (case × model) result as `getReplayComparison` returns it. */
export interface ComparisonCell {
  content?: string | null;
  durationMs?: number | null;
  error?: EvalReplayError | null;
  id: string;
  judgeReason?: string | null;
  model: string;
  passed?: boolean | null;
  provider: string;
  score?: number | null;
  status: string;
  testCaseId: string;
  toolCalls?: EvalReplayToolCall[] | null;
  usage?: EvalReplayUsage | null;
}

export interface ComparisonCase {
  content?: { expected?: string; input?: string } & Record<string, unknown>;
  evalConfig?: Record<string, unknown> | null;
  evalMode?: string | null;
  frozenStepIndex?: number | null;
  id: string;
  metadata?: Record<string, unknown> | null;
  sourceMessageId?: string | null;
  sourceOperationId?: string | null;
  sourceTopicId?: string | null;
}

export const targetKey = (t: Pick<EvalReplayTarget, 'model' | 'provider'>) =>
  `${t.provider}/${t.model}`;

/**
 * Columns of the grid. The run's configured targets come first in their
 * configured order; a cell whose target is not in the config (an older run)
 * still gets a column instead of silently disappearing.
 */
export const resolveTargets = (
  targets: EvalReplayTarget[],
  cells: ComparisonCell[],
): EvalReplayTarget[] => {
  const seen = new Map(targets.map((t) => [targetKey(t), t]));
  for (const cell of cells) {
    const key = targetKey(cell);
    if (!seen.has(key)) seen.set(key, { model: cell.model, provider: cell.provider });
  }
  return [...seen.values()];
};

/** `caseId → targetKey → cell` lookup for rendering rows. */
export const indexCells = (cells: ComparisonCell[]) => {
  const map = new Map<string, Map<string, ComparisonCell>>();
  for (const cell of cells) {
    const row = map.get(cell.testCaseId) ?? new Map<string, ComparisonCell>();
    row.set(targetKey(cell), cell);
    map.set(cell.testCaseId, row);
  }
  return map;
};

/**
 * Per-model roll-up. The server writes `metrics.byTarget` once the run
 * finishes; while cells are still settling it is absent, so derive the same
 * figures from the cells instead of showing nothing.
 */
export const summarizeTargets = (
  targets: EvalReplayTarget[],
  cells: ComparisonCell[],
  byTarget?: EvalReplayTargetMetrics[],
): EvalReplayTargetMetrics[] =>
  targets.map((target) => {
    const stored = byTarget?.find((m) => targetKey(m) === targetKey(target));
    if (stored) return stored;

    const own = cells.filter((c) => targetKey(c) === targetKey(target));
    const scored = own.filter((c) => c.status === 'completed' && typeof c.score === 'number');
    const passed = own.filter((c) => c.passed === true).length;
    return {
      averageScore: scored.length
        ? scored.reduce((sum, c) => sum + (c.score ?? 0), 0) / scored.length
        : 0,
      errorCases: own.filter((c) => c.status === 'error').length,
      model: target.model,
      passRate: own.length ? passed / own.length : 0,
      passedCases: passed,
      provider: target.provider,
      totalCases: own.length,
    };
  });

export type CellVerdict = 'error' | 'fail' | 'pass' | 'pending' | 'unjudged';

export const cellVerdict = (cell?: ComparisonCell): CellVerdict => {
  if (!cell || cell.status === 'pending' || cell.status === 'running') return 'pending';
  if (cell.status === 'error') return 'error';
  if (cell.passed === true) return 'pass';
  if (cell.passed === false) return 'fail';
  return 'unjudged';
};

export const caseCriteria = (c: ComparisonCase): string | undefined =>
  typeof c.evalConfig?.criteria === 'string' ? c.evalConfig.criteria : undefined;

/** The human label a case was saved under, else its id. */
export const caseLabel = (c: ComparisonCase): string =>
  typeof c.metadata?.caseId === 'string' ? c.metadata.caseId : c.id;

/** What the judge read as the model's output: text, plus tool calls when it made any. */
export const formatToolCalls = (toolCalls?: EvalReplayToolCall[] | null): string | undefined => {
  if (!toolCalls?.length) return undefined;
  return toolCalls.map((call) => `${call.name}(${call.arguments ?? ''})`).join('\n');
};
