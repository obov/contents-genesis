import type { ReactNode } from "react";

export const palette = {
  background: "#071522",
  panel: "#10283a",
  panelAlt: "#183448",
  grid: "#315064",
  white: "#f7f4e9",
  muted: "#a6bdc8",
  teal: "#5ee4cf",
  blue: "#6bb7f5",
  orange: "#ffb45d",
  coral: "#ff7c74",
};

export const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export const reveal = (frame: number, start: number, end: number) => {
  const t = clamp((frame - start) / (end - start));
  return 1 - Math.pow(1 - t, 3);
};

export const linePoints = (
  values: number[],
  x: number,
  y: number,
  width: number,
  height: number,
  min: number,
  max: number,
) => values.map((value, index) => ({
  x: x + index / (values.length - 1) * width,
  y: y + height - (value - min) / (max - min) * height,
}));

export const lineD = (points: { x: number; y: number }[]) =>
  points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");

export const pointAt = (points: { x: number; y: number }[], progress: number) => {
  const at = clamp(progress) * (points.length - 1);
  const left = Math.floor(at);
  const right = Math.min(points.length - 1, left + 1);
  const mix = at - left;
  return {
    x: points[left].x + (points[right].x - points[left].x) * mix,
    y: points[left].y + (points[right].y - points[left].y) * mix,
  };
};

export const Grid: React.FC<{ x: number; y: number; width: number; height: number; rows?: number }> = ({
  x, y, width, height, rows = 4,
}) => (
  <g>
    {Array.from({ length: rows + 1 }, (_, index) => (
      <line key={index} x1={x} x2={x + width} y1={y + index / rows * height} y2={y + index / rows * height} stroke={palette.grid} strokeWidth="2" opacity="0.58" />
    ))}
  </g>
);

export const DrawLine: React.FC<{
  points: { x: number; y: number }[];
  progress: number;
  color: string;
  width?: number;
}> = ({ points, progress, color, width = 8 }) => (
  <path
    d={lineD(points)}
    pathLength={1}
    fill="none"
    stroke={color}
    strokeWidth={width}
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeDasharray="1"
    strokeDashoffset={1 - clamp(progress)}
  />
);

// Adapted from test-remotion: production labels, Korean font, source footer.
export const Stage: React.FC<{
  title: string[];
  subtitle: string;
  caption: string;
  page: number;
  children: ReactNode;
}> = ({title, subtitle, caption, page, children}) => (
  <svg width="100%" height="100%" viewBox="0 0 1080 1920" xmlns="http://www.w3.org/2000/svg" style={{display: "block", fontFamily: "Pretendard, sans-serif"}}>
    <defs>
      <linearGradient id="stageBg" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stopColor="#071522"/><stop offset="1" stopColor="#0e2735"/>
      </linearGradient>
      <radialGradient id="aura"><stop offset="0" stopColor="#255d65" stopOpacity=".35"/><stop offset="1" stopColor="#255d65" stopOpacity="0"/></radialGradient>
    </defs>
    <rect width="1080" height="1920" fill="url(#stageBg)"/>
    <circle cx="900" cy="650" r="650" fill="url(#aura)"/>
    <rect x="76" y="111" width="7" height="30" rx="3" fill={palette.teal}/>
    <text x="99" y="135" fill={palette.white} fontSize="28" fontWeight="700" letterSpacing="3">숫자 너머</text>
    <text x="972" y="135" fill={palette.muted} fontSize="24" textAnchor="end">투자자의 비교법 · {String(page).padStart(2,'0')}</text>
    {title.map((line,i)=><text key={i} x="76" y={252+i*87} fill={i===1?palette.teal:palette.white} fontSize="70" fontWeight="800" letterSpacing="-3">{line}</text>)}
    <text x="78" y="425" fill={palette.muted} fontSize="30">{subtitle}</text>
    <rect x="64" y="505" width="952" height="895" rx="35" fill="#10283a" stroke="#2b4656" strokeWidth="2"/>
    {children}
    {caption.split('\n').map((line,i)=><text key={i} x="540" y={1516+i*64} textAnchor="middle" fill={i===1?palette.white:palette.muted} fontSize="42" fontWeight="700" letterSpacing="-1">{line}</text>)}
    <line x1="78" x2="1002" y1="1702" y2="1702" stroke={palette.grid}/>
    <text x="78" y="1750" fill={palette.muted} fontSize="25">한국은행 ECOS · 901Y014 · 월말 가격지수</text>
    <text x="78" y="1793" fill="#89a4b2" fontSize="23">2026.09.28 조회 · 특정 ETF 수익률 아님</text>
    <text x="78" y="1834" fill="#89a4b2" fontSize="23">배당·분배금·수수료 미반영</text>
  </svg>
);
