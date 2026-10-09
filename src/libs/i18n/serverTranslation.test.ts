// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { createServerTranslator } from './server/render';
import { getServerTranslations, translation } from './serverTranslation';

describe('server translations', () => {
  it('renders a real non-default language from projected resources', async () => {
    const { t } = await translation('home', 'zh-CN');
    expect(t('brief.action.openGoal')).toBe('查看目标');
    expect(t('brief.action.openGoal')).not.toBe(
      getServerTranslations('home', 'en-US').t('brief.action.openGoal'),
    );
  });
  it('falls back per key and when a language is absent', () => {
    const resources = {
      'en-US': { home: { title: 'Title', body: 'Hello {{name}}, {{name}}' } },
      'fr-FR': { home: { title: 'Titre' } },
    };
    const copy = createServerTranslator(resources, 'home', 'fr-FR', 'en-US');
    expect(copy.t('title')).toBe('Titre');
    expect(copy.t('body', { name: '$&' })).toBe('Hello $&, $&');
    expect(copy.t('body', { name: '{{other}}', other: 'Replaced' })).toBe(
      'Hello {{other}}, {{other}}',
    );
    expect(copy.find('missing')).toBeUndefined();
    const localOnly = createServerTranslator(resources, 'home', 'fr-FR', 'fr-FR');
    expect(localOnly.find('body')).toBeUndefined();
    expect(localOnly.find('title')).toBe('Titre');
    expect(copy.t('missing')).toBe('missing');
    expect(copy.find('constructor')).toBeUndefined();
    expect(createServerTranslator(resources, 'home', 'zz', 'en-US').t('title')).toBe('Title');
  });
  it('renders bot error copy without importing original catalogs', () => {
    const copy = getServerTranslations('heterogeneousError', 'zh-CN');
    expect(copy.t('heterogeneous.auth_required.title')).toBe('需要重新登录');
    expect(copy.t('heterogeneous.auth_required.description', { agent: 'Codex' })).toContain(
      'Codex',
    );
  });
});
