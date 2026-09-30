# contents-genesis

콘텐츠 제작 프로젝트용 공통 기반. core 레코드 저장소, 기본 모듈 7개, 공유 스킬, `cg` CLI 제공.

## 빠른 시작

```bash
npx contents-genesis init my-channel          # 기본 모듈 7개 + renderer + workspace
cd my-channel
npx cg module list
```

Bun(>=1.3) 필요. `npx`는 Node shim(`bin/cg.js`)이 bun으로 위임.
프로젝트 안에서는 로컬 설치 버전 우선 실행.

## 모듈

`project.json`의 `modules` 배열이 로드 대상. 표기 3종:

| 표기 | 종류 | 위치 |
|---|---|---|
| `@cg/production` | 기본 모듈 | 이 패키지의 `modules/` |
| `./modules/scenes` | 로컬 모듈 | 프로젝트 안 |
| `cg-naver-blog` | 외부 모듈 패키지 | `node_modules/` |

```bash
cg module add experiments                  # 기본 모듈 (누락 의존성 자동 추가)
cg module add ./modules/scenes             # 로컬 모듈
cg module add github:owner/cg-naver-blog   # 외부 패키지 (bun add 후 등록, 실패 시 롤백)
cg module remove analytics [--cascade]     # 의존 모듈 있으면 거부, --cascade로 함께 제거
cg module new scenes                       # ./modules/scenes 골격
cg module eject production                 # 기본 모듈을 ./modules/production으로 복사해 커스텀
cg run production render <ID>              # 모듈 run.ts 실행 (cwd = 프로젝트)
```

- 모든 변경은 Registry 검증 통과 시에만 `project.json`에 기록
- 제거된 모듈의 workspace 기록은 보존. 재추가 시 검증 복구
- 커스텀 우선순위: 로컬 모듈로 확장 → 불가 시 eject (`EJECTED.json`에 원본 버전 기록)

### 모듈 패키지 작성

패키지 루트에 `module.json` + `schemas/`. 코드에서 core 사용:

```ts
import { Catalog, draft, relationDraft } from "contents-genesis/core";
const catalog = new Catalog(process.env.CG_PROJECT_ROOT ?? process.cwd());
```

## Production pipeline

production 모듈은 형식과 무관합니다. 기록, adoption, 실행 journal, 산출물 커밋만 담당하고, 실제 제작 방식은 pipeline이 맡습니다.
영상, 음성, 블로그 등 새 형식을 추가할 때 core나 모듈을 수정할 필요가 없습니다.

```json
"production": {
  "default_pipeline": "remotion",
  "pipelines": {
    "remotion": { "use": "@cg/remotion", "renderer": "renderer" },
    "voice":    { "use": "./pipelines/voice" },
    "blog":     { "use": "@cg/command", "operations": { "build": {
                  "run": ["bun", "tools/post.mjs", "{out}/post.html", "{item.title}"],
                  "outputs": [{ "path": "post.html", "kind": "post" }] } } }
  }
}
```

item(`workspace/stores/production/inputs/projects.json`)은 `"pipeline": "<name>"` 필드로 자기 pipeline을 선택합니다.

| pipeline | 용도 |
|---|---|
| `@cg/remotion` | 영상 제작. 연산: list, check, still, render, package, voice |
| `@cg/command` | 설정만으로 외부 명령 실행. 선언한 outputs를 산출물로 기록 |
| `./pipelines/<name>` | 로컬 TS pipeline (`cg pipeline new <name>`로 골격 생성) |
| `<패키지>` | 외부 pipeline 패키지 |

```bash
cg pipeline list | add <name> <spec> | new <name> | remove <name> | default <name>
cg run production adopt ITEM [--from-run RUN]    # 입력 고정(pin) / 이전 실행이 만든 파일 채택
cg run production <op> ITEM [args]               # item의 pipeline으로 실행
cg run production <op> --pipeline NAME           # item 없는 연산
```

### pipeline 작성

```ts
import { definePipeline } from "contents-genesis/production";
export default definePipeline({
  id: "tts", version: "0.1.0",
  inputs: ({ inputs, item }) => ({ text: "...", files: ["..."] }),  // 선택: adopt 대상
  prepare(ctx) {},                                                    // 선택: stage 구성
  operations: {
    generate: {
      relation: "generated_from",
      async run(ctx) {                  // ctx: item, stage, runDir, adopted, exec(), env
        return { artifacts: [{ file, kind: "audio", media_type: "audio/mpeg" }],
                 adoptable: ["audio/x.mp3"] };   // adopt --from-run으로 inputs에 복사
      },
    },
  },
});
```

