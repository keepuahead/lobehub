import type { DocumentItem } from '@lobechat/database/schemas';

import {
  createReplicaSlice,
  linkReplicaEntity,
  recordLens,
  type ReplicaSyncResult,
  singleEntity,
} from '@/libs/replica';
import { documentService } from '@/services/document';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import type { StoreSetter } from '@/store/types';
import { type LobeDocument } from '@/types/document';
import { setNamespace } from '@/utils/storeDebug';

import {
  documentItemToLobeDocument,
  isTempPageId,
  PAGE_LIST_KEY,
  pageDetailResource,
  pageListResource,
  type PageListValue,
} from '../../projection';
import type { PageStore } from '../../store';

const n = setNamespace('page/list');

const DEFAULT_PAGE_SIZE = 20;

/** The sidebar's page size; part of the list query's identity. */
const currentPageSize = (): number =>
  useGlobalStore.getState().status.pagePageSize || DEFAULT_PAGE_SIZE;

type Setter = StoreSetter<PageStore>;

/**
 * The page domain's read slice: it owns both replicas of the domain and the
 * fetch orchestration around them.
 *
 * - `pageList` is the one paged list the Pages sidebar renders
 *   (`pageListMap.all`). It hydrates from IndexedDB, revalidates the head over
 *   the network and pages forward with `loadMoreDocuments`.
 * - `pageDetail` is the by-id projection (`pageDetailMap[id]`) for a page the
 *   loaded list does not hold (mobile mounts no sidebar; a modal deeplinks a
 *   page). `pageSelectors.getDocumentById` reads the list first, then this.
 *
 * Both hold copies of the same entity, so they are linked: a rename or a delete
 * fans out to every loaded copy and to the persisted rows of entries that are
 * not loaded. The crud slice issues those commands through the `internal_*`
 * seam handed out here — one direction only, so no cycle.
 */
export const createListSlice = (set: Setter, get: () => PageStore, _api?: unknown) =>
  new ListActionImpl(set, get, _api);

export class ListActionImpl {
  readonly #get: () => PageStore;
  readonly #set: Setter;
  readonly #pageDetail;
  readonly #pageEntity;
  readonly #pageList;

