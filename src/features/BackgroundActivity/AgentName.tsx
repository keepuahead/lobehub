import { Avatar } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

const styles = createStaticStyles(({ css }) => ({
  avatar: css`
    flex: none;
  `,
  title: css`
    overflow: hidden;
    flex: none;

    max-width: 160px;

    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

export const agentName = (id?: string) =>
  id ? agentSelectors.getAgentMetaById(id)(useAgentStore.getState()).title : undefined;

/** Avatar + title of the agent that owns a background activity, fetched on demand. */
export function AgentName({ id }: { id: string }) {
  const { t } = useTranslation('chat');
  const loaded = useAgentStore((s) => !!s.agentMap[id]);
  const title = useAgentStore((s) => agentSelectors.getAgentMetaById(id)(s).title);
  const avatar = useAgentStore((s) => agentSelectors.getAgentMetaById(id)(s).avatar);
  const background = useAgentStore((s) => agentSelectors.getAgentMetaById(id)(s).backgroundColor);
  const useFetchAgentConfig = useAgentStore((s) => s.useFetchAgentConfig);
  useFetchAgentConfig(true, loaded ? '' : id);
  const name = title || t('backgroundActivity.agent');
  return (
    <>
      <Avatar
        avatar={avatar}
        background={background}
        className={styles.avatar}
        shape={'square'}
        size={16}
      />
      <span className={styles.title} title={name}>
        {name}
      </span>
    </>
  );
}