- `inputs`가 있으면 item 연산은 adopt가 끝난 뒤에만 실행되고, 산출물은 script에 대한 관계(`rendered_from` / `generated_from`)로 연결됩니다.
- `artifact_kind`는 자유 문자열입니다(`production.artifact@1.1.0`). 기존 v1 기록은 그대로 유지됩니다.
- 레거시 설정 `production.renderer`는 `@cg/remotion`으로 해석되고, `cg pipeline add/new`를 실행하면 명시적인 설정으로 전환됩니다.

## 스킬

`skills/`의 공유 스킬을 프로젝트 `.agents/skills/<name>`에 symlink. `.claude/skills → ../.agents/skills`.
Claude Code·Codex 공통 인식. `postinstall`의 `cg skill link`가 clone 후 링크 복구.

```bash
cg skill list | add <name> | remove <name> | link
```

Claude Code 플러그인으로도 사용 가능 (`.claude-plugin/marketplace.json`).

## 구성 추적과 에이전트 context

cg를 실행할 때마다 프로젝트 구성(모듈, pipeline, 기본 pipeline, 공유·프로젝트 스킬, 로컬 파일 hash)을 `.cg/state.json`과 비교합니다.
변경 사항은 `.cg/history.jsonl`에 기록되고, `.cg/`는 Git으로 관리합니다.

| source | 의미 |
|---|---|
| `baseline` | 추적을 시작한 시점의 구성 |
| `cg` | cg 명령으로 바꾼 변경. `command`와 `actor`(human / agent:claude-code / agent:codex / `CG_ACTOR`)를 함께 기록 |
| `external` | 파일을 직접 고친 변경. 다음 cg 실행 때 감지되며 `observed_by`를 기록 |

```bash
cg context --brief                 # 한 화면 요약 (세션 시작 hook이 주입하는 내용)
cg context                         # 모듈 표, 커스텀, pipeline 연산, 스킬, 최근 실행, 변경 이력, 경고
cg context module <id>             # 타입 필수 필드, 관계, 의존성, eject drift, 해당 모듈 이력
cg context pipeline <name>         # 연산, adoption 필요 여부, 최근 실행, 이력
cg context history [--limit N]
cg context --json                  # 구조화 데이터
cg context hook                    # Claude Code SessionStart hook 설치 (init은 기본으로 설치, --no-hook으로 생략)
```

- eject한 모듈은 원본 파일 hash를 저장해 두고, 로컬에서 수정·추가·삭제한 파일과 이후 upstream 변경 여부를 보고합니다.
- 에이전트에 전달하는 경로: SessionStart hook(자동 주입), 공유 스킬 `cg-context`(init 때 기본 링크), AGENTS.md 규칙

## 워크스페이스 명령

```bash
cg doctor | check | verify | usage | reindex | export
cg write FILE | show ID [REV] | alias NS VALUE | links ID | search TEXT [TYPE] | followup ID
```

## 프로젝트 설정 (`project.json`)

```json
{
  "format_version": "1.0.0",
  "id": "my-channel",
  "modules": ["@cg/sources", "@cg/research", "@cg/production", "./modules/scenes"],
  "stores": { "records": "workspace/records", "objects": "workspace/objects", "stores": "workspace/stores",
              "indexes": "workspace/indexes", "runs": "workspace/runs", "work": "workspace/work" },
  "skills": ["kit-browser-automation"],
  "production": { "renderer": "renderer" }
}
```

- `id`: 레코드 alias namespace 접두사 (`<id>:production`)
- `production.renderer`: production 모듈이 사용할 Remotion 렌더러 경로

## 개발

```bash
bun install
bun run check        # tsc + 계약 테스트 + CLI 테스트
```

로컬 checkout에서 `init` 시 의존성은 `file:<checkout>` (복사 설치).
checkout 수정 즉시 반영 필요 시: 이 디렉터리에서 `bun link` → 프로젝트 의존성 `"contents-genesis": "link:contents-genesis"`.

## 배포

- CI: `main` push / PR → `bun run check`
- 릴리스: `npm version <patch|minor>` → `git push --follow-tags` → `publish` workflow가 check 후 `npm publish --provenance`
- npm trusted publishing(OIDC) 사용. 토큰 secret 불필요

## License

MIT
