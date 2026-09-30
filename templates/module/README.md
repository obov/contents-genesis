# {{id}}

로컬 모듈. `module.json`에 타입·관계를 선언하고 `schemas/`에 JSON Schema를 둔다.

- 타입·관계 이름은 `{{id}}.` 접두사 필수
- 다른 모듈 타입을 관계 끝점으로 쓰면 `requires_modules`에 선언
- 실행 코드가 필요하면 `run.ts` 추가 → `bun cg run {{id}} ...`
  - core API: `import { Catalog, draft, relationDraft } from "contents-genesis/core"`
  - 프로젝트 루트: `process.env.CG_PROJECT_ROOT`
