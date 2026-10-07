import { existsSync } from "node:fs";
import { linkedDependencies, linkedDependencyWarning } from "./deps.ts";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Catalog } from "../../core/catalog.ts";
import { json, readJson } from "../../core/files.ts";
import type { Mutation } from "../../core/model.ts";
import { checkArchitecture } from "./check-architecture.ts";
import { initProject } from "./init.ts";
import {
  addModule,
  ejectModule,
  listModules,
  newModule,
  removeModule,
} from "./modules.ts";
import { PACKAGE_VERSION, findProjectRoot } from "./project.ts";
import { runBun } from "./process.ts";
import {
  addSkill,
  linkSkills,
  listSkills,
  publishSkill,
  removeSkill,
} from "./skills.ts";
import {
  addPipeline,
  defaultPipeline,
  listPipelines,
  newPipeline,
  removePipeline,
} from "./pipelines.ts";
import { verifyWorkspace, workspaceUsage } from "./workspace.ts";
import {
  inventory,
  renderBrief,
  renderFull,
  renderHistory,
  renderModule,
  renderPipeline,
} from "./context.ts";
import { installHook } from "./hook.ts";
import { observe, readHistory, recordCommand, type State } from "./tracking.ts";

const HELP = `contents-genesis ${PACKAGE_VERSION}

Project
  cg init [DIR] [--id ID] [--modules a,b] [--skills a,b] [--no-renderer] [--no-install] [--source SPEC]
  cg check                         registry + skills + architecture(있으면) + index 검증

Modules
  cg module list                   설치 모듈·종류·의존 관계, 미설치 기본 모듈
  cg module add <name|./path|pkg>  기본 모듈·로컬 모듈·패키지(npm, github:, file:) 추가
  cg module remove <id> [--cascade]
  cg module new <id>               ./modules/<id> 골격 생성
  cg module eject <id>             기본 모듈을 ./modules/<id>로 복사해 커스텀
  cg run <module> [args...]        모듈의 run.ts 실행

Production pipelines (영상·음성·블로그 등 산출 방식)
  cg pipeline list                 설정된 pipeline과 operation
  cg pipeline add <name> <spec>    @cg/remotion | @cg/command | ./path | 패키지
  cg pipeline new <name>           ./pipelines/<name> 골격 생성
  cg pipeline remove <name> | default <name>
  cg run production <op> [ITEM]    item의 pipeline(또는 --pipeline NAME)으로 실행

Skills
  cg skill list | add <name> | remove <name> | link
  cg skill add local:<name>        로컬 레지스트리(~/.cg/skills, CG_SKILLS_HOME) 스킬 연결
  cg skill publish <name>          프로젝트 스킬을 로컬 레지스트리로 이동 후 local:<name>으로 연결

Agent context (구성·커스텀·변경 이력 자동 추적)
  cg context [--brief|--json]      모듈·pipeline·스킬·커스텀·drift·최근 실행·경고
  cg context module <id> | pipeline <name> | history [--limit N]
  cg context hook                  Claude Code 세션 시작 시 brief 자동 주입

Workspace
  cg doctor | modules | write FILE | show ID [REV] | alias NAMESPACE VALUE
  cg links ID | search TEXT [TYPE] | export | reindex | verify | usage | followup ID

Options
  --project DIR   project root (default: nearest project.json)`;

const args = process.argv.slice(2);
function option(name: string) {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`Missing ${name} value`);
  args.splice(i, 2);
  return value;
}
function flag(name: string) {
  const i = args.indexOf(name);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
}
const list = (value?: string) =>
  value === undefined
    ? undefined
    : value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

