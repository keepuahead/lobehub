'use client';

import { type EvalReplayTargetMetrics } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { styles } from './style';

const percent = (v: number) => `${Math.round(v * 100)}%`;

/** One card per model: how often it passed, its mean score and how many cells failed to run. */
const TargetSummary = memo<{ summaries: EvalReplayTargetMetrics[] }>(({ summaries }) => {
  const { t } = useTranslation('eval');

  return (
    <div
      style={{
        display: 'grid',
        gap: 12,
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
      }}
    >
      {summaries.map((s) => (
        <Flexbox
          className={styles.card}
          data-testid="comparison-target-summary"
          gap={8}
          key={`${s.provider}/${s.model}`}
          padding={14}
        >
          <Flexbox gap={2}>
            <Text ellipsis weight={600}>
              {s.model}
            </Text>
            <span className={styles.mono} style={{ color: cssVar.colorTextTertiary }}>
              {s.provider}
            </span>
          </Flexbox>
          <Flexbox horizontal align="baseline" gap={8}>
            <span
              className={styles.stat}
              style={{
                color: s.passedCases > 0 ? cssVar.colorSuccess : cssVar.colorTextSecondary,
              }}
            >
              {percent(s.passRate)}
            </span>
            <Text fontSize={12} type="secondary">
              {t('comparison.summary.passed', { passed: s.passedCases, total: s.totalCases })}
            </Text>
          </Flexbox>
          <Flexbox horizontal gap={12}>
            <Text fontSize={12} type="secondary">
              {t('comparison.summary.avgScore', { score: s.averageScore.toFixed(2) })}
            </Text>
            {s.errorCases > 0 && (
              <Text fontSize={12} style={{ color: cssVar.colorWarning }}>
                {t('comparison.summary.errors', { count: s.errorCases })}
              </Text>
            )}
          </Flexbox>
        </Flexbox>
      ))}
    </div>
  );
});

TargetSummary.displayName = 'EvalComparisonTargetSummary';

export default TargetSummary;
