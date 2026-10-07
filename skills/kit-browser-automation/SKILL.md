---
name: kit-browser-automation
description: "[재사용] ego-browser 자동화 공통 노하우. 어떤 사이트든 브라우저 작업 전에 먼저 읽는다: 스크립트 실행(환경변수·cwd 미전달), 세션 간 TaskSpace 충돌, 사용자 제어 전환, alert/confirm으로 인한 멈춤, iframe 좌표 클릭, 팝업·파일 업로드·blob 저장, 스마트스토어 지연 로딩·Q&A 펼치기, 속도 제한(429)·SPA 대기, 검증 습관. 네이버·ChatGPT에서 검증된 사례 포함."
metadata:
  version: "1.1.0"
---

# 브라우저 자동화 공통 노하우 (재사용 키트) (2026-09-30 ~ 10-01 실전에서 확인)

> 재사용 키트: 사이트별 사례(네이버·ChatGPT)는 실전에서 검증한 **예시**. 다른 사이트에서는 패턴만 가져간다. 스크립트 경로는 각 프로젝트의 `tools/` 기준. 프로젝트 전용 수집 도구 목록은 각 프로젝트 스킬에 둔다.

## 1. ego-browser 스크립트 실행

- `ego-browser nodejs`는 호출 셸의 **환경변수·cwd를 전달받지 않음**
  - 파일 경로는 항상 절대 경로
  - 값 전달은 `.sh` 래퍼가 `Object.assign(process.env, {...})`를 스크립트 앞에 붙여 파이프 (예: cg-seeds `run.ts` collect)
  - heredoc에서 셸 변수를 쓰려면 `<<EOF`(따옴표 없음), JS 템플릿 문자열 `${}`·백틱이 셸에 먹히지 않게 주의. 백틱이 들어간 python/markdown 편집은 `<<'EOF'`로
- TaskSpace는 작업 목표당 1개. 스페이스 번호를 기록하고 이후 `taskSpace(<id>)`로 재사용
- `task.finish()`가 가끔 오래 걸림 → 백그라운드 타임아웃 나도 결과물(파일·설정)은 이미 저장됨. 재시도 불필요
- 스냅샷 ref(`@N`)는 `ego-browser nodejs` 프로세스마다 무효 → 같은 스크립트 안에서 `snapshot()` 후 클릭 (2026-10-04). 접힌 목록(스마트스토어 Q&A `더보기`, oopy·노션 FAQ 토글)은 `snapshot({scope:"full_page"})`로 버튼 ref를 찾거나 `page.click('text="<질문>"')`
- 다른 세션·사용자가 닫은 탭은 `page pN was closed` → 열려 있는 탭(p1 등)을 쓴다 (2026-10-04)
- **같은 TaskSpace를 다른 세션이 조작하면 충돌** (2026-10-05): 내 `p1`이 다른 세션 작업 URL로 바뀌고, 수집 스크립트가 `CDP Input.dispatchMouseEvent timed out`·`No resource with given identifier`로 두 번 실패, 이후 `task space not found: 39`(다른 세션이 닫음). 스페이스 번호는 세션 간 공유 금지. 실행 전 `task.tabs()`로 `p1` URL이 내 것인지 확인, 다른 세션 스크립트(`ps` 의 `ego-browser nodejs`)가 돌 때는 끝난 뒤 실행. 스페이스가 사라진 경우에만 새로 만들고 id를 기록. 2026-10-07: 여러 세션 동시 실행 중 이름 붙인 스페이스가 생성 도중 두 번 사라짐 → 긴 일괄 작업은 단위마다 새 스페이스를 만들고 실패 시 1회 재시도
- 백그라운드 `( a; b ) &` 서브셸은 바깥 명령의 완료 알림이 먼저 옴 → 실제 완료는 로그 파일 끝 줄(`=== done` 등)로 확인. 로그가 비어 있어도 죽은 게 아님(수집 스크립트는 끝에 한 번 출력) → 재실행 전 `ps aux | grep <스크립트명>`으로 확인. 같은 TaskSpace에서 두 프로세스가 돌면 약 40분 낭비 (2026-10-05 후기 수집)

## 2. 사용자 제어 전환

- 사용자가 브라우저를 잡으면 `The user has taken control` 오류 → **즉시 중단**, 사용자에게 알리고 대기
- 사용자가 "계속/ㄱㄱ/ㅇㅇ" 등으로 진행을 지시하면 `takeOverTaskSpace(<id>)` 후 재개
- 재개 직후 현재 상태를 먼저 읽는다 (사용자가 내용을 바꿨을 수 있음)
- 로그인 필요 시 로그인 페이지를 연 뒤 `task.handOff()` → 사용자 로그인 → 재개
- 사용자에게 넘기는 화면은 번호로 안내하지 않는다: 사용자는 TaskSpace 번호를 볼 수 없음 (2026-10-05 사용자 지적). `taskSpace("<작업 이름>")`처럼 이름을 붙여 새로 만들고 이름·사이트로 안내

## 3. 대화상자 (alert/confirm)

