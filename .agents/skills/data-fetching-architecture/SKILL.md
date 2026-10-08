---
name: data-fetching-architecture
description: 'Use for client APIs, replica-backed reads, SWR hooks, cache invalidation, async errors, useEffect migration, home first paint and persistent caches.'
user-invocable: false
---

# LobeHub Data Fetching Architecture

```text
Component → Store useFetchXxx hook → replica slice (createReplicaSlice) → resource (defineReplica)
          ← store view (recordLens) ← engine commit ← service ← lambdaClient
                                                ↘ persisted row (IndexedDB)
```

## Layer boundaries

- Services in `src/services/` own API calls: `.query()` for reads, `.mutate()` for writes.
  Export a service instance per domain; components and stores do not call `lambdaClient` directly.
- **A domain the client reads belongs in a replica.** Resources are declared in
  `<store>/projection.ts` with `defineReplica` and bound to the store with
  `createReplicaSlice`. The store view is the only UI source of truth; the fetch
  hook only orchestrates fetching. See [Reads](#reads-put-the-domain-in-a-replica).
- Components call the store's `useFetchXxx` hooks and read the view through
  selectors. Do not fetch in `useEffect` or duplicate server data in component `useState`.
- **Plain SWR is the exception, not the default.** Keep `useClientDataSWR` for a
  read no domain store owns: auth pages, share/market surfaces, ad-hoc modals, or
  a one-shot imperative call. Do not add a new SWR key family for a domain that
  already has (or should have) a store.
- Use `useFetchXxx` for read hooks and `refreshXxx` for cache invalidation.
- For list/detail types, maps, reducers, and shared type sources, use
  [Zustand data structures](../zustand/references/data-structures.md). For action classes,
  internal actions, and `flattenActions`, use [zustand](../zustand/SKILL.md). For how a
  replica-backed store is laid out, see
  [replica-backed stores](../zustand/SKILL.md#replica-backed-stores).

## Reads: put the domain in a replica

`@lobechat/replica` gives a read a persisted projection (IndexedDB by default), so a
loaded surface paints on the first frame instead of after the request, and one entity
held in several views stays consistent.

1. **Declare the resource** in `<store>/projection.ts` — identity, storage, version:

```typescript
export const dashboardDetailResource = defineReplica<string, DashboardDetail>({
  fetcher: (dashboardId) => dashboardService.detail(dashboardId),
  key: (dashboardId) => dashboardId,
  name: 'dashboardDetail',
  storage: 'indexedDB',
  version: 1,
});
```

1. **Bind it to the store** with `createReplicaSlice`, pointing at the view the
   selectors already read; add the matching `ReplicaState` field to `initialState`:

```typescript
const detail = createReplicaSlice(dashboardDetailResource, {
  actionPrefix: 'dashboard/detail',
  get,
  set,
  stateKey: 'dashboardDetailReplica',
  view: recordLens<DashboardStore, DashboardDetail>('dashboardDetailMap'),
});
```

1. **Expose a fetch hook** that calls `useSync(params, { enabled })`. Pass `null` for
   params when a required id is absent — that disables the entry, and it is the
   replica equivalent of SWR's `null` key.

Read the value from the view, never from the hook's return:
`useDashboardStore((s) => s.dashboardDetailMap[id])`.

Worked examples: `src/store/project/` (list + detail, entity linked), `src/store/dashboard/`
(lists, detail, run history, trend, plus polling and a per-version read).

### Identity, query, and storage

- `key(params)` is the entry identity inside one scope; `query(params)` is anything that
  changes the rows without changing the key (filters, sort). A projection taken under
  other filters never hydrates.
- `storage: 'indexedDB'` for lists/details a surface paints before its first response;
  `'memory'` for large or ephemeral values (run output, approval previews) that should
  not be persisted.
- A resource's shape is versioned: bump `version` when the persisted projection changes
  so older rows never hydrate.
- `definePagedReplica` only fits an API that actually takes a cursor. A list the server
  caps (e.g. `listRuns(limit)`) is a plain list replica — do not invent pagination for it.

### Polling

A running job needs a cadence, not a second request path: pass `refreshInterval` to
`useSync`. Compute it in the same hook from the current view, so the cadence follows
the data (and subscribe there — the cadence must update even when the consumer only
renders the hook's request state):

```typescript
useFetchDashboardDetail: (dashboardId) => {
  const data = useDashboardStore((s) =>
    dashboardId ? s.dashboardDetailMap[dashboardId] : undefined,
  );
  return toRequest(
    detail.useSync(dashboardId ?? null, {
      refreshInterval: hasRunningWidget(data) ? 3000 : hasScheduledWidget(data) ? 30_000 : 0,
    }),
    data,
  );
};
```

The SWR-backed driver keeps the application's focus/reconnect behavior and only fires the
interval while the tab is visible. Do not assume upstream SWR's default deduping interval.

## Writes

- Call the service, then move the replica: `update` / `remove` for a confirmed local
  change, `optimistic` (with rollback) for a change that should render before the server
  answers, and `revalidate(key?)` when server-owned fields must come back.
- When the same entity lives in several resources (a board in two lists and its detail
  page), link them with `linkReplicaEntity` and write through the link — one edit lands in
  every loaded copy instead of one hand-written `mutate` matcher per key.
- Keep pending flags in store state and clear them in `finally`. Use per-id state for row
  updates so unrelated rows stay usable; create can use a separate flag because no
  persistent id exists yet.
- Delete after server success. Do not apply create/update's optimistic recipe to deletion.
- Let failures reach the caller's error UI; a `finally` block clears pending state but does
  not by itself recover an optimistic write.
- A write that fails must leave the view showing what the server holds: `revalidate` the
  entry in the `catch` (an optimistic overlay rolls back on its own).

## Cache keys and scope

- A replica is keyed by its resource identity — do not add a hand-written key family in
  `src/libs/swr/keys.ts` for it. `src/libs/swr/keys.ts` is for the SWR reads that remain.
- Replicas are partitioned per scope: the app wires `${userId}:${workspaceId}` in
  `src/libs/replica/index.ts`, so one browser profile never mixes two identities.
  Persistence is only enabled for a trusted scope.
- `revalidateReplica(resource, key?)` revalidates from code that cannot import the owning
  store; inside the store use the slice's own `revalidate`.

## Render loading, errors, and settled data

A migrated read hook should hand back the same shape the surface already consumed —
`{ data, error, isLoading, mutate }` — with `data` read from the view and
`isLoading = !isHydrated || (data === undefined && isValidating)`. That keeps call sites
unchanged while the first frame still comes from the persisted row.

`isLoading` must stay false once a persisted value is on screen, and `AsyncBoundary` still
distinguishes "no successful result" from "settled empty":

```tsx
const Board = () => {
  const useFetchBoard = useDashboardStore((s) => s.useFetchDashboardDetail);
  const board = useDashboardStore((s) => s.dashboardDetailMap[id]);
  const { data, error, isLoading, mutate } = useFetchBoard(id);

  return (
    <AsyncBoundary
      data={data}
      empty={<EmptyState />}
      error={error}
      isEmpty={data?.items.length === 0}
      isLoading={isLoading}
      onRetry={() => void mutate()}
    >
      <BoardGrid board={board!} />
    </AsyncBoundary>
  );
};
```

Follow these distinctions when adapting it:

- Show first-load errors before empty / `NotFound` / zero-value defaults. Do not put an
  error branch after `if (!view[id]) return <Skeleton />`; failure may never fill the view.
- Preserve settled content during background revalidation failures, including a
  successfully loaded empty list. A retry in flight should show pending feedback.
- In a fetched + static list, use the fetched slice's request state before combining rows.
- For infinite scroll, keep a per-bucket `loadMoreError` and show an inline Retry row.
- A closed modal or absent id disables a request; it is not evidence of a missing record.

## Home First Paint and Persistent Caches

When changing home/sidebar first paint or persisted display data, read
[`references/home-first-paint.md`](./references/home-first-paint.md). It covers avoiding
flicker, reusing persistence, and the user `displaySnapshot.ts` boundary.

## Migrating an existing fetch

- **SWR → replica**: declare the resource in `projection.ts`, add the `ReplicaState` field,
  bind a slice at the existing view, and replace the hook's body with `useSync`. Delete the
  domain's keys from `src/libs/swr/keys.ts` and every hand-written `mutate` matcher once
  nothing constructs them; writes become `update` / `remove` / `optimistic` + `revalidate`.
  Keep the hook's return shape so call sites do not change.
- **Component effect → store hook**: move the API call into the service and the request
  into the store's fetch hook, then replace the effect/local state with the hook and
  selectors.
- Check initial failure, retry, settled-empty results, background failure, id switching,
  and poll cadence against the surface being changed. For stale data compare the resource
  identity and the view it writes; for stuck loading inspect rejected requests as well as
  success callbacks. Do not add a second fetch or another loading flag to mask the cause.
