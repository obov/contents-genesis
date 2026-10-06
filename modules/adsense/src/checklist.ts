/**
 * AdSense application readiness checks. Codes are stable: readiness records
 * and the kit-adsense skill refer to them. `required` checks gate the verdict.
 * Official sources: AdSense eligibility (support.google.com/adsense/answer/9724),
 * program policies, Search Central "creating helpful content".
 */
export type Check = {
  code: string;
  required: boolean;
  title: string;
  how: string;
};

export const CHECKS: Check[] = [
  {
    code: "owner_eligible",
    required: true,
    title: "신청자 자격",
    how: "국가별 최소 나이 (한국 만 19세) · 사이트 실소유 또는 HTML 편집 권한",
  },
  {
    code: "site_public",
    required: true,
    title: "사이트 공개",
    how: "비밀번호 · 비공개 · 공사 중 페이지 없음. 심사자가 실제 방문",
  },
  {
    code: "original_content",
    required: true,
    title: "독창 콘텐츠",
    how: "복사 · 스크랩 · 대량 자동 생성 글 없음. 상위 검색 결과 요약 이상의 분석",
  },
  {
    code: "policy_clean",
    required: true,
    title: "금지 콘텐츠 없음",
    how: "성인 · 도박 · 저작권 침해 · 혐오 · 위험 상품 · 허위 정보 없음",
  },
  {
    code: "post_volume",
    required: true,
    title: "공개 글 수",
    how: "공식 최소 없음. 경험상 20 ~ 30편 권장",
  },
  {
    code: "post_depth",
    required: false,
    title: "글 분량",
    how: "글당 본문 1,500자 이상 권장. 얇은 글은 low value 거절 원인",
  },
  {
    code: "about_page",
    required: true,
    title: "소개 페이지",
    how: "운영자 · 다루는 주제 · 작성 방식",
  },
  {
    code: "contact_page",
    required: true,
    title: "문의 페이지",
    how: "이메일 또는 문의 양식",
  },
  {
    code: "privacy_page",
    required: true,
    title: "개인정보처리방침",
    how: "Google 광고 쿠키 사용 고지 포함",
  },
  {
    code: "disclaimer_page",
    required: false,
    title: "면책 고지",
    how: "금융 · 건강 등 YMYL 주제면 필수 취급 (투자 권유 아님 등)",
  },
  {
    code: "navigation_clean",
    required: true,
    title: "탐색 구조",
    how: "메뉴 · 라벨 정리. 빈 라벨 · 미완성 페이지 · 깨진 링크 없음 (사이트 전체 심사)",
  },
  {
    code: "search_console",
    required: false,
    title: "Search Console",
    how: "속성 등록 · sitemap 제출 · 색인 확인",
  },
  {
    code: "ai_disclosure",
    required: false,
    title: "자동화 공개",
    how: "AI · 자동화 사용 시 소개 페이지 등에 공개 (Search Central 권고)",
  },
];

export function verdict(checks: { code: string; status: string }[]) {
  const byCode = new Map(checks.map((c) => [c.code, c.status]));
  const blocking = CHECKS.filter(
    (c) => c.required && byCode.get(c.code) !== "pass",
  ).map((c) => c.code);
  return {
    verdict: blocking.length ? ("not_ready" as const) : ("ready" as const),
    blocking,
  };
}
