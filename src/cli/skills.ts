import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { PACKAGE_ROOT } from "../../core/resolve.ts";
import { readProject, updateProject } from "./project.ts";

const SKILLS_DIR = ".agents/skills";

export function availableSkills(): string[] {
  const dir = resolve(PACKAGE_ROOT, "skills");
  return readdirSync(dir, { withFileTypes: true })
    .filter(
      (e) => e.isDirectory() && existsSync(resolve(dir, e.name, "SKILL.md")),
    )
    .map((e) => e.name)
    .sort();
}

/** Prefer the project's own installed copy so links survive npx cache cleanup. */
function skillSource(root: string, name: string) {
  const local = resolve(root, "node_modules/contents-genesis/skills", name);
  if (existsSync(resolve(local, "SKILL.md"))) return local;
  const shipped = resolve(PACKAGE_ROOT, "skills", name);
  if (existsSync(resolve(shipped, "SKILL.md"))) return shipped;
  throw new Error(`Unknown shared skill: ${name}`);
}

const isLink = (path: string) => {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
};

/** Claude Code reads .claude/skills; Codex reads .agents/skills. Keep one source. */
function ensureClaudeLink(root: string) {
  const claude = resolve(root, ".claude/skills");
  if (existsSync(claude) || isLink(claude)) return;
  mkdirSync(dirname(claude), { recursive: true });
  symlinkSync("../" + SKILLS_DIR, claude, "dir");
}

function link(root: string, name: string) {
  const target = resolve(root, SKILLS_DIR, name),
    source = skillSource(root, name);
  mkdirSync(dirname(target), { recursive: true });
  if (isLink(target)) rmSync(target);
  else if (existsSync(target))
    throw new Error(
      `${SKILLS_DIR}/${name} is a project-owned skill; rename it or remove it first`,
    );
  symlinkSync(relative(dirname(target), source), target, "dir");
  ensureClaudeLink(root);
}

export function listSkills(root: string) {
  const config = readProject(root),
    dir = resolve(root, SKILLS_DIR),
    present = existsSync(dir) ? readdirSync(dir) : [];
  return {
    shared: (config.skills ?? []).map((name) => ({
      name,
      linked: isLink(resolve(dir, name)),
    })),
    project: present.filter(
      (name) => !isLink(resolve(dir, name)) && !name.startsWith("."),
    ),
    available: availableSkills().filter(
      (n) => !(config.skills ?? []).includes(n),
    ),
  };
}

export function addSkill(root: string, name: string) {
  link(root, name);
  updateProject(root, (c) => {
    c.skills = [...new Set([...(c.skills ?? []), name])];
  });
  return { linked: name };
}

export function removeSkill(root: string, name: string) {
  const target = resolve(root, SKILLS_DIR, name);
  if (existsSync(target) && !isLink(target))
    throw new Error(`${name} is a project-owned skill; delete it manually`);
  if (isLink(target)) rmSync(target);
  updateProject(root, (c) => {
    c.skills = (c.skills ?? []).filter((s) => s !== name);
  });
  return { unlinked: name };
}

/** Recreate every shared-skill link from project.json (e.g. after clone). */
export function linkSkills(root: string) {
  const skills = readProject(root).skills ?? [];
  for (const name of skills) link(root, name);
  if (skills.length) ensureClaudeLink(root);
  return {
    linked: skills,
    broken: skills.filter((n) => {
      const path = resolve(root, SKILLS_DIR, n);
      return !existsSync(path) || !readlinkSync(path);
    }),
  };
}
