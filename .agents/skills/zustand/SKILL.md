---
name: zustand
description: 'Use for Zustand stores: replica-backed stores, list/detail splits, state type sources, slices, actions, reducers, selectors, optimistic updates and class-action composition.'
user-invocable: false
---

# LobeHub Zustand State Management

## State Shapes and Types

- Import shared store types from `@lobechat/types`, not `@lobechat/database`.
- Keep lightweight list-item types separate from full detail types; list types must not extend heavy detail types.
- Use arrays for whole-list display and id-keyed maps for cached details, with per-item loading state where needed.
- Before choosing list/detail shapes, normalized maps or state type sources, read [Data structures](references/data-structures.md). Its worked examples load only when relevant.

## Replica-Backed Stores

A domain the client reads through `@lobechat/replica` (see
[data fetching](../data-fetching-architecture/SKILL.md)) is laid out as a resource file
plus a plain-object store — not a class:

- `projection.ts` — the resources (`defineReplica` / `definePagedReplica`): `key`, `name`,
  `storage`, `version`, and any `query`.
- `initialState.ts` — the `<domain>Map` views **and** the matching `<domain>Replica`
  bookkeeping fields (`createReplicaState()`). Selectors keep reading the maps, so their
  shape does not change.
- `store.ts` — binds each resource with `createReplicaSlice`, links the entities, and
  returns `{ ...initialState, ...hooks, ...actions }`.

```ts
export const useDashboardStore = createWithEqualityFn<DashboardStore>()(
  devtools((set, get): DashboardStore => {
    const detail = createReplicaSlice(dashboardDetailResource, {
      actionPrefix: 'dashboard/detail',
      entity: singleEntity<DashboardDetail, DashboardListItem>((board) => board.id, {
        get: ({ items, ...board }) => board,
        set: (current, board) => ({ ...current, ...board }),
      }),
      get,
      set,
      stateKey: 'dashboardDetailReplica',
      view: recordLens<DashboardStore, DashboardDetail>('dashboardDetailMap'),
    });

    return { ...initialState /* hooks + actions */ };
  }),
  shallow,
);
```

- Write through an entity (`update` / `remove` / `optimistic`) when the same entity lives
  in several resources; `linkReplicaEntity([a, b])` fans one edit out to every loaded copy
  instead of one hand-written cache matcher per view.
- `recordLens(field)` covers the common `Record<key, TData>` view; `splitPagedLens` splits a
  paged view across a rows field and a meta field.
- A hook that returns request state and also needs the value reads it from the view
  (`useDashboardStore((s) => s.dashboardDetailMap[id])`), never from `useSync`'s return.
- Keep these stores class-free: the replica engine owns every transition of the view, so a
  `#set`-based action class would fight it. The class-based actions below remain for domains
  that own their state outright.

## Action Type Hierarchy

### 1. Public Actions

Main interfaces for UI components:

- Naming: Verb form (`createTopic`, `sendMessage`)
- Responsibilities: Parameter validation, flow orchestration

### 2. Internal Actions (`internal_*`)

Core business logic implementation:

- Naming: `internal_` prefix (`internal_createTopic`)
- Responsibilities: Optimistic updates, service calls, error handling
- Should not be called directly by UI

### 3. Dispatch Methods (`internal_dispatch*`)

State update handlers:

- Naming: `internal_dispatch` + entity (`internal_dispatchTopic`)
- Responsibilities: Calling reducers, updating store

## When to Use Reducer vs Simple `set`

**Use Reducer Pattern:**

- Managing object lists/maps (`messagesMap`, `topicMaps`)
- Optimistic updates
- Complex state transitions

**Use Simple `set`:**

- Toggling booleans
- Updating simple values
- Setting single state fields

## Optimistic Update Pattern

```typescript
internal_createTopic: async (params) => {
  const tmpId = Date.now().toString();

  // 1. Immediately update frontend (optimistic)
  get().internal_dispatchTopic(
    { type: 'addTopic', value: { ...params, id: tmpId } },
    'internal_createTopic'
  );

  // 2. Call backend service
  const topicId = await topicService.createTopic(params);

  // 3. Refresh for consistency
  await get().refreshTopic();
  return topicId;
},
```

