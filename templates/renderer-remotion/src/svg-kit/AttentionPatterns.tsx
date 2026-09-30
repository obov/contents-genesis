import { DrawLine, Grid, linePoints, palette, pointAt, reveal } from "./primitives";

export const ContrastSnap: React.FC<{ frame: number; value: string; label: string }> = ({ frame, value, label }) => {
  const appear = reveal(frame, 3, 20);
  const settle = reveal(frame, 17, 30);
  const scale = 0.35 + appear * 0.82 - settle * 0.17;
  const ring = 315 + Math.sin(frame * 0.18) * 7;
  return (
    <g>
      <text x="80" y="270" fill={palette.white} fontSize="84" fontWeight="800" fontFamily="Arial, sans-serif">숫자가 튀어나온 순간</text>
      {Array.from({ length: 20 }, (_, index) => (
        <text key={index} x={110 + index % 4 * 250} y={460 + Math.floor(index / 4) * 255} fill="#71919e" fontSize="52" opacity="0.13" fontFamily="Arial, sans-serif">{(index * 2.3 + 1.1).toFixed(1)}</text>
      ))}
      <circle cx="540" cy="940" r={ring} fill="none" stroke={palette.teal} strokeWidth="8" opacity={0.28 * appear} />
      <g transform={`translate(540 940) scale(${scale})`} opacity={appear}>
        <circle r="300" fill={palette.teal} />
        <circle r="282" fill="none" stroke="#e6fff8" strokeWidth="5" opacity="0.5" />
        <text x="0" y="48" textAnchor="middle" fill="#09242d" fontSize="195" fontWeight="900" fontFamily="Arial, sans-serif">{value}</text>
      </g>
      <text x="540" y="1405" textAnchor="middle" fill={palette.white} fontSize="59" fontWeight="800" fontFamily="Arial, sans-serif" opacity={reveal(frame, 20, 38)}>{label}</text>
      <rect x="305" y="1450" width={470 * reveal(frame, 24, 45)} height="10" rx="5" fill={palette.orange} />
    </g>
  );
};

const backgroundBars = [185, 236, 174, 250, 213, 176, 240, 205, 198, 225, 182];

export const OutlierPop: React.FC<{ frame: number; label: string }> = ({ frame, label }) => {
  const pop = reveal(frame, 24, 58);
  const base = reveal(frame, 0, 25);
  return (
    <g>
      <text x="80" y="260" fill={palette.white} fontSize="90" fontWeight="900" fontFamily="Arial, sans-serif">단 하나만</text>
      <text x="82" y="350" fill={palette.orange} fontSize="72" fontWeight="800" fontFamily="Arial, sans-serif">다르게 움직였다</text>
      <line x1="90" x2="990" y1="1380" y2="1380" stroke={palette.grid} strokeWidth="4" />
      {backgroundBars.map((height, index) => {
        const chosen = index === 8;
        const actualHeight = height * base + (chosen ? 520 * pop : 0);
        const x = 104 + index * 79;
        return (
          <g key={index}>
            {chosen && <rect x={x - 18} y={1380 - actualHeight - 25} width="100" height={actualHeight + 48} rx="25" fill={palette.orange} opacity={0.09 * pop} />}
            <rect x={x} y={1380 - actualHeight} width="54" height={actualHeight} rx="16" fill={chosen && pop > 0.01 ? palette.orange : "#557889"} />
          </g>
        );
      })}
      <text x="762" y="550" fill={palette.orange} fontSize="64" fontWeight="900" fontFamily="Arial, sans-serif" opacity={pop}>↑</text>
      <text x="82" y="1545" fill={palette.white} fontSize="48" fontWeight="700" fontFamily="Arial, sans-serif" opacity={reveal(frame, 52, 70)}>{label}</text>
    </g>
  );
};

export const GapSplit: React.FC<{ frame: number; first: number; second: number }> = ({ frame, first, second }) => {
  const progress = reveal(frame, 10, 72);
  const calm = [0, 0.5, 0.9, 1.3, 1.8, first];
  const fast = [0, 0.9, 2.4, 3.6, 5.6, second];
  const firstPoints = linePoints(calm, 150, 695, 710, 650, 0, 9);
  const secondPoints = linePoints(fast, 150, 695, 710, 650, 0, 9);
  const calmMarker = pointAt(firstPoints, progress);
  const fastMarker = pointAt(secondPoints, progress);
  return (
    <g>
      <text x="80" y="255" fill={palette.white} fontSize="79" fontWeight="800" fontFamily="Arial, sans-serif">같이 시작했는데</text>
      <text x="80" y="347" fill={palette.orange} fontSize="86" fontWeight="900" fontFamily="Arial, sans-serif">이렇게 벌어졌다</text>
      <Grid x={150} y={695} width={710} height={650} rows={4} />
      <DrawLine points={firstPoints} progress={progress} color={palette.blue} width={12} />
      <DrawLine points={secondPoints} progress={progress} color={palette.orange} width={14} />
      <circle cx={calmMarker.x} cy={calmMarker.y} r="15" fill={palette.blue} />
      <circle cx={fastMarker.x} cy={fastMarker.y} r="18" fill={palette.orange} />
      <text x="875" y={secondPoints[secondPoints.length - 1].y + 13} fill={palette.orange} fontSize="48" fontWeight="800" fontFamily="Arial, sans-serif" opacity={reveal(frame, 65, 79)}>{second.toFixed(1)}%</text>
      <text x="875" y={firstPoints[firstPoints.length - 1].y + 13} fill={palette.blue} fontSize="48" fontWeight="800" fontFamily="Arial, sans-serif" opacity={reveal(frame, 65, 79)}>{first.toFixed(1)}%</text>
      <text x="150" y="1500" fill={palette.muted} fontSize="40" fontFamily="Arial, sans-serif">전체 물가 vs 신선식품 · 샘플</text>
    </g>
  );
};

