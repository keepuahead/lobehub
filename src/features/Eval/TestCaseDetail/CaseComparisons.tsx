'use client';

import { Flexbox } from '@lobehub/ui';
import { SkeletonText, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncBoundary from '@/components/AsyncBoundary';
import ComparisonList, { type ComparisonListItem } from '@/features/Eval/Comparison/ComparisonList';
import { useEvalStore } from '@/store/eval';

const styles = createStaticStyles(({ css }) => ({
  label: css`
    font-size: ${cssVar.fontSizeSM};
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
}));

/** Every cross-model comparison this case was replayed in, with each model's verdict on it. */
const CaseComparisons = memo<{ testCaseId: string }>(({ testCaseId }) => {
  const { t } = useTranslation('eval');
  const useFetchTestCaseComparisons = useEvalStore((s) => s.useFetchTestCaseComparisons);
  const { data, error, isLoading, mutate } = useFetchTestCaseComparisons(testCaseId);

  return (
    <Flexbox gap={10}>
      <span className={styles.label}>{t('comparison.list.caseTitle')}</span>
      <AsyncBoundary
        data={data}
        error={error}
        isEmpty={!data?.length}
        isLoading={isLoading}
        loading={<SkeletonText rows={2} />}
        empty={
          <Text fontSize={12} type="secondary">
            {t('comparison.list.caseEmpty')}
          </Text>
        }
        onRetry={() => mutate()}
      >
        <ComparisonList items={(data ?? []) as ComparisonListItem[]} />
      </AsyncBoundary>
    </Flexbox>
  );
});

CaseComparisons.displayName = 'EvalCaseComparisons';

export default CaseComparisons;