- 네이버 관리 화면은 confirm/alert를 자주 띄움 (레이아웃 변경, 스킨 적용, 삭제 확인, 입력값 경고)
- 대화상자가 떠 있으면 이후 모든 명령이 `CdpRequestTimeoutError`로 멈춤 → `page.acceptDialog()`(또는 `dismissDialog()`)로 복구
- 클릭 후 `const i = await page.info(); if (i.dialog) await page.acceptDialog();` 패턴을 습관화. `i.dialog.message`를 로그로 남겨 의미 확인

## 4. iframe과 좌표

- 블로그 에디터(`#mainFrame`), 블로그 관리 화면, 스마트스토어 일부가 iframe
- `page.fill`/`page.click`(셀렉터)은 프레임을 자동 탐색하지만, **보이지 않는 요소·커스텀 체크박스·드롭다운 옵션은 실패**가 잦음
- 안정적인 방법: `iframe.contentDocument`에서 요소를 찾아 `scrollIntoView` → `iframe rect + 요소 rect`로 좌표 계산 → `page.mouse.click`
- 좌표 클릭도 안 먹는 요소(커스텀 radio/checkbox): 요소에 대해 `element.click()`을 페이지 안에서 실행
- 저장 버튼은 화면 밖이면 클릭이 무시될 수 있음 → 스크롤 후 좌표 클릭, 저장 후 새로고침으로 반영 확인

## 5. 팝업·파일

- 새 창(프로필 이미지 업로드 등): `const p = page.waitForEvent("popup")`를 클릭 전에 걸고, 셀렉터 클릭으로 안 뜨면 좌표 클릭
- 파일 선택: `input[type=file]`에 `setInputFiles`(숨김 input 가능) 또는 `waitForFileChooser` + `chooser.setFiles`
- 네이버 업로드는 **영문 파일명** 권장(한글 파일명은 이미지 깨질 수 있다는 안내)
- 외부 이미지 저장: `page.fetch`는 CORS로 실패하는 경우 많음 → `curl -H "Referer: <원 사이트>"`
- `blob:` 이미지(ChatGPT 생성물)는 페이지 안에서 `fetch(blob)` → base64 → Node에서 파일 저장
- 이미지 확인은 `sips -Z 500 in --out out` 축소 후 Read (PIL 없음), 형식 변환 `sips -s format jpeg`
- 스마트스토어 상세 이미지는 지연 로딩: `src`가 1px `data:image` 이면 `data-src`(`shop-phinf...?type=w848`)를 `curl -H "Referer: https://brand.naver.com/"`으로 받음. 인증서·반품 안내 이미지에 정책·수치가 있어 텍스트가 있는 이미지는 모두 열람 (2026-10-05: 시험성적서, 제공고시와 다른 반품 안내). GIF는 `ffmpeg -vf "fps=1,scale=350:-1,tile=4x3"`으로 프레임 모음 이미지 생성
- 스마트스토어 Q&A 답변 펼치기 (2026-10-05): 인라인 목록(3건)과 `Q&A 전체보기` 다이얼로그가 같은 질문을 중복 → `[role=dialog] li`로 한정(52건이 한 번에 로드). 항목은 `scrollIntoView` + 400ms 대기 후 anchor 좌표로 `page.mouse.click` (페이지 안 `element.click()`·`text=` 클릭은 중복 요소 오류), 펼침 상태는 항목 텍스트의 `접기`(열림)/`더보기`(닫힘). 열린 상태에서 `page.keyboard.press("Escape")`
- 네이버 쇼핑 CDN `shop-phinf.pstatic.net/...?type=w500`은 0바이트일 수 있음 → `type=o1000`. 스마트스토어 상세 이미지는 `상세정보 펼쳐보기` 클릭 후 `#INTRODUCE` 안 img (2026-10-04)
- `sips -c <h> <w> --cropOffset <y> 0`에서 `y+h`가 이미지 끝 이상이면 원본 전체가 나옴 → 마지막 조각은 끝보다 안쪽 offset으로 (2026-10-04)

## 6. 속도 제한·SPA

- 스마트스토어 리뷰 API 직접 호출 → 429. 화면 조작 + CDP `Network.getResponseBody`로 페이지가 받은 응답 수집
- 모달 뒤 본문에 같은 텍스트가 있으면 `page.click('text=..')`가 `dialog ... intercepts pointer events`로 실패 (스마트스토어 리뷰 정렬 `button[role=radio]`, 2026-10-01) → 페이지 안에서 보이는 마지막 요소 `element.click()`
- 데이터랩 API 연속 호출 → 빈 응답. 1.2초 간격 + 재시도
- 브랜드 커넥트 검색 같은 SPA는 이전 결과가 남아 있음 → 새 결과의 식별 텍스트(`'<검색어>' 검색 결과`)가 뜰 때까지 대기
- 네이버 블로그 PC 글(`PostView`)은 evaluate가 멈출 때가 있음 → 모바일 `m.blog.naver.com/<id>/<logNo>`

## 7. 검증 습관

- 모든 설정 변경 후: 저장 → 새로고침 → 값 읽기 → 스크린샷
- 자동 입력 결과는 DOM 요약(개수·상태 클래스)으로 확인하고, 사람 눈 기준 문제(굵게 번짐, 줄바꿈)는 스크린샷으로 확인
- DOM 클래스가 상태를 나타내는지 먼저 확인 (예: 에디터 굵게 `se-is-selected`, AI 표시 `se-is-selected`)
