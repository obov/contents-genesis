---
name: kit-cloudflare-tunnel
description: "[재사용] Cloudflare Tunnel로 로컬 서비스를 도메인에 공개하고 Cloudflare Access(Zero Trust)로 이메일 기반 로그인 보호를 거는 키트. \"터널 열어줘\", \"로컬 서버 외부 공개\", \"cloudflared\", \"도메인 연결\", \"Access 걸어줘\", \"나만 접속하게\", \"접근 제한\", \"임시 공유 URL\" 요청. 도구 scripts/tunnel.mjs, scripts/access.mjs."
metadata:
  version: "1.0.0"
---

# Cloudflare Tunnel + Access (재사용 키트)

> 계정·도메인·허용 이메일은 각 프로젝트 기록에 둔다. 이 키트는 절차와 도구만.
> 실행 조건: `cloudflared` 설치(`brew install cloudflared`), `cloudflared tunnel login` 완료(`~/.cloudflared/cert.pem`), 대상 도메인이 Cloudflare zone. Access는 추가로 API 토큰

## 도구

스킬 폴더의 `scripts/` (프로젝트에서는 `.agents/skills/kit-cloudflare-tunnel/scripts/`). `node scripts/<file>.mjs ...`. 의존성 없음 (Node 18+).

| 명령 | 동작 |
|---|---|
| `tunnel.mjs list` | 터널 목록, 연결 수, 설정 파일, 호스트 → 서비스 |
| `tunnel.mjs up <tunnel> <host> <service> [--overwrite-dns]` | 터널 없으면 생성 → DNS CNAME → ingress 추가/교체 → `ingress validate` |
| `tunnel.mjs remove <tunnel> <host>` | ingress에서 제거 (DNS 레코드 유지) |
| `tunnel.mjs run <tunnel>` | 포그라운드 실행 |
| `tunnel.mjs config <tunnel>` | 설정 경로·내용 |
| `access.mjs list` | Access 앱 목록 |
| `access.mjs protect <host> <email\|@domain>[,...] [--session=24h] [--name=]` | self-hosted 앱 + allow 정책 생성. 같은 호스트 앱이 있으면 갱신 |
| `access.mjs unprotect <host>` | Access 앱 삭제. **호스트가 즉시 공개 상태** → 사용자 요청 시에만 |
| `access.mjs check <host>` | 미인증 요청이 `*.cloudflareaccess.com`으로 가는지 확인. 토큰 불필요. 보호 안 됨 → exit 2 |

- 설정 파일: `~/.cloudflared/<tunnel>.yml`. JSON 형식으로 저장 (YAML 상위집합, cloudflared 그대로 인식). 직접 작성한 YAML 설정이면 스크립트가 중단 → 수동 편집
- `service` 예: `http://localhost:3000`, `https://localhost:8443`, `ssh://localhost:22`, `tcp://localhost:5432`

## 표준 절차 (비공개 공개)

순서 중요: **Access 먼저, 터널 실행 나중.** 반대로 하면 보호 전 공개 구간 발생.

1. 대상 확인: 호스트명(zone 하위), 로컬 서비스 URL, 허용 이메일/도메인. 하나라도 없으면 사용자에게 확인
2. 로컬 서비스 응답 확인 (`curl -sI <service>`)
3. `node access.mjs protect <host> <emails>` (CNAME 생성 전에도 앱 생성 가능)
4. `node tunnel.mjs up <tunnel> <host> <service>`
5. `node tunnel.mjs run <tunnel>` 백그라운드 실행 (Bash `run_in_background`)
6. `node access.mjs check <host>` → `protected: true` 확인. 이후 사용자 브라우저에서 로그인(이메일 OTP) 확인 요청
7. 보고: 호스트, 서비스, 허용 대상, 세션 시간, 터널 실행 방식(포그라운드/상시)

## API 토큰 (Access)

- `wrangler login` OAuth 토큰에는 Access 권한 없음 → 별도 API 토큰 필요
- 생성: 대시보드 → 내 프로필 → API 토큰 → 사용자 설정 토큰. 권한 `계정 / Access: 앱 및 정책 / 편집`, 터널 상태 조회용 `계정 / Cloudflare One 커넥터: cloudflared / 읽기`. 계정 리소스는 대상 계정 1개로 제한
- 토큰 값은 생성 화면에서 1회만 표시 → 출력하지 말고 바로 키체인 저장: `security add-generic-password -U -a <user> -s cloudflare-api-token -w <token>`
- 주입: `export CLOUDFLARE_API_TOKEN=$(security find-generic-password -s cloudflare-api-token -w)`
- `CLOUDFLARE_ACCOUNT_ID` 필수 취급: 위 권한만으로는 `/accounts`가 빈 목록 → 자동 조회 실패. 대시보드 URL `dash.cloudflare.com/<id>` 또는 터널 토큰(base64 JSON)의 `a`
- 토큰을 파일·커밋·로그에 남기지 않음
- Zero Trust 미가입 계정이면 첫 API 호출 실패 → 대시보드 Zero Trust에서 팀 이름 생성(Free 플랜 50명) 후 재시도

## 임시 공유 (Access 없음)

`cloudflared tunnel --url http://localhost:3000` → `https://<random>.trycloudflare.com`. 계정 불필요, 누구나 접근 가능, 재시작마다 URL 변경. 민감한 내용이면 사용 금지 → 표준 절차

## 상시 실행 (macOS)

- `sudo cloudflared service install`은 `/etc/cloudflared/config.yml` 단일 설정 기준 → 기존 설정과 충돌 주의, 사용자 승인 후
- 대안: launchd 사용자 에이전트에 `cloudflared tunnel --config ~/.cloudflared/<tunnel>.yml run <tunnel>` 등록

## 주의

- 한 터널에 여러 호스트 가능. 새 서비스마다 터널을 만들지 말고 기존 터널에 `up`으로 추가
- `up`의 DNS 단계는 기존 레코드가 있으면 실패. 덮어쓰기(`--overwrite-dns`)는 기존 레코드 용도를 확인한 뒤에만
- 다른 기기에서 만든 터널은 자격 증명(`<id>.json`)이 없어 실행 불가 → 새 터널 또는 대시보드 토큰 방식
- ingress 변경은 실행 중 터널에 자동 반영 안 됨 → 재시작
- Access 정책 `include` 규칙: `a@x.com` → email, `@x.com` → email_domain. 여러 개는 쉼표 (OR)
- 상태 구분: DNS 생성, ingress 등록, 터널 연결(`list`의 connections > 0), Access 보호(`check`)는 각각 별개. 하나만 확인하고 완료 보고 금지

## 검증 상태 (2026-10-01)

- 확인: `tunnel.mjs list/config`, JSON 설정의 `cloudflared ingress validate`·`ingress rule` 매칭, `access.mjs check`·`list` (cloudflared 2026.8.2), 대시보드 토큰 생성 절차
- 터널 관리 방식 확인: `GET /accounts/<acct>/cfd_tunnel/<id>`의 `config_src` (`local`이면 로컬 설정 파일 사용 → `tunnel.mjs` 적용 가능, `cloudflare`면 대시보드 ingress 우선)
- 미검증: 실제 `up`(터널 생성·DNS), `access.mjs protect/unprotect` 쓰기 호출. 첫 실사용에서 확인 후 이 절 갱신
