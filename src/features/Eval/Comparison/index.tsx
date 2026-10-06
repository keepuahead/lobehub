'use client';

import { Center, Flexbox } from '@lobehub/ui';
import { Breadcrumb, Button, Text, toast } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { RotateCcw, RotateCw } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import AsyncBoundary from '@/components/AsyncBoundary';
import { RouteLoading } from '@/components/Skeleton/RouteSegment';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useEvalStore } from '@/store/eval';
import { isTrpcErrorCode } from '@/utils/trpcError';

import StatusBadge from '../StatusBadge';
import { formatDuration } from '../utils';
import CaseSection from './CaseSection';
import CellDetailDrawer from './CellDetailDrawer';
import RunConfig from './RunConfig';
import { styles } from './style';
import TargetSummary from './TargetSummary';
import {
  type ComparisonCase,
  type ComparisonCell,
  indexCells,
  resolveTargets,
  summarizeTargets,
} from './utils';

const formatTime = (value?: Date | string | null) =>
  value ? new Date(value).toLocaleString() : undefined;

/**
 * A replay run read as a model × case grid: every frozen case's definition
 * (input / expected / criteria) next to each model's answer and the judge's
 * verdict on it.
 */
const ComparisonPage = memo(() => {
  const { t } = useTranslation('eval');
  const { runId } = useParams<{ runId: string }>();

  const useFetchReplayComparison = useEvalStore((s) => s.useFetchReplayComparison);
  const useFetchDatasetDetail = useEvalStore((s) => s.useFetchDatasetDetail);
  const retryErrors = useEvalStore((s) => s.retryReplayComparisonErrors);

  const { data, error, isLoading, isValidating, mutate } = useFetchReplayComparison(runId);
  const { data: dataset } = useFetchDatasetDetail(data?.run.datasetId);

  const [openCellId, setOpenCellId] = useState<string>();
  const [retrying, setRetrying] = useState(false);

  const cells = useMemo(() => (data?.cells ?? []) as ComparisonCell[], [data]);
  const cases = useMemo(() => (data?.cases ?? []) as ComparisonCase[], [data]);
  const targets = useMemo(() => resolveTargets(data?.targets ?? [], cells), [data, cells]);
  const cellIndex = useMemo(() => indexCells(cells), [cells]);
  const summaries = useMemo(
    () => summarizeTargets(targets, cells, data?.run.metrics?.byTarget),
    [targets, cells, data],
  );

  const openCell = cells.find((c) => c.id === openCellId);
  const openCase = openCell && cases.find((c) => c.id === openCell.testCaseId);
  const errorCount = cells.filter((c) => c.status === 'error').length;
  const isRunning = data?.run.status === 'running' || data?.run.status === 'pending';

  // A deleted run, or an id that is not a replay run, is an absent resource:
  // offering Retry on it would loop forever.
  const isMissing = isTrpcErrorCode(error, 'NOT_FOUND') || isTrpcErrorCode(error, 'BAD_REQUEST');

  const handleRetryErrors = async () => {
    if (!runId) return;
    setRetrying(true);
    try {
      const { cellCount } = await retryErrors(runId);
      toast.success(t('comparison.retryErrors.success', { count: cellCount }));
    } catch (e) {
      toast.error((e as Error)?.message ?? t('comparison.retryErrors.failed'));
    } finally {
      setRetrying(false);
    }
  };

  return (
    <AsyncBoundary
      data={isMissing ? null : data}
      error={isMissing ? undefined : error}
      errorVariant={'page'}
      isEmpty={isMissing || !data}
      isLoading={isLoading}
      loading={<RouteLoading />}
      empty={
        <Center flex={1}>
          <Text type="secondary">{t('comparison.notFound')}</Text>
        </Center>
      }
      onRetry={() => mutate()}
    >
      {data && (
        <Flexbox
          gap={24}
          style={{
            marginInline: 'auto',
            maxWidth: 1200,
            overflowY: 'auto',
            paddingBlock: 24,
            paddingInline: 32,
            width: '100%',
          }}
        >
          <Breadcrumb
            className={styles.breadcrumb}
            items={[
              {
                title: (
                  <WorkspaceLink to="/eval">{t('testCaseDetail.breadcrumb.eval')}</WorkspaceLink>
                ),
              },
              {
                title: (
                  <WorkspaceLink to={`/eval/datasets/${data.run.datasetId}`}>
                    {dataset?.name || t('testCaseDetail.breadcrumb.dataset')}
                  </WorkspaceLink>
                ),
              },
              { title: t('comparison.title') },
            ]}
          />

          <Flexbox horizontal align="flex-start" gap={16} justify="space-between">
            <Flexbox gap={8} style={{ minWidth: 0 }}>
              <Text as="h4" style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>
                {data.run.name || t('comparison.title')}
              </Text>
              <Flexbox horizontal align="center" gap={12} wrap="wrap">
                <StatusBadge status={data.run.status} />
                <span className={styles.mono} style={{ color: cssVar.colorTextTertiary }}>
                  {data.run.id}
                </span>
                <Text fontSize={12} type="secondary">
                  {t('comparison.createdAt', {
                    time: formatTime(data.run.startedAt ?? data.run.createdAt),
                  })}
                </Text>
                {typeof data.run.metrics?.duration === 'number' && (
                  <Text fontSize={12} type="secondary">
                    {t('comparison.duration', {
                      duration: formatDuration(data.run.metrics.duration),
                    })}
                  </Text>
                )}
              </Flexbox>
            </Flexbox>
            <Flexbox horizontal gap={8} style={{ flexShrink: 0 }}>
              {errorCount > 0 && !isRunning && (
                <Button
                  icon={RotateCcw}
                  loading={retrying}
                  size="small"
                  onClick={handleRetryErrors}
                >
                  {t('comparison.retryErrors', { count: errorCount })}
                </Button>
              )}
              <Button
                data-testid="comparison-refresh"
                icon={RotateCw}
                loading={isValidating}
                size="small"
                onClick={() => mutate()}
              >
                {t('comparison.refresh')}
              </Button>
            </Flexbox>
          </Flexbox>

          <RunConfig
            caseCount={cases.length}
            config={data.run.config}
            targetCount={targets.length}
          />

          {cells.length === 0 ? (
            <Center className={styles.card} padding={48}>
              <Text type="secondary">
                {isRunning ? t('comparison.empty.running') : t('comparison.empty')}
              </Text>
            </Center>
          ) : (
            <>
              <Flexbox gap={12}>
                <h3 className={styles.sectionTitle}>{t('comparison.summary.title')}</h3>
                <TargetSummary summaries={summaries} />
              </Flexbox>

              <Flexbox gap={12}>
                <Flexbox gap={4}>
                  <h3 className={styles.sectionTitle}>
                    {t('comparison.cases.title', { count: cases.length })}
                  </h3>
                  <Text fontSize={12} type="secondary">
                    {t('comparison.cases.hint')}
                  </Text>
                </Flexbox>
                {cases.map((testCase) => (
                  <CaseSection
                    cells={cellIndex.get(testCase.id)}
                    key={testCase.id}
                    targets={targets}
                    testCase={testCase}
                    onOpenCell={(cell) => setOpenCellId(cell.id)}
                  />
                ))}
              </Flexbox>
            </>
          )}

          <CellDetailDrawer
            cell={openCell}
            testCase={openCase}
            onClose={() => setOpenCellId(undefined)}
          />
        </Flexbox>
      )}
    </AsyncBoundary>
  );
});

ComparisonPage.displayName = 'EvalComparisonPage';

export default ComparisonPage;
