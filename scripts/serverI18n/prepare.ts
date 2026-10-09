import { execFile } from 'node:child_process';
import { watch } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

/** Run outside the bundler process so the compiler's graph memory is released before bundling. */
export const prepareServerI18n = async (root: string) => {
  const { stdout } = await execute('bun', [path.join(repoRoot, 'scripts/serverI18n/index.ts')], {
    cwd: root,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (stdout) console.info(stdout.trim());
};

export const watchServerI18n = (root: string) => {
  let timer: ReturnType<typeof setTimeout>;
  let pending = Promise.resolve();
  const watchers = ['src', 'apps/server', 'packages', 'locales'].map((directory) =>
    watch(path.join(root, directory), { recursive: true }, (_event, filename) => {
      if (
        !filename ||
        filename.includes('node_modules') ||
        filename.includes('/generated/') ||
        filename.includes('/dist/') ||
        /\.(?:test|spec)\./.test(filename) ||
        !/\.(?:ts|tsx|json)$/.test(filename)
      )
        return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        pending = pending
          .then(() => prepareServerI18n(root))
          .catch(async (error) => {
            // Do not keep serving stale translations after a failed extraction.
            await rm(path.join(repoRoot, 'src/libs/i18n/server/generated/resources.js'), {
              force: true,
            });
            console.error('Server i18n extraction failed:', error);
          });
      }, 300);
    }),
  );
  return () => {
    clearTimeout(timer);
    watchers.forEach((watcher) => watcher.close());
  };
};
