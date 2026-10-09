import { CUSTOM_DOCUMENT_FILE_TYPE } from '@lobechat/const';
import type { DocumentItem } from '@lobechat/database/schemas';

import { documentService } from '@/services/document';
import { type StoreSetter } from '@/store/types';
import { DocumentSourceType, type LobeDocument } from '@/types/document';
import { standardizeIdentifier } from '@/utils/identifier';
import { setNamespace } from '@/utils/storeDebug';

import { documentItemToLobeDocument, TEMP_PAGE_ID_PREFIX } from '../../projection';
import { type PageStore } from '../../store';
import { listSelectors } from '../list';

const n = setNamespace('page/crud');

const EDITOR_PAGE_FILE_TYPE = CUSTOM_DOCUMENT_FILE_TYPE;

/**
 * Page update parameters - flattened for easier use
 */
export interface PageUpdateParams {
  emoji?: string;
  title?: string;
}

type Setter = StoreSetter<PageStore>;

/**
 * The page domain's write slice. It never touches the replicas directly: every
 * local write goes through the `internal_*` seam the list slice hands out, so
 * the list rows and the by-id copies stay one entity.
 */
export const createCrudSlice = (set: Setter, get: () => PageStore, _api?: unknown) =>
  new CrudActionImpl(set, get, _api);

export class CrudActionImpl {
  readonly #get: () => PageStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => PageStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  createNewPage = async (title: string, visibility?: 'private' | 'public'): Promise<string> => {
    const { createOptimisticPage, createPage } = this.#get();

    // Create optimistic page immediately in the requested bucket so the item
    // shows up under the correct accordion before the server responds. The
    // real row will replace it and confirm the visibility a moment later.
    const tempPageId = createOptimisticPage(title, visibility);
    this.#set({ isCreatingNew: true, selectedPageId: tempPageId }, false, n('createNewPage/start'));

    try {
      // Create real page
      const newPage = await createPage({ content: '', title, visibility });

      // The server row carries `visibility` / `workspaceId`; keeping them is what
      // holds the sidebar row in the accordion the user clicked "+" from.
      const realPage = documentItemToLobeDocument(newPage);

      // Replace optimistic with real
      this.#get().internal_replacePageListRow(tempPageId, realPage);
      this.#set(
        { isCreatingNew: false, selectedPageId: realPage.id },
        false,
        n('createNewPage/success'),
      );

      // Navigate to the new page
      this.#get().navigateToPage(realPage.id);

