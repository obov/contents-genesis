---
name: cg-context
description: "contents-genesis(cg) 프로젝트의 현재 구성·커스텀 내역·변경 이력 조회. 모듈·pipeline·스킬 구성 파악, 어떤 모듈이 로컬/eject/패키지인지, eject 모듈의 수정·upstream drift, 최근 실행 실패, 누가 언제 구성을 바꿨는지 확인할 때 사용. \"모듈 뭐 있어\", \"pipeline 구성\", \"커스텀한 거\", \"최근 변경\", \"production 어떻게 돌려\", 모듈·pipeline 추가/수정 작업 전."
---

# cg context

project.json이 있는 contents-genesis 프로젝트에서 구성을 추측하지 말고 조회한다.

## 언제

- 작업 시작 시 구성을 모를 때 (세션 시작 hook이 brief를 이미 주입했으면 생략)
- 모듈·pipeline·스킬을 추가·수정·eject하기 전
- 레코드 타입·필수 필드·관계를 써야 할 때
- 실행(`cg run production ...`) 실패 원인 추적 시

## 명령

```sh
bun cg context --brief            # 한 화면 요약
bun cg context                    # 전체: 모듈 표, 커스텀, pipeline 연산, 스킬, 최근 실행, 변경 이력, 경고
bun cg context module <id>        # 타입(필수 필드)·관계·의존·eject drift·해당 모듈 이력
bun cg context pipeline <name>    # 연산·adoption 필요 여부·최근 실행·이력
bun cg context history [--limit N]
bun cg context --json             # 구조화 데이터 (module/pipeline 범위도 --json 가능)
```

## 해석

- kind: `builtin`(패키지 제공, 수정 금지) / `local`(프로젝트 소유) / `ejected`(기본 모듈 복사본, 직접 수정 가능) / `package`(외부 패키지)
- ejected `upstream CHANGED`: eject 이후 contents-genesis 원본이 바뀜 → 사용자에게 알리고 병합 여부 확인
- history `source`
  - `cg`: cg 명령으로 변경 (`command`, `actor` 기록)
  - `external`: 파일 직접 수정이 다음 cg 실행 때 감지됨 (`actor: unknown`, `observed_by`)
  - `baseline`: 추적 시작 시점 상태
- warnings는 사용자에게 그대로 전달

## 규칙

- 구성 변경은 가능한 한 cg 명령으로 (`cg module|pipeline|skill ...`). 직접 편집도 external로 추적되지만 의도가 남지 않음
- 변경 후 `bun cg check`