export type RankItem = { name: string; color: string; value: number };
// RankJump adapted from the original five-row demo to actual two-index returns.
export const RankJump: React.FC<{
 frame: number; items: RankItem[]; previousOrder?: string[]; scaleMax: number; label: string;
}> = ({frame,items,previousOrder,scaleMax,label}) => {
 const move=reveal(frame,8,42);
 const sorted=[...items].sort((a,b)=>b.value-a.value);
 return <g fontFamily="Pretendard, sans-serif">
   <text x="126" y="580" fill={palette.muted} fontSize="30">{label}</text>
   {sorted.map((item,index)=>{
     const old=previousOrder?previousOrder.indexOf(item.name):index;
     const y=670+(old+(index-old)*move)*304;
     const ready=reveal(frame,38,58);
     return <g key={item.name} transform={`translate(0 ${y})`}>
       <rect x="115" y="0" width="850" height="246" rx="23" fill="#153247" stroke={item.color} strokeOpacity={index===0?.65:.17} strokeWidth="2"/>
       <text x="146" y="68" fill={palette.muted} fontSize="30">{move===1?String(index+1).padStart(2,'0'):'—'}</text>
       <text x="221" y="70" fill={item.color} fontSize="47" fontWeight="700">{item.name}</text>
       <text x="923" y="81" textAnchor="end" fill={palette.white} fontSize="65" fontWeight="800" opacity={ready}>+{item.value.toFixed(1)}<tspan fontSize="35">%</tspan></text>
       <rect x="221" y="139" width="680" height="32" rx="9" fill="#244557"/>
       <rect x="221" y="139" width={680*item.value/scaleMax*ready} height="32" rx="9" fill={item.color}/>
       <text x="221" y="210" fill={palette.muted} fontSize="22">0%</text>
       <text x="901" y="210" textAnchor="end" fill={palette.muted} fontSize="22">{scaleMax}%</text>
     </g>;
   })}
   <text x="540" y="1335" textAnchor="middle" fill={palette.muted} fontSize="27">기간 내 가격지수 변화율 · 각 화면 공통 0 기준</text>
 </g>;
};

export const MetricToContext: React.FC<{ frame: number; percentile: number }> = ({ frame, percentile }) => {
  const context = reveal(frame, 24, 62);
  const valueY = 940 - context * 330;
  const scale = 1.7 - context * 0.7;
  const markerX = 160 + percentile / 100 * 760;
  return (
    <g>
      <text x="80" y="260" fill={palette.white} fontSize="79" fontWeight="800" fontFamily="Arial, sans-serif">이 숫자의 의미는?</text>
      <g transform={`translate(540 ${valueY}) scale(${scale})`}>
        <text x="0" y="0" textAnchor="middle" fill={palette.teal} fontSize="185" fontWeight="900" fontFamily="Arial, sans-serif">{percentile.toFixed(1)}</text>
      </g>
      <text x="540" y="790" textAnchor="middle" fill={palette.muted} fontSize="42" fontFamily="Arial, sans-serif" opacity={context}>과거 5년 내 백분위 · 샘플</text>
      <line x1="160" x2="920" y1="1090" y2="1090" stroke="#456273" strokeWidth="26" strokeLinecap="round" opacity={context} />
      <line x1="844" x2="920" y1="1090" y2="1090" stroke={palette.orange} strokeWidth="26" strokeLinecap="round" opacity={context} />
      <circle cx={markerX} cy="1090" r={29 * context} fill={palette.orange} />
      <text x="160" y="1170" fill={palette.muted} fontSize="34" fontFamily="Arial, sans-serif" opacity={context}>낮음</text>
      <text x="920" y="1170" textAnchor="end" fill={palette.muted} fontSize="34" fontFamily="Arial, sans-serif" opacity={context}>높음</text>
      <text x="540" y="1400" textAnchor="middle" fill={palette.white} fontSize="72" fontWeight="800" fontFamily="Arial, sans-serif" opacity={reveal(frame, 57, 76)}>상위 {(100 - percentile).toFixed(1)}% 수준</text>
    </g>
  );
};
