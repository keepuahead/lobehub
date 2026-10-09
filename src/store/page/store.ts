import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';
import { type StateCreator } from 'zustand/vanilla';

import { createDevtools } from '../middleware/createDevtools';
import { expose } from '../middleware/expose';
import { flattenActions } from '../utils/flattenActions';
import { type ResetableStore, ResetableStoreAction } from '../utils/resetableStore';
import { type PageState } from './initialState';
import { initialState } from './initialState';
import { createCrudSlice, type CrudAction } from './slices/crud';
import { createListSlice, type ListAction } from './slices/list';
import { createSelectionSlice, type SelectionAction } from './slices/selection';

//  ===============  Aggregate createStoreFn ============ //

export type PageStore = PageState & ListAction & SelectionAction & CrudAction & ResetableStore;

type PageStoreAction = ListAction & SelectionAction & CrudAction & ResetableStore;

class PageStoreResetAction extends ResetableStoreAction<PageStore> {
  protected readonly resetActionName = 'resetPageStore';
}

const createStore: StateCreator<PageStore, [['zustand/devtools', never]]> = (
  ...parameters: Parameters<StateCreator<PageStore, [['zustand/devtools', never]]>>
) => ({
  ...initialState,
  ...flattenActions<PageStoreAction>([
    // The list slice owns the domain's replicas and must be built before the
    // crud slice, which issues its local writes through the `internal_*` seam.
    createListSlice(...parameters),
    createSelectionSlice(...parameters),
    createCrudSlice(...parameters),
    new PageStoreResetAction(...parameters),
  ]),
});

//  ===============  Implement useStore ============ //
const devtools = createDevtools('page');

export const usePageStore = createWithEqualityFn<PageStore>()(devtools(createStore), shallow);

expose('page', usePageStore);

export const getPageStoreState = () => usePageStore.getState();