async function main(): Promise<unknown> {
  const projectOption = option("--project"),
    cascade = flag("--cascade");
  const root = () => findProjectRoot(projectOption ?? ".");
  const [command, ...rest] = args;
  const required = (i: number, what = "argument") => {
    if (!rest[i]) throw new Error(`Missing ${what}; run cg help`);
    return rest[i]!;
  };

  switch (command) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return undefined;
    case "version":
    case "--version":
      return PACKAGE_VERSION;

    case "init": {
      const id = option("--id"),
        modules = list(option("--modules")),
        skills = list(option("--skills")),
        source = option("--source"),
        renderer = !flag("--no-renderer"),
        install = !flag("--no-install"),
        hook = !flag("--no-hook");
      const result = initProject(args[1] ?? projectOption ?? ".", {
        id,
        modules,
        skills,
        source,
        renderer,
        install,
      });
      if (hook) installHook(result.project);
      observe(result.project);
      return { ...result, agent_hook: hook };
    }

    case "module": {
      const sub = rest[0] ?? "list";
      if (sub === "list") return listModules(root());
      if (sub === "add") {
        const specs = rest.slice(1);
        if (!specs.length) throw new Error("Missing module; run cg help");
        return specs.map((spec) => addModule(root(), spec));
      }
      if (sub === "remove")
        return removeModule(root(), required(1, "module id"), cascade);
      if (sub === "new") return newModule(root(), required(1, "module id"));
      if (sub === "eject") return ejectModule(root(), required(1, "module id"));
      throw new Error(`Unknown module command: ${sub}`);
    }

    case "pipeline": {
      const sub = rest[0] ?? "list";
      if (sub === "list") return listPipelines(root());
      if (sub === "add")
        return addPipeline(root(), required(1, "name"), required(2, "spec"));
      if (sub === "new") return newPipeline(root(), required(1, "name"));
      if (sub === "remove") return removePipeline(root(), required(1, "name"));
      if (sub === "default")
        return defaultPipeline(root(), required(1, "name"));
      throw new Error(`Unknown pipeline command: ${sub}`);
    }

    case "context": {
      const project = root(),
        json = flag("--json"),
        brief = flag("--brief"),
        limit = Number(option("--limit") ?? 20),
        [, scope, name] = args;
      if (scope === "hook") return installHook(project);
      if (scope === "history")
        return json
          ? readHistory(project).slice(-limit)
          : renderHistory(readHistory(project), limit);
      const inv = await inventory(project, scope ? 1000 : brief ? 3 : 10);
      if (json)
        return scope === "module"
          ? inv.modules.find((m) => m.id === name)
          : scope === "pipeline"
            ? inv.pipelines.find((p) => p.name === name)
            : inv;
      if (scope === "module")
        return renderModule(
          inv,
          name ?? required(1, "module id"),
          readHistory(project),
        );
      if (scope === "pipeline")
        return renderPipeline(
          inv,
          name ?? required(1, "pipeline name"),
          readHistory(project),
        );
      if (scope) throw new Error(`Unknown context scope: ${scope}`);
      return brief ? renderBrief(inv) : renderFull(inv);
    }

    case "skill": {
      const sub = rest[0] ?? "list";
      if (sub === "list") return listSkills(root());
      if (sub === "add") return addSkill(root(), required(1, "skill name"));
      if (sub === "remove")
        return removeSkill(root(), required(1, "skill name"));
      if (sub === "publish")
        return publishSkill(root(), required(1, "skill name"));
      if (sub === "link") return linkSkills(root());
      throw new Error(`Unknown skill command: ${sub}`);
    }

    case "run": {
      const project = root(),
        catalog = new Catalog(project),
        id = required(0, "module id"),
        source = catalog.registry.sources.get(id);
      if (!source) throw new Error(`Module not installed: ${id}`);
      const entry = resolve(source.dir, "run.ts");
      if (!existsSync(entry)) throw new Error(`Module ${id} has no run.ts`);
      runBun([entry, ...rest.slice(1)], project, { CG_PROJECT_ROOT: project });
      return undefined;
    }

    case "check": {
      const project = root(),
        catalog = new Catalog(project),
        skills = linkSkills(project),
        links = linkedDependencies(project);
      for (const d of links) console.error("warning: " + linkedDependencyWarning(d));
      if (skills.broken.length)
        throw new Error("Broken shared skills: " + skills.broken.join(", "));
      return {
        doctor: catalog.doctor(),
        skills: skills.linked,
        ...(skills.missing.length ? { missing_local_skills: skills.missing } : {}),
        ...(links.length ? { linked_dependencies: links } : {}),
        architecture: existsSync(resolve(project, "architecture/registry.json"))
          ? checkArchitecture(project)
          : null,
        workspace: verifyWorkspace(catalog),
      };
    }
  }

  // Workspace data commands.
  const catalog = new Catalog(root());
  switch (command) {
    case "doctor":
      return catalog.doctor();
    case "modules":
      return [...catalog.registry.modules.values()];
    case "write":
      return catalog.commit(
        readJson<Mutation[]>(required(0, "FILE")),
        "human:local-cli",
      );
    case "show": {
      const revision = rest[1] === undefined ? undefined : Number(rest[1]);
      if (
        revision !== undefined &&
        (!Number.isInteger(revision) || revision < 1)
      )
        throw new Error("Invalid revision");
      const record = catalog.get(required(0, "ID"), revision);
      if (!record) throw new Error("Record not found");
      return { record, definition_installed: catalog.registry.known(record) };
    }
    case "alias": {
      const record = catalog.resolveAlias(required(0), required(1));
      if (!record) throw new Error("Alias not found");
      return record;
    }
    case "links":
      return catalog.relations(required(0, "ID"));
    case "search":
      return catalog.search(rest[0] ?? "", rest[1]);
    case "export":
      return catalog.export();
    case "reindex":
      return catalog.reindex();
    case "verify":
      return verifyWorkspace(catalog);
    case "usage":
      return workspaceUsage(catalog);
    case "followup": {
      const source = catalog.registry.sources.get("followups");
      if (!source) throw new Error("followups module not installed");
      const { followupStatus } = await import(
        pathToFileURL(resolve(source.dir, "src/status.ts")).href
      );
      return followupStatus(catalog, required(0, "ID"));
    }
    default:
      throw new Error(`Unknown command: ${command}; run cg help`);
  }
}

// Configuration tracking: note external edits before, cg-made changes after.
const TRACKED_SKIP = new Set([
  undefined,
  "help",
  "--help",
  "-h",
  "version",
  "--version",
  "init",
]);
let tracked: { root: string; before: State } | undefined;
if (!TRACKED_SKIP.has(args[0]))
  try {
    const at = args.indexOf("--project"),
      root = findProjectRoot(at >= 0 && args[at + 1] ? args[at + 1]! : ".");
    tracked = { root, before: observe(root) };
  } catch {
    // Not in a project or unreadable config: commands report their own errors.
  }
const commandLine = args
  .filter((a, i) => a !== "--project" && args[i - 1] !== "--project")
  .join(" ");

try {
  const result = await main();
  if (tracked)
    try {
      recordCommand(tracked.root, tracked.before, commandLine);
    } catch {}
  if (result !== undefined)
    console.log(typeof result === "string" ? result : json(result).trimEnd());
} catch (error) {
  console.error("cg: " + (error as Error).message);
  process.exitCode = 1;
}
