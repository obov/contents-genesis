---
name: cg-context
description: "contents-genesis(cg) 자체에 관한 단일 스킬. 'cg' = contents-genesis (npm 패키지 contents-genesis, 원본 저장소 github.com/obov/contents-genesis, 로컬 원본 ../contents-genesis). 분기: (1) 프로젝트 구성·커스텀·변경 이력 조회 (2) cg 버전 갱신·공유 스킬 받기 (3) 원본 저장소에서 공유 스킬 추가·수정·npm 배포. \"모듈 뭐 있어\", \"pipeline 구성\", \"커스텀한 거\", \"최근 변경\", \"production 어떻게 돌려\", \"cg 받아줘\", \"cg 최신화\", \"0.4.x로 스킬 공유했어\", \"<스킬명> 받아줘\", \"cg에 스킬 추가\", \"스킬 공유해줘\", \"cg 배포\", \"npm 배포\", \"버전 올려줘\" 요청. 콘텐츠 작업 스킬(kit-*)과 별개."
---

# cg (contents-genesis)

## 용어

```text
cg              contents-genesis. 프로젝트 기반 프레임워크 + CLI (bun cg ...)
원본 저장소      github.com/obov/contents-genesis. 로컬 ../contents-genesis (있을 때)
cg 프로젝트      project.json 이 있는 저장소. contents-genesis 를 npm 의존성으로 사용
공유 스킬        원본 skills/<name>. 프로젝트 .agents/skills/<name> 에 symlink
스킬 접두어      cg-* = cg 자체 · kit-* = 콘텐츠 작업 재사용 키트 · 그 외 = 프로젝트/도메인
"0.4.x로 공유했어"  해당 버전에 새 공유 스킬·수정이 담겨 npm 배포됨 → 프로젝트에서 받기 (B2)
```

## 분기

```text
현재 위치                         요청                          분기
cg 프로젝트 (project.json)        구성 · 이력 · 실패 원인          B1 조회
cg 프로젝트                       받아줘 · 최신화 · 공유했어        B2 갱신 · 받기
원본 저장소 (package name = contents-genesis)  스킬 추가 · 수정 · 배포   B3 원본 작업 · 배포
cg 프로젝트에서 "cg에 올려/배포"    원본 저장소로 이동 → B3 → 다시 프로젝트에서 B2
```

## B1. 구성 조회

구성을 추측하지 말고 조회. 세션 시작 hook 이 brief 를 이미 주입했으면 brief 생략.

```sh
bun cg context --brief            # 한 화면 요약
bun cg context                    # 전체: 모듈 표, 커스텀, pipeline 연산, 스킬, 최근 실행, 변경 이력, 경고
bun cg context module <id>        # 타입(필수 필드)·관계·의존·eject drift·해당 모듈 이력
bun cg context pipeline <name>    # 연산·adoption 필요 여부·최근 실행·이력
bun cg context history [--limit N]
bun cg context --json             # 구조화 데이터 (module/pipeline 범위도 --json 가능)
```

언제: 구성을 모를 때 · 모듈·pipeline·스킬 추가/수정/eject 전 · 레코드 타입·필수 필드·관계가 필요할 때 · `cg run production ...` 실패 추적

해석:

- kind: `builtin`(패키지 제공, 수정 금지) / `local`(프로젝트 소유) / `ejected`(기본 모듈 복사본, 직접 수정 가능) / `package`(외부 패키지)
- ejected `upstream CHANGED`: eject 이후 원본 변경 → 사용자에게 알리고 병합 여부 확인
- history `source`: `cg`(cg 명령, `command`·`actor` 기록) / `external`(직접 수정, 다음 cg 실행 때 감지, `observed_by`) / `baseline`(추적 시작 상태)
- warnings 는 사용자에게 그대로 전달

## B2. 버전 갱신 · 공유 스킬 받기 (cg 프로젝트)

```sh
npm view contents-genesis version                              # 1. 배포된 최신 버전
grep '"version"' node_modules/contents-genesis/package.json    # 2. 설치 버전
bun add contents-genesis@^<최신>                                # 3. 갱신 (package.json 범위도 올림)
bun cg skill list                                              # 4. 공유 스킬 목록
bun cg skill add <name>                                        # 5. 요청 스킬 추가 (project.json skills + symlink)
bun cg check                                                   # 6. 검증
bun cg context --brief                                         # 7. 반영 확인
```

- 스킬명 없는 요청: 새 버전에서 추가된 스킬을 보여주고 받을 것 확인. 변경 내역은 원본 `git log v<이전>..v<최신> -- skills`
- 이미 받은 공유 스킬은 symlink → 패키지 갱신만으로 최신 반영
- 사용자가 말한 버전이 아직 npm 에 없음: B3 배포 미완료. 원본 저장소 태그·Actions 상태 확인
- 미배포 원본을 `bun link` 등으로 임시 연결: 사용자 확인 후에만

## B3. 원본 작업 · npm 배포 (원본 저장소)

공유 스킬 추가·수정:

```text
skills/<name>/SKILL.md (+ scripts/)    프로젝트 고유 정보(계정·채널·경로) 금지. 절차·도구만
이름                                    cg 자체 → 이 스킬에 분기 추가 (cg-* 스킬 분할 금지) · 콘텐츠 작업 → kit-*
.claude-plugin/plugin.json description   새 kit 추가 시 목록 갱신
```

배포 (tag push → GitHub Actions `publish.yml` → npm trusted publishing):

```sh
git status --short                     # 1. 사용자 미커밋 변경은 커밋에서 제외 (경로 지정 add)
bun run check                          # 2. tsc + 테스트
# 3. 버전 올림: package.json · .claude-plugin/plugin.json 동일 버전 (patch: 스킬 추가·수정)
git commit -m "<변경 요약>"             # 4. 변경 커밋 → 버전 커밋 "X.Y.Z" (기존 이력 형식)
git push origin main                   # 5.
git tag vX.Y.Z && git push origin vX.Y.Z   # 6. 태그 = package.json 버전 (불일치 시 workflow 실패)
gh run watch $(gh run list --workflow publish.yml -L1 --json databaseId -q '.[0].databaseId')   # 7.
npm view contents-genesis version      # 8. 반영 확인 → 프로젝트에서 B2
```

- push · 태그 · 배포는 공개 행위 → 계획을 보여주고 확인받은 뒤 실행
- 로컬 `npm publish` 금지. 배포는 태그 workflow 로만 (provenance)
- 배포된 버전 재사용 불가. 실패 후 재배포는 다음 patch 버전

## 규칙

- 구성 변경은 가능한 한 cg 명령으로 (`cg module|pipeline|skill ...`). 직접 편집도 external 로 추적되지만 의도가 남지 않음
- node_modules 안 공유 스킬·기본 모듈 직접 수정 금지. 수정은 원본에서 → B3 → B2
- 변경 후 `bun cg check`
