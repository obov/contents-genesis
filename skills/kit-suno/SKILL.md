---
name: kit-suno
description: "[재사용] ego-browser로 suno.com에서 곡을 생성·다운로드하고 크레딧·다운로드 잔량을 확인하는 키트. 공식 API 없음(2026-10 기준) → 웹 자동화. \"노래 만들어줘\", \"곡 생성\", \"suno\", \"음원 다운로드\", \"크레딧 얼마 남았어\" 요청. 도구 scripts/generate.mjs."
---

# Suno 생성·다운로드 (재사용 키트)

> 실전 검증 절차 모음 (2026-10-01, Pro 플랜). 계정·채널·저장 경로는 각 프로젝트 스킬에 둔다.
> 브라우저 공통 함정은 `kit-browser-automation`을 먼저 읽는다.
> 실행 조건: ego-browser 설치, ego-browser에서 suno.com 로그인. 스킬 설치만으로는 동작하지 않음

## 도구

스킬 폴더의 `scripts/` (프로젝트에서는 `.agents/skills/kit-suno/scripts/`). 경로는 모두 절대 경로.
`sh scripts/run.sh <script.mjs> '<ENV_JSON>'` 형태로 실행 (ego-browser nodejs는 셸 env를 받지 않음 → JSON 주입).

| 스크립트 | env | 결과 (OUT JSON) |
|---|---|---|
| `generate.mjs` | `SPEC`(JSON), `OUT`, `SPACE?`, `PAGE?` | 1회 생성(2곡). 폼 실제 값, 고급 설정, 곡 ID·길이·커버 URL, 사용 크레딧 |
| `download.mjs` | `SUNO_ID`, `FILE`(.mp3), `OUT`, `SPACE?`, `PAGE?` | mp3 저장, 남은 다운로드 수. **월 다운로드 1 차감** |
| `status.mjs` | `OUT`, `SPACE?`, `PAGE?` | 로그인 여부, 크레딧, 다운로드 잔량, 다음 결제일 |

- `SPACE`: ego-browser TaskSpace 번호. 없으면 새로 생성하고 결과의 `space`로 반환 → 재사용
- `PAGE`: 사용할 페이지 라벨 (기본 `p1`)

### SPEC

```json
{ "model": "v6", "title": "...", "style": "...", "lyrics": "", "settings": { "weirdness": 40 } }
```

- `model`: `v6`, `v6-wild` (Pro 이상), `v6-mini` (무료)
- `style` 최대 1000자, `lyrics` 최대 5000자. `lyrics` 비우면 인스트루멘털
- `settings`: `vocal_gender`(Male|Female), `duration`(Auto|Custom), `max_mode`(Off|On), `my_taste`(Off|On), `weirdness`·`style_influence`(0-100, 기본 50), `variety`(0-4, 기본 1)
- 입력 후 화면 값을 다시 읽어 SPEC과 다르면 생성 전에 중단

## 플랜 (KRW, 2026-10)

| 플랜 | 크레딧 | 다운로드 | 상업적 이용 | 모델 |
|---|---|---|---|---|
| Free | 50/일 | 0 | 불가 | v6-mini |
| Pro | 2,500/월 | 20곡/월 | 가능 | v6, v6-wild |
| Premier | 10,000/월 | 60곡/월 | 가능 | v6, v6-wild |

- 1회 생성 = 2곡, v6-mini 약 10 크레딧
- 무료 플랜에서 만든 곡은 이후 구독해도 상업적 이용 불가로 간주 (업로드용은 유료 플랜에서 새로 생성)
- 다운로드 수가 병목 → 생성 후 들어보고 고른 곡만 다운로드. 재생: `https://suno.com/song/<SUNO_ID>`
- 오디오 스트림 URL 직접 저장 등 다운로드 제한 우회 금지

## 화면 노하우

- 결제·플랜 변경 직후 생성 화면이 이전 플랜으로 동작할 수 있음 (v6 선택 시 업그레이드 창, Create 무반응·크레딧 미차감) → 로그아웃 후 재로그인
- 쿠키 배너가 Create 버튼을 가림 → 사용자 선택 필요. 선택 쿠키 거부(Reject All)로 닫아도 동작
- Simple/Advanced 양쪽 입력이 DOM에 공존 → `checkVisibility()`로 보이는 요소만 선택
- 모델 버튼: 텍스트가 `v6`류인 버튼 → `role=menuitemradio`. 막힌 모델은 `.modal-overlay` 업그레이드 창
- 가사: `contenteditable[aria-label="Lyrics editor"]`, 스타일 `textarea[maxlength=1000]`, 제목 `input[placeholder="Song Title (Optional)"]`
- More Options 토글 `div[role=button][aria-expanded]`. 버튼 그룹 `data-selected`, 슬라이더 `role=slider aria-valuenow` (방향키로 조정)
- 새 곡: 목록 상단 `a[href^="/song/<id>"]` 2개 추가. 완료 = 행에 m:ss 길이 표시. v6-mini 약 1~2분
- 계정 페이지 `/account`: "Credits Remaining", "Downloads Remaining"
- 다운로드 메뉴(곡 ⋯ → Download)의 Pro 형식 선택·확인 창: 미검증. `download.mjs` 첫 실행에서 화면을 단계별로 확인하고 이 절 갱신