      return realPage.id;
    } catch (error) {
      console.error('Failed to create page:', error);
      this.#get().removeTempPage(tempPageId);
      this.#set({ isCreatingNew: false, selectedPageId: null }, false, n('createNewPage/error'));
      this.#get().navigate?.('/page');

      throw error;
    }
  };

  createOptimisticPage = (
    title: string = 'Untitled',
    visibility?: 'private' | 'public',
  ): string => {
    // Generate temporary ID with prefix to identify optimistic pages
    const tempId = `${TEMP_PAGE_ID_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const now = new Date();

    const newPage: LobeDocument = {
      content: null,
      createdAt: now,
      editorData: null,
      fileType: EDITOR_PAGE_FILE_TYPE,
      filename: title,
      id: tempId,
      metadata: {},
      source: 'document',
      sourceType: DocumentSourceType.EDITOR,
      title,
      totalCharCount: 0,
      totalLineCount: 0,
      updatedAt: now,
      visibility: visibility ?? null,
    };

    this.#get().internal_insertPageListRow(newPage);

    return tempId;
  };

  createPage = async ({
    title,
    content = '',
    knowledgeBaseId,
    parentId,
    visibility,
  }: {
    content?: string;
    knowledgeBaseId?: string;
    parentId?: string;
    title: string;
    visibility?: 'private' | 'public';
  }): Promise<DocumentItem> => {
    const now = Date.now();

    return documentService.createDocument({
      content,
      editorData: '{}',
      fileType: EDITOR_PAGE_FILE_TYPE,
      knowledgeBaseId,
      metadata: {
        createdAt: now,
      },
      parentId,
      title,
      visibility,
    });
  };

  deletePage = async (pageId: string): Promise<void> => {
    const { selectedPageId } = this.#get();

    if (selectedPageId === pageId) {
      this.#set({ isCreatingNew: false, selectedPageId: null }, false, n('deletePage'));
      this.#get().navigateToPage(null);
    }
  };

  duplicatePage = async (pageId: string): Promise<DocumentItem> => {
    // Fetch the source page
    const sourcePage = await documentService.getDocumentById(pageId);

    if (!sourcePage) {
      throw new Error(`Page with ID ${pageId} not found`);
    }

    // Create a new page with copied properties
    const newPage = await documentService.createDocument({
      content: sourcePage.content || '',
      editorData: sourcePage.editorData
        ? typeof sourcePage.editorData === 'string'
          ? sourcePage.editorData
          : JSON.stringify(sourcePage.editorData)
        : '{}',
      fileType: sourcePage.fileType,
      metadata: {
        ...sourcePage.metadata,
        createdAt: Date.now(),
        duplicatedFrom: pageId,
      },
      title: `${sourcePage.title} (Copy)`,
    });

    // The duplicate is the newest row: insert it at the head instead of waiting
    // for the next list refresh.
    this.#get().internal_insertPageListRow(documentItemToLobeDocument(newPage));

    return newPage;
  };

  navigateToPage = (pageId: string | null): void => {
    if (!pageId) {
      this.#get().navigate?.('/page');
    } else {
      this.#get().navigate?.(`/page/${standardizeIdentifier(pageId)}`);
    }
  };

  removePage = async (pageId: string): Promise<void> => {
    const { selectedPageId } = this.#get();

    // Clear the selection before the row disappears so the editor navigates
    // away from the page it is about to lose.
    if (selectedPageId === pageId) {
      this.#set({ selectedPageId: null }, false, n('removePage/clearSelection'));
      this.#get().navigateToPage(null);
    }

    try {
      // One overlay across every loaded copy of the page; the delete settles or
      // rolls them all back together.
      await this.#get().internal_optimisticPage(pageId, 'remove', () =>
        documentService.deleteDocument(pageId),
      );
    } catch (error) {
      console.error('Failed to delete page:', error);
      if (selectedPageId === pageId) {
        this.#set({ selectedPageId: pageId }, false, n('removePage/restoreSelection'));
        this.#get().navigateToPage(pageId);
      }
      throw error;
    }
  };

  removeTempPage = (tempId: string): void => {
    this.#get().internal_removePageRow(tempId);
  };

  renamePage = async (pageId: string, title: string, emoji?: string): Promise<void> => {
    const { updatePageOptimistically } = this.#get();

    try {
      await updatePageOptimistically(pageId, { emoji, title });
    } catch (error) {
      console.error('Failed to rename page:', error);
    } finally {
      this.#set({ renamingPageId: null }, false, n('renamePage'));
    }
  };

  replaceTempPageWithReal = (tempId: string, realPage: LobeDocument): void => {
    this.#get().internal_replacePageListRow(tempId, realPage);
  };

  updatePage = async (id: string, updates: Partial<LobeDocument>): Promise<void> => {
    await documentService.updateDocument({
      content: updates.content ?? undefined,
      editorData: updates.editorData
        ? typeof updates.editorData === 'string'
          ? updates.editorData
          : JSON.stringify(updates.editorData)
        : undefined,
      id,
      metadata: updates.metadata,
      parentId: updates.parentId !== undefined ? updates.parentId : undefined,
      title: updates.title,
    });
    await this.#get().refreshDocuments();
  };

  updatePageOptimistically = async (pageId: string, updates: PageUpdateParams): Promise<void> => {
    const existingPage = listSelectors.getDocumentById(pageId)(this.#get());

    if (!existingPage) {
      console.warn('[updatePageOptimistically] Page not found:', pageId);
      return;
    }

    // Clean up undefined values from metadata
    const withEmoji = {
      ...existingPage.metadata,
      ...(updates.emoji !== undefined ? { emoji: updates.emoji } : {}),
    };
    const cleanedMetadata = Object.fromEntries(
      Object.entries(withEmoji).filter(([, v]) => v !== undefined),
    );
    const updatedPage: LobeDocument = {
      ...existingPage,
      metadata: cleanedMetadata,
      title: updates.title ?? existingPage.title,
      updatedAt: new Date(),
    };

    const apply = (doc: LobeDocument): LobeDocument => ({
      ...doc,
      metadata: Object.fromEntries(
        Object.entries({
          ...doc.metadata,
          ...(updates.emoji !== undefined ? { emoji: updates.emoji } : {}),
        }).filter(([, v]) => v !== undefined),
      ),
      title: updates.title ?? doc.title,
      updatedAt: new Date(),
    });

    try {
      // Show the new title / emoji in every copy at once, then persist; a
      // failed sync rolls every copy back to the page it had before.
      await this.#get().internal_optimisticPage(pageId, apply, () =>
        documentService.updateDocument({
          id: pageId,
          metadata: updatedPage.metadata || {},
          parentId: updatedPage.parentId || undefined,
          title: updatedPage.title || updatedPage.filename,
        }),
      );

      // After a successful sync, revalidate the list so the server's ordering
      // and any derived field land.
      await this.#get().internal_revalidatePageList();
    } catch (error) {
      console.error('[updatePageOptimistically] Failed to sync to DB:', error);
    }
  };
}

export type CrudAction = Pick<CrudActionImpl, keyof CrudActionImpl>;
