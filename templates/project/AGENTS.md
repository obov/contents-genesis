# {{id}} 작업 기준

contents-genesis 기반 프로젝트. 모듈·공유 스킬은 `cg` CLI로 관리한다.

## 구조

- `project.json`: 사용 모듈(`modules`), 공유 스킬(`skills`), 저장소 경로
  - `@cg/<name>`: contents-genesis 기본 모듈 (node_modules 안, 직접 수정 금지)
  - `./modules/<name>`: 이 프로젝트 전용 모듈 (직접 수정)
  - `<패키지명>`: 외부 모듈 패키지
- `renderer/`: `@cg/remotion` pipeline이 쓰는 Remotion 렌더러 (편별 코드 포함)
- `pipelines/`: 프로젝트 전용 제작 pipeline
- `.agents/skills/`: 프로젝트 전용 스킬 + 공유 스킬 symlink (`.claude/skills`가 같은 곳을 가리킴)
- `workspace/`: 실제 자료. Git 제외

## 구성 파악

- 현재 모듈·pipeline·스킬·커스텀 내역·최근 변경: `bun cg context` (Claude Code는 세션 시작 시 brief 자동 주입)
- 특정 대상: `bun cg context module <id>` / `bun cg context pipeline <name>` / `bun cg context history`
- 구성 변경 이력은 `.cg/history.jsonl`에 자동 기록 (cg 명령과 직접 편집 모두). `.cg/`는 Git에 포함

## 모듈 관리

- 목록: `bun cg module list`
- 추가: `bun cg module add <name|./path|package>` (기본 모듈 의존성 자동 추가)
- 제거: `bun cg module remove <id> [--cascade]` (기록은 보존)
- 새 모듈: `bun cg module new <id>`
- 기본 모듈 수정 필요 시: 먼저 새 로컬 모듈로 확장. 불가능할 때만 `bun cg module eject <id>`
- 모듈 실행: `bun cg run <module> ...`

## 제작 pipeline

- 제작 방식(영상·음성·블로그 등)은 `project.json`의 `production.pipelines`에서 설정
- item은 `inputs/projects.json`에서 `"pipeline"` 필드로 pipeline 선택
- 목록: `bun cg pipeline list` / 새 방식: `bun cg pipeline new <name>` / 명령 기반: `@cg/command`
- 실행: `bun cg run production adopt ITEM` → `bun cg run production <op> ITEM`

## 규칙

- 모듈 간 연결은 공개 레코드 ID와 관계만 사용. 다른 모듈 내부 파일 의존 금지
- workspace·secrets·개인 계정 자료 Git 제외
- 불변 기록 직접 수정 금지. 새 revision 작성
- 변경 후 `bun cg check`
- 스키마 등록만으로 외부 API·유료 처리기 실행 금지
