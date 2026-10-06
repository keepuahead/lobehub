'use client';

import { type EvalReplayTarget } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Tag, Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

import { formatDuration } from '../utils';
import CaseDefinition from './CaseDefinition';
import { styles } from './style';
import {
  caseLabel,
  cellVerdict,
  type ComparisonCase,
  type ComparisonCell,
  formatToolCalls,
  targetKey,
} from './utils';
import VerdictTag from './VerdictTag';

interface CaseSectionProps {
  cells: Map<string, ComparisonCell> | undefined;
  onOpenCell: (cell: ComparisonCell) => void;
  targets: EvalReplayTarget[];
  testCase: ComparisonCase;
}

/** One frozen case: its definition on the left, every model's answer to it on the right. */
const CaseSection = memo<CaseSectionProps>(({ cells, onOpenCell, targets, testCase }) => {
  const { t } = useTranslation('eval');

  return (
    <Flexbox className={styles.card} data-testid="comparison-case" gap={16} padding={16}>
      <Flexbox horizontal align="center" gap={8} justify="space-between" wrap="wrap">
        <Flexbox horizontal align="center" gap={8} wrap="wrap">
          <WorkspaceLink to={`/eval/cases/${testCase.id}`}>
            <Text weight={600}>{caseLabel(testCase)}</Text>
          </WorkspaceLink>
          {testCase.evalMode && <Tag size="small">{testCase.evalMode}</Tag>}
        </Flexbox>
        <Flexbox horizontal gap={12} wrap="wrap">
          {testCase.sourceTopicId && (
            <Text className={styles.mono} type="secondary">
              {t('comparison.case.sourceTopic', { id: testCase.sourceTopicId })}
            </Text>
          )}
          {typeof testCase.frozenStepIndex === 'number' && (
            <Text className={styles.mono} type="secondary">
              {t('comparison.case.frozenStep', { step: testCase.frozenStepIndex })}
            </Text>
          )}
        </Flexbox>
      </Flexbox>

      <div
        style={{
          alignItems: 'start',
          display: 'grid',
          gap: 20,
          gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 3fr)',
        }}
      >
        <CaseDefinition testCase={testCase} />

        <Flexbox gap={4}>
          <span className={styles.label} style={{ paddingInline: 12 }}>
            {t('comparison.field.actualByModel')}
          </span>
          {targets.map((target) => {
            const cell = cells?.get(targetKey(target));
            const excerpt =
              cell?.content || formatToolCalls(cell?.toolCalls) || cell?.error?.message;

            return (
              <Flexbox
                className={styles.resultRow}
                data-testid="comparison-cell"
                gap={4}
                key={targetKey(target)}
                onClick={cell ? () => onOpenCell(cell) : undefined}
              >
                <Flexbox horizontal align="center" gap={8} justify="space-between">
                  <Flexbox horizontal align="center" gap={8} style={{ minWidth: 0 }}>
                    <VerdictTag verdict={cellVerdict(cell)} />
                    <Text ellipsis weight={500}>
                      {target.model}
                    </Text>
                  </Flexbox>
                  <Flexbox horizontal gap={10} style={{ flexShrink: 0 }}>
                    {typeof cell?.score === 'number' && (
                      <span className={styles.mono}>{cell.score.toFixed(2)}</span>
                    )}
                    {typeof cell?.durationMs === 'number' && (
                      <span className={styles.mono} style={{ color: cssVar.colorTextTertiary }}>
                        {formatDuration(cell.durationMs)}
                      </span>
                    )}
                  </Flexbox>
                </Flexbox>
                {excerpt && <div className={styles.excerpt}>{excerpt}</div>}
              </Flexbox>
            );
          })}
        </Flexbox>
      </div>
    </Flexbox>
  );
});

CaseSection.displayName = 'EvalComparisonCaseSection';

export default CaseSection;