  constructor(set: Setter, get: () => PageStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;

    this.#pageList = createReplicaSlice(pageListResource, {
      actionPrefix: 'pageList',
      get,
      // A page the user just created shows before its server row exists and
      // survives a head refresh until `replaceTempPageWithReal` swaps the id.
      isClientOnly: (doc) => isTempPageId(doc.id),
      set,
      stateKey: 'pageListReplica',
      view: recordLens<PageStore, PageListValue>('pageListMap'),
    });
    this.#pageDetail = createReplicaSlice(pageDetailResource, {
      actionPrefix: 'pageDetail',
      // The value IS the page, so entity-level writes (rename, delete) and the
      // link with the list find and map it through this adapter.
      entity: singleEntity<LobeDocument>((doc) => doc.id),
      fetcher: async (pageId) => {
        const document = await documentService.getDocumentById(pageId);
        return document ? documentItemToLobeDocument(document) : undefined;
      },
      get,
      // A miss keeps whatever is cached — the list may still hold the row.
      merge: (incoming) => incoming,
      set,
      stateKey: 'pageDetailReplica',
      view: recordLens<PageStore, LobeDocument>('pageDetailMap'),
    });
    this.#pageEntity = linkReplicaEntity<LobeDocument>([this.#pageList, this.#pageDetail]);
  }

  // ---- reads -------------------------------------------------------------

  /**
   * Fetch orchestration for the sidebar's page list. Hydrates the persisted
   * projection, then revalidates; the rows land in `pageListMap.all` — read
   * them through `pageSelectors`, never from this hook's result.
   */
  useFetchDocuments = (): ReplicaSyncResult => {
    // Subscribed, so changing the page size re-keys the list query.
    const pageSize = useGlobalStore(systemStatusSelectors.pagePageSize);
    return this.#pageList.useSync({ pageSize });
  };

  /**
   * By-id fetch for a page outside the loaded list (mobile route, deep link).
   * The result lands in `pageDetailMap`, which `getDocumentById` falls back to.
   */
  useFetchPageDetail = (pageId?: string | null): ReplicaSyncResult =>
    this.#pageDetail.useSync(pageId || null);

  // ---- list writes -------------------------------------------------------

  loadMoreDocuments = async (): Promise<void> => {
    await this.#pageList.loadMore(PAGE_LIST_KEY, { pageSize: currentPageSize() });
  };

  refreshDocuments = async (): Promise<void> => {
    await this.#pageList.revalidate(PAGE_LIST_KEY);
  };

  /**
   * Imperative refresh, kept for callers that treat it as a generic
   * "refetch resources" callback (Notion import, the empty-state placeholder).
   */
  fetchDocuments = async (): Promise<void> => this.refreshDocuments();

  setSearchKeywords = (keywords: string): void => {
    this.#set({ searchKeywords: keywords }, false, n('setSearchKeywords'));
  };

  setShowOnlyPagesNotInLibrary = (show: boolean): void => {
    this.#set({ showOnlyPagesNotInLibrary: show }, false, n('setShowOnlyPagesNotInLibrary'));
  };

  /**
   * Publish a private page (and its whole subtree) to the workspace, then
   * refetch the sidebar so the item hops from the "Private" accordion into
   * "Workspace" immediately. Errors bubble up so the caller can surface a
   * localized toast without swallowing the reason.
   */
  publishPageToWorkspace = async (pageId: string): Promise<{ documentIds: string[] }> => {
    const result = await documentService.publishDocumentToWorkspace(pageId);
    await this.refreshDocuments();
    return result;
  };

  /**
   * Flip a page (and its whole subtree)'s workspace visibility. Bidirectional
   * companion to `publishPageToWorkspace`. Refreshes the sidebar so the row
   * hops between the "Private" and "Workspace" accordions.
   */
  setPageVisibility = async (
    pageId: string,
    visibility: 'private' | 'public',
  ): Promise<{ documentIds: string[] }> => {
    const result = await documentService.setDocumentVisibility(pageId, visibility);
    await this.refreshDocuments();
    return result;
  };

  /**
   * Mirror a page document the editor just loaded / saved into the page domain,
   * so title, emoji and workspace lock state resolve even when no list is
   * mounted. Written to the by-id projection always, and to the sidebar row
   * when the list already holds it.
   */
  upsertDocument = (document: DocumentItem): void => {
    const lobeDoc = documentItemToLobeDocument(document);
    this.#pageDetail.update(lobeDoc.id, () => lobeDoc);
    if (this.#get().pageListMap[PAGE_LIST_KEY]?.items.some((doc) => doc.id === lobeDoc.id)) {
      this.#pageList.updateEntity(lobeDoc.id, () => lobeDoc);
    }
  };

  // ---- internal seam for the crud slice ---------------------------------

  /** Insert a freshly created / duplicated page at the head of the list view. */
  internal_insertPageListRow = (doc: LobeDocument): void => {
    const current = this.#get().pageListMap[PAGE_LIST_KEY];
    if (current) {
      this.#pageList.insertHead(PAGE_LIST_KEY, [doc]);
      return;
    }

    // No list loaded yet (mobile, or before the first page arrives): seed a
    // single-row head page so the new page renders immediately. The next sync
    // replaces the head page with the server's for every other row.
    this.#pageList.update(
      PAGE_LIST_KEY,
      () => ({
        currentPage: 0,
        hasMore: false,
        items: [doc],
        pageSize: currentPageSize(),
        total: 1,
      }),
      { persist: false },
    );
  };

  /** Swap an optimistic page row for the server's row (id and all). */
  internal_replacePageListRow = (tempId: string, doc: LobeDocument): void => {
    this.#pageList.update(PAGE_LIST_KEY, (data) =>
      data ? { ...data, items: data.items.map((item) => (item.id === tempId ? doc : item)) } : data,
    );
  };

  /** Drop a page row (and every other loaded copy of it) everywhere it is held. */
  internal_removePageRow = (id: string): void => {
    this.#pageEntity.remove(id);
  };

  /**
   * Optimistic patch of one page in every loaded list and detail copy — one
   * server call settles them all together, or all roll back. Pass `'remove'`
   * for an optimistic delete.
   */
  internal_optimisticPage = <TResult>(
    id: string,
    fn: ((doc: LobeDocument) => LobeDocument) | 'remove',
    serverCall: () => Promise<TResult>,
  ): Promise<TResult> => this.#pageEntity.optimistic(id, fn, serverCall);

  /** Patch one page everywhere it is loaded, without a server call. */
  internal_updatePage = (id: string, fn: (doc: LobeDocument) => LobeDocument): void => {
    this.#pageEntity.update(id, fn);
  };

  /** Re-run the network sync of the page list (the sidebar's refresh). */
  internal_revalidatePageList = (): Promise<unknown> => this.#pageList.revalidate(PAGE_LIST_KEY);
}

export type ListAction = Pick<ListActionImpl, keyof ListActionImpl>;