**Delete operations**: Don't use optimistic updates (destructive, complex recovery)

## Naming Conventions

**Actions:**

- Public: `createTopic`, `sendMessage`

- Internal: `internal_createTopic`, `internal_updateMessageContent`

- Dispatch: `internal_dispatchTopic`
  **State:**

- ID arrays: `topicEditingIds`

- Maps: `topicMaps`, `messagesMap`

- Active: `activeTopicId`

- Init flags: `topicsInit`

## Detailed Guides

- Action patterns: `references/action-patterns.md`
- Slice organization: `references/slice-organization.md`

## Class-Based Action Implementation

We are migrating slices from plain `StateCreator` objects to **class-based actions**.

### Pattern

- Define a class that encapsulates actions and receives `(set, get, api)` in the constructor.
- Use `#private` fields (e.g., `#set`, `#get`) to avoid leaking internals.
- Prefer shared typing helpers:
  - `StoreSetter<T>` from `@/store/types` for `set`.
  - `Pick<ActionImpl, keyof ActionImpl>` to expose only public methods.
- Export a `create*Slice` helper that returns a class instance.

```ts
type Setter = StoreSetter<HomeStore>;
export const createRecentSlice = (set: Setter, get: () => HomeStore, _api?: unknown) =>
  new RecentActionImpl(set, get, _api);

export class RecentActionImpl {
  readonly #get: () => HomeStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => HomeStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  useFetchRecentTopics = () => {
    // ...
  };
}

export type RecentAction = Pick<RecentActionImpl, keyof RecentActionImpl>;
```

### Composition

- In store files, merge class instances with `flattenActions` (do not spread class instances).
- `flattenActions` binds methods to the original class instance and supports prototype methods and class fields.

```ts
const createStore: StateCreator<HomeStore, [['zustand/devtools', never]]> = (...params) => ({
  ...initialState,
  ...flattenActions<HomeStoreAction>([
    createRecentSlice(...params),
    createHomeInputSlice(...params),
  ]),
});
```

### Multi-Class Slices

- For large slices that need multiple action classes, compose them in the slice entry using `flattenActions`.
- Use a local `PublicActions<T>` helper if you need to combine multiple classes and hide private fields.

```ts
type PublicActions<T> = { [K in keyof T]: T[K] };

export type ChatGroupAction = PublicActions<
  ChatGroupInternalAction & ChatGroupLifecycleAction & ChatGroupMemberAction & ChatGroupCurdAction
>;

export const chatGroupAction: StateCreator<
  ChatGroupStore,
  [['zustand/devtools', never]],
  [],
  ChatGroupAction
> = (...params) =>
  flattenActions<ChatGroupAction>([
    new ChatGroupInternalAction(...params),
    new ChatGroupLifecycleAction(...params),
    new ChatGroupMemberAction(...params),
    new ChatGroupCurdAction(...params),
  ]);
```

### Store-Access Types

- For class methods that depend on actions in other classes, define explicit store augmentations:
  - `ChatGroupStoreWithSwitchTopic` for lifecycle `switchTopic`
  - `ChatGroupStoreWithRefresh` for member refresh
  - `ChatGroupStoreWithInternal` for curd `internal_dispatchChatGroup`

### Slices That Don't Currently Need `set`

When a slice doesn't write local state (e.g. it delegates to another store or just runs hooks), drop `#set` and mark the constructor param as `_set` with `void _set` to keep the `(set, get, api)` shape:

```ts
export class ToolActionImpl {
  readonly #get: () => ConversationStore;

  constructor(_set: Setter, get: () => ConversationStore, _api?: unknown) {
    void _set;
    void _api;
    this.#get = get;
  }

  approveToolCall = async (id: string) => {
    const { context, hooks } = this.#get();
    await useChatStore.getState().approveToolCalling(id, '', context);
    hooks.onToolCallComplete?.(id, undefined);
  };
}
```

- Drop `#set` when unused; restore it when a later edit needs `set` — re-adding costs nothing.
- Don't add `setNamespace` for slices that don't write state.
- Don't keep both old slice objects and class actions active at the same time during migration.
