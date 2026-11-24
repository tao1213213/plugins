import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const ENV_ALLOW = [
  "PATH",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TERM",
  "USER",
  "LOGNAME",
  "SHELL",
];

export function assertPathWithin(root, target) {
  const rel = relative(resolve(root), resolve(target));
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Path escapes sandbox: ${target}`);
  }
}

export async function createIsolatedWorkspace({ root, prefix = "agent-sandbox-" }) {
  const base = await mkdtemp(join(root, prefix));
  const home = join(base, "home");
  const work = join(base, "work");
  const artifacts = join(base, "artifacts");
  await Promise.all([mkdir(home), mkdir(work), mkdir(artifacts)]);

  return {
    root: base,
    home,
    work,
    artifacts,
    env(source) {
      const env = { HOME: home };
      for (const key of ENV_ALLOW) {
        if (typeof source[key] === "string") env[key] = source[key];
      }
      return env;
    },
    async cleanup({ keepArtifacts = false } = {}) {
      if (!keepArtifacts) {
        await rm(base, { recursive: true, force: true });
        return;
      }
      await Promise.all([
        rm(home, { recursive: true, force: true }),
        rm(work, { recursive: true, force: true }),
      ]);
    },
  };
}
