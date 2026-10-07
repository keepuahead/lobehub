import { Flexbox } from '@lobehub/ui';
import { Skeleton } from '@lobehub/ui';

const Loading = () => {
  return (
    <Flexbox>
      <Skeleton.Text rows={8} />
    </Flexbox>
  );
};

export default Loading;
