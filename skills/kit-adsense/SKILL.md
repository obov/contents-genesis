---
name: kit-adsense
description: "[재사용] Google AdSense 운영 키트. 신청 전 준비 점검 → 신청 · 결과 기록 → 거절 대응 → 승인 후 광고 · ads.txt 설정 → 수익 정기 기록. 기록은 기본 모듈 @cg/adsense (cg run adsense). Blogger 기준 절차 + 일반 사이트 공통. 블로그 글 소재 · 맥락 · 구성 가이드 포함. \"애드센스 신청\", \"애드센스 승인 준비\", \"애드센스 거절\", \"애드센스 수익 기록\", \"광고 설정\", \"ads.txt\", \"블로그 구성\", \"어떤 글 써야 해\" 요청."
metadata:
  version: "1.0.0"
---

# AdSense 운영 (재사용 키트)

> 절차와 기록 규칙만 담는다. 사이트 URL · 계정 · 글 경로는 프로젝트 스킬 또는 기록(`adsense.site`)에 둔다.
> 화면 조작이 필요하면 환경의 `ego-browser` 스킬 규칙을 따른다. 로그인 · 결제 정보 · 전화 인증은 사용자가 직접.
> 정책 근거: 2026-10 조사 기준. 정책 문구가 바뀌었을 수 있으므로 신청 · 거절 대응 전에 공식 문서 재확인 (출처는 `references/sources.md`).

## 준비

```sh
cg module add adsense            # 기본 모듈 (opt-in, init 기본값에는 없음). publication 의존성 자동 추가
cg run adsense help
```

| 명령 | 용도 |
|---|---|
| `cg run adsense checklist` | 점검 항목 code · 필수 여부 · 확인 방법 |
| `cg run adsense site <url> --platform P --status S [--reason T]` | 사이트 등록 · 상태 갱신. status: preparing · submitted · approved · rejected · limited · disabled |
| `cg run adsense readiness <url> <file.json>` | 점검 결과 기록. 필수 항목 전부 pass 일 때만 verdict = ready |
| `cg run adsense earnings <url> <file.json>` | 기간별 수익 기록 (객체 또는 배열) |
| `cg run adsense status [url]` | 상태 · 최근 점검 blocking 항목 · 통화별 수익 합계 |

기록은 cg 레코드 (`adsense.site` · `adsense.readiness` · `adsense.earnings`). 상태 변경은 같은 site 레코드의 새 revision 으로 남는다.

## 분기

```text
요청                                  분기
신청 준비 · 승인 가능한지              A 준비 점검
신청 · 결과 나옴                       B 신청 · 결과
거절됨 · 가치가 낮은 콘텐츠            C 거절 대응
승인됨 · 광고 넣기 · ads.txt           D 승인 후 설정
수익 확인 · 기록 · 추이                E 수익 기록
글 소재 · 맥락 · 블로그 구성            references/content.md
```

## A. 준비 점검

1. `cg run adsense site <url> --platform <blogger|wordpress|...> --status preparing` (최초 1회)
2. `cg run adsense checklist` 항목마다 실제 사이트를 확인. 추측으로 pass 금지
   - 공개 글 수 · 분량: 사이트 공개 화면 또는 sitemap 으로 집계
   - 필수 페이지: 실제 URL 접근 확인. 페이지 내용은 `references/pages.md`
   - 탐색 구조: 메뉴 링크 · 라벨(카테고리) 페이지 전부 열어 빈 페이지 · 깨진 링크 확인
3. 결과 파일 작성 → `cg run adsense readiness <url> <file.json>`

```json
{ "checks": [
  { "code": "post_volume", "status": "fail", "note": "공개 글 7편" },
  { "code": "privacy_page", "status": "pass", "note": "/p/privacy.html" }
] }
```

4. 보고: verdict · blocking 항목 · 항목별 다음 행동. 누락 code 는 fail 로 취급됨

## B. 신청 · 결과

신청은 사용자 승인 후. 사용자 대신 약관 동의 · 결제 정보 입력 금지.

- Blogger: 대시보드 → 수입 → 애드센스 계정 만들기 → 양식 · 결제 정보 · 전화 인증 → 제출 → Blogger 로 복귀
- 일반 사이트: adsense.google.com → 시작하기 → 사이트 URL → 확인 코드(또는 ads.txt) 삽입 → 검토 요청
- 제출 직후: `cg run adsense site <url> --status submitted`
- 결과 수신: `--status approved` 또는 `--status rejected --reason "<메일 · 화면의 사유 원문>"`
- 심사 기간은 며칠 ~ 수 주. 대기 중 신규 글 발행 · 품질 보강은 계속

## C. 거절 대응

1. 사유 원문을 `--reason` 으로 기록 (B)
2. 사유별 점검 (A 재실행)
   - 가치가 낮은 콘텐츠: 얇은 글 보강 또는 비공개, 중복 · 요약성 글 정리, 글 수 확대, 빈 라벨 제거
   - 사이트 접근 불가 · 도메인 문제: 공개 상태 · 리디렉션 · 커스텀 도메인 DNS 확인
   - 정책 위반: 해당 글 수정 · 삭제
3. 수정 내역 정리 후 사용자 승인 받아 재신청 → `--status submitted`
4. 같은 상태로 즉시 재신청 금지. 변경 근거 없이 반복 신청은 결과 동일

## D. 승인 후 설정

- 광고 배치 (Blogger): 레이아웃 → 블로그 게시물 수정 → "게시물 사이에 광고 게재" · 사이드바 가젯 "애드센스". 일반 사이트: 자동 광고부터 시작
- ads.txt: Blogger 기본 연동이면 자동. 타사 광고 · 수동 연동이면 설정 → 수익 창출 → 맞춤 ads.txt. 커스텀 도메인이 하위 도메인(blog.example.com)이면 루트 도메인 ads.txt 도 확인
- Search Console: 속성 등록 · `/sitemap.xml` 제출 (Blogger 는 `/feeds/posts/default?alt=rss` 도 함께)
- 무효 트래픽 방지: 본인 광고 클릭 금지, 클릭 유도 문구 금지, 광고를 콘텐츠 · 버튼으로 오인하게 배치 금지

## E. 수익 기록 (정기)

주기는 프로젝트가 정함 (권장: 월 1회, 월초에 전월). 같은 기간 중복 기록 금지 → 기록 전 `cg run adsense status` 의 `last_period_end` 확인.

1. 원자료: AdSense 보고서 (날짜 범위 · 사이트 기준) 또는 Blogger 수입 탭. 화면 수치를 그대로 옮기고 계산값은 별도 표기
2. 파일 작성 → `cg run adsense earnings <url> <file.json>`

```json
[{ "period_start": "2026-11-01", "period_end": "2026-11-30", "currency": "USD",
   "estimated_earnings": 12.34, "page_views": 5400, "impressions": 9800, "clicks": 41,
   "page_rpm": 2.28, "ctr": 0.76, "cpc": 0.30, "source": "adsense-ui" }]
```

3. 페이지 단위 수익이 필요하면 earnings 레코드와 `publication.item` 사이 `adsense.earned_on` 관계를 추가 (`cg write`)
4. 보고: 기간 수익 · 전 기간 대비 증감 · RPM 변화. 원인 추정은 추정으로 표기

## 금지

- 광고 클릭 · 클릭 유도 · 트래픽 구매
- 확인하지 않은 항목 pass 기록, 화면에 없는 수익 수치 기록
- 사용자 승인 없는 신청 · 재신청 · 결제 정보 입력
