---
name: cg-context
description: "contents-genesis(cg) 자체에 관한 단일 스킬. 'cg' = contents-genesis (npm 패키지 contents-genesis, 원본 저장소 github.com/obov/contents-genesis, 로컬 원본 ../contents-genesis). 분기: (1) 프로젝트 구성·커스텀·변경 이력 조회 (2) cg 버전 갱신·공유 스킬 받기 (3) 원본 저장소에서 공유 스킬 추가·수정·npm 배포 (4) 버전업 없이 이 머신의 로컬 레지스트리(~/.cg/skills)로 프로젝트 간 스킬 공유 (5) 공용 모듈(cg-* 저장소) 태그 의존 · 개발 모드(bun link) · 모듈 릴리스 · 데이터 홈(~/.cg/data). \"모듈 뭐 있어\", \"pipeline 구성\", \"커스텀한 거\", \"최근 변경\", \"production 어떻게 돌려\", \"cg 받아줘\", \"cg 최신화\", \"0.4.x로 스킬 공유했어\", \"<스킬명> 받아줘\", \"cg에 스킬 추가\", \"스킬 공유해줘\", \"cg 배포\", \"npm 배포\", \"버전 올려줘\", \"로컬 스킬 공유\", \"프로젝트 간 스킬 공유\", \"이 스킬 다른 프로젝트에서도 쓰게\", \"local:<스킬명>\", \"skill publish\", \"모듈 태그\", \"모듈 버전 올려\", \"모듈 고치면서 테스트\", \"bun link\", \"link: 로 연결\", \"공용 모듈 받기\", \"데이터 홈\", \"모듈 데이터 어디\" 요청. 콘텐츠 작업 스킬(kit-*)과 별개."
metadata:
  version: "1.3.0"
---

# cg (contents-genesis)

## 용어

```text
cg              contents-genesis. 프로젝트 기반 프레임워크 + CLI (bun cg ...)
원본 저장소      github.com/obov/contents-genesis. 로컬 ../contents-genesis (있을 때)
cg 프로젝트      project.json 이 있는 저장소. contents-genesis 를 npm 의존성으로 사용
공유 스킬        원본 skills/<name>. 프로젝트 .agents/skills/<name> 에 symlink
로컬 스킬        로컬 레지스트리 ~/.cg/skills/<name> (CG_SKILLS_HOME). project.json 에 local:<name>. npm 배포 없음. 사용자 취향에 맞춘 스킬
공용 모듈        cg-<id> 저장소 (module.json). 프로젝트는 GitHub 태그로 설치 (B5)
데이터 홈        ~/.cg/data/<모듈 id> (CG_DATA_HOME). 모듈이 쓰는 사용자 데이터. 모듈 폴더(재설치 때 지워짐)에 두지 않음
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
cg 프로젝트                       프로젝트 간 스킬 공유 (버전업 없이)  B4 로컬 레지스트리

cg 프로젝트 · cg-* 모듈 저장소      모듈 받기 · 수정 · 버전 · 데이터    B5 공용 모듈

공유 경로 선택: 이 머신의 프로젝트끼리만 → B4 · 다른 사람·다른 머신·모든 cg 사용자 → B3
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
스킬 버전                               frontmatter metadata.version. 스킬 파일 변경 시 해당 스킬만 올림 (patch 수정 · minor 기능 추가 · major 사용법 변경)
모듈 버전                               modules/<id>/module.json version. 모듈 파일 변경 시 해당 모듈만 올림
이름                                    cg 자체 → 이 스킬에 분기 추가 (cg-* 스킬 분할 금지) · 콘텐츠 작업 → kit-*
.claude-plugin/plugin.json description   새 kit 추가 시 목록 갱신
```

배포 (tag push → GitHub Actions `publish.yml` → npm trusted publishing):

