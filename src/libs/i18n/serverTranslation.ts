import { DEFAULT_LANG } from '@/const/locale';
import { normalizeLocale } from '@/locales/resources';

import { serverResources } from './server/generated/resources';
import { createServerTranslator } from './server/render';
import type { ServerNamespace } from './server/types';

export type { ServerTranslate, ServerTranslator } from './server/types';

export const getLocale = async (hl?: string) => normalizeLocale(hl);

/** Resources are extracted before bundling; this never imports the full locale catalog. */
export const getServerTranslations = <N extends ServerNamespace>(ns: N, hl?: string) =>
  createServerTranslator(serverResources, ns, normalizeLocale(hl), DEFAULT_LANG);

/** Async compatibility entry point for existing server services and HTML shells. */
export const translation = async <N extends ServerNamespace>(ns: N, hl: string) =>
  getServerTranslations(ns, hl);
