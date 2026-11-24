import { cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const ENV_ALLOW = ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TERM", "USER", "LOGNAME", "SHELL"] as const;
const SKIP = new Set([".git", "node_modules"]);

export type Sandbox = {
  root: string;
  home: string;
  work: string;
  artifacts: string;
  env(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
};

export function assertPathWithin(root: string, target: string): void {
  const rel = relative(resolve(root), resolve(target));
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Path escapes sandbox: ${target}`);
  }
}

export async function createSandbox(input: { parent: string; name: string }): Promise<Sandbox> {
  const root = await mkdtemp(join(input.parent, `${input.name}-`));
  const home = join(root, "home");
  const work = join(root, "work");
  const artifacts = join(root, "artifacts");
  await Promise.all([mkdir(home), mkdir(work), mkdir(artifacts)]);
  return {
    root,
    home,
    work,
    artifacts,
    env(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
      const env: NodeJS.ProcessEnv = { HOME: home };
      for (const key of ENV_ALLOW) {
        const value = source[key];
        if (typeof value === "string") env[key] = value;
      }
      return env;
    },
  };
}

export async function copyDirectory(source: string, target: string): Promise<void> {
  await mkdir(target, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isDirectory()) await copyDirectory(from, to);
    else await cp(from, to);
  }
}

export async function cleanupSandbox(sandbox: Sandbox): Promise<void> {
  await rm(sandbox.root, { recursive: true, force: true });
}