```sh
git status --short                     # 1. 사용자 미커밋 변경은 커밋에서 제외 (경로 지정 add)
bun run check                          # 2. tsc + 개별 버전 검사(check:versions) + 테스트
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

## B4. 로컬 레지스트리 공유 (버전업 없음, cg 프로젝트)

```sh
bun cg skill publish <name>        # 프로젝트 소유 .agents/skills/<name> → ~/.cg/skills/<name> 이동 + local:<name> 연결
bun cg skill list                  # local(연결됨) · available_local(레지스트리에 있고 미연결) · registry(경로)
bun cg skill add local:<name>      # 다른 프로젝트에서 연결 (project.json skills + 절대경로 symlink)
bun cg skill remove local:<name>   # 연결 해제 (레지스트리 원본 유지)
bun cg check                       # missing_local_skills: 이 머신 레지스트리에 없는 local 스킬
```

- 수정은 `~/.cg/skills/<name>` 에서 (연결된 모든 프로젝트 즉시 반영)
- publish 대상: symlink 아닌 프로젝트 소유 스킬만. 레지스트리에 같은 이름이 있으면 거부 → 기존 것을 `add local:<name>` 로 쓸지 사용자 확인
- 같은 이름의 패키지 공유 스킬이 연결돼 있으면 거부 → `skill remove <name>` 후 재시도
- 다른 머신 클론: `cg skill link` 결과 `missing` 에 표시 (실패 아님). 레지스트리에 스킬 복사 후 `cg skill link`
- 모든 cg 사용자에게 배포하려면 원본 `skills/<name>` 으로 옮겨 B3
- 버전 · 백업 (cg-backup 0.2+): 모든 로컬 스킬은 SKILL.md `metadata.version` 필수, 수정하면 버전 올림. 백업 브랜치 `skills/local` + 태그 `skills/<name>@<버전>`. 위반은 `bun cg run backup skills-check` (세션 시작 hook 은 `check --brief`)
- 모듈 저장소 안 스킬(`<모듈>/skills/kit-*`)을 레지스트리에 연결할 때는 symlink (내용 · 이력은 모듈 저장소)
- 같은 스킬을 패키지(`skills/`)와 모듈 저장소 두 곳에 두지 않음. 모듈 명령과 묶인 kit 은 모듈 저장소가 원본 (예: kit-youtube-upload = cg-release, 0.4.11 에서 패키지에서 제거 → `local:kit-youtube-upload`)
- 프로젝트에 공유 스킬을 복사해 고치지 않음. 노하우는 원본(B3)으로 올리고 프로젝트 전용 부분(도구 경로 등)만 프로젝트 스킬에

## B5. 공용 모듈 (cg-* 저장소)

의존 방식: 평소 = GitHub 태그, 모듈 코드를 고치는 동안만 = 로컬 링크.

```text
package.json   "cg-<id>": "git+ssh://git@github.com/<owner>/cg-<id>.git#v<버전>"
               private 저장소: github: · https 형식은 bun 이 API tarball 로 받아 404 → git+ssh 만
project.json   modules 에 패키지 이름 ("cg-<id>"). 절대경로 · ../ 경로 금지
금지           link: · file: · 절대경로를 package.json / project.json 에 커밋
```

개발 모드 (package.json 은 그대로):

```sh
cd ../cg-<id> && bun link            # 1. 한 번 (전역 링크 등록)
cd <project> && bun link cg-<id>     # 2. node_modules/cg-<id> → 로컬 원본 링크. package.json 변경 없음
# 수정 · 검증
bun install                          # 3. 끝나면 태그 버전으로 복귀 (릴리스 후 태그 갱신)
```

릴리스 (모듈 저장소):

```sh
bun run check                                     # 1.
# 2. package.json · module.json version 같이 올림 (patch 수정 · minor 기능 · major 사용법 변경)
git commit -m "<변경 요약> (X.Y.Z)" && git push   # 3.
git tag -a vX.Y.Z -m "cg-<id> vX.Y.Z" && git push origin vX.Y.Z   # 4. 태그 = package.json 버전
# 5. 쓰는 프로젝트마다: package.json 태그 갱신 → bun install → bun run check → 커밋
```

- 새 태그를 bun 이 못 찾음 (`no commit matching "vX.Y.Z"`): bun git 캐시가 이전 clone → `~/.bun/install/cache/*.git` 중 그 저장소 것을 지우고 `bun install`
- package.json `files` 에 런타임에 필요한 경로 포함 (태그 설치는 files 기준)
- React · Remotion 을 peer 로 쓰는 모듈(cg-remotion-kit 등): 프로젝트 renderer 가 자기 node_modules 한 벌만 쓰게 tsconfig `paths` + remotion.config `resolve.modules` 에 renderer/node_modules 우선

데이터 홈 (모듈이 사용자 데이터를 쓸 때):

```text
위치     CG_DATA_HOME ?? ~/.cg/data  +  /<모듈 id>   (모듈 코드가 직접 계산. 모듈 폴더 · import.meta.dir 아래 쓰기 금지)
백업     module.json "backup": { "home": true }  → cg-backup 이 브랜치 module/<모듈 id> 로 주기 백업
복원     bun cg run backup restore-module <모듈 id> ~/.cg/data/<모듈 id>
기록     데이터 홈(~/.cg/data)을 git 저장소로 두고(private 원격) 바꾼 작업 안에서 이유를 적어 커밋 · push
         "<모듈 폴더>: <변경> (<이유 · 근거>)". 자동 백업은 안전망 (이유 없음)
검사     bun cg run backup check --brief   (세션 시작 hook: 로컬 스킬 버전 위반 + 데이터 홈 미커밋 · 미push)
```

## 규칙

- 구성 변경은 가능한 한 cg 명령으로 (`cg module|pipeline|skill ...`). 직접 편집도 external 로 추적되지만 의도가 남지 않음
- node_modules 안 공유 스킬·기본 모듈·공용 모듈 직접 수정 금지. 수정은 원본에서 → B3 → B2 (공용 모듈은 B5)
- 변경 후 `bun cg check`
