import { useCallback } from 'react';

import { mutate } from '@/libs/swr';
import { documentService } from '@/services/document';
import { documentSWRKeys } from '@/services/document/swrKeys';
import { useDocumentStore } from '@/store/document';

/**
 * Returns a callback to prefetch page/document data before navigation.
 * Call the returned function on mouseEnter to warm the caches.
 */
export const usePrefetchPage = () => {
  return useCallback((documentId: string) => {
    if (!documentId) return;

    // Prefetch the document detail into its replica (for the editor)
    void useDocumentStore.getState().prefetchDocument(documentId);

    // Prefetch page documents list (for the sidebar)
    mutate(documentSWRKeys.pageDocuments(), documentService.getPageDocuments(), {
      revalidate: false,
    });
  }, []);
};
