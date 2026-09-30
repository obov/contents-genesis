import { clamp, DrawLine, Grid, linePoints, palette, pointAt, reveal } from "./primitives";

// HeroMetric adapted: no demo footer or perpetually pulsing data.
export const HeroMetric: React.FC<{
 frame: number; label: string; value: number; unit: string; comparison: string;
}> = ({frame,label,value,unit,comparison}) => {
 const progress=reveal(frame,0,24);
 return <g fontFamily="Pretendard, sans-serif">
   <circle cx="540" cy="870" r={250+20*progress} fill="none" stroke={palette.orange} strokeWidth="2" opacity=".24"/>
   <circle cx="540" cy="870" r="233" fill="#3a372e" stroke="#726246" strokeWidth="2"/>
   <text x="540" y="774" fill={palette.orange} textAnchor="middle" fontSize="42" fontWeight="700">{label}</text>
   <text x="540" y="945" fill={palette.white} textAnchor="middle" fontSize="150" fontWeight="800">+{(value*progress).toFixed(1)}<tspan fontSize="65" fill={palette.orange}>{unit}</tspan></text>
   <text x="540" y="1225" fill={palette.muted} textAnchor="middle" fontSize="38" opacity={reveal(frame,18,32)}>{comparison}</text>
   <path d="M 492 1310 L 540 1342 L 588 1310" stroke={palette.orange} strokeWidth="6" fill="none" opacity={reveal(frame,30,45)}/>
 </g>;
};

export const PercentileRuler: React.FC<{
  frame: number;
  percentile: number;
  label: string;
}> = ({ frame, percentile, label }) => {
  const progress = reveal(frame, 10, 72);
  const x = 170 + 740 * percentile / 100 * progress;
  return (
    <g>
      <text x="120" y="580" fill={palette.muted} fontSize="35" fontFamily="Arial, sans-serif">{label}</text>
      <text x="120" y="735" fill={palette.white} fontSize="120" fontWeight="800" fontFamily="Arial, sans-serif">{(percentile * progress).toFixed(1)}<tspan fontSize="58" fill={palette.teal}> 백분위</tspan></text>
      <rect x="170" y="970" width="740" height="28" rx="14" fill="#28495c" />
      <rect x="170" y="970" width={740 * 0.9} height="28" rx="14" fill="#315969" />
      <rect x={170 + 740 * 0.9} y="970" width={740 * 0.1} height="28" rx="14" fill="#825a46" />
      {[0, 25, 50, 75, 100].map((tick) => (
        <g key={tick}>
          <line x1={170 + 7.4 * tick} x2={170 + 7.4 * tick} y1="1016" y2="1040" stroke={palette.muted} strokeWidth="3" />
          <text x={170 + 7.4 * tick} y="1090" textAnchor="middle" fill={palette.muted} fontSize="28" fontFamily="Arial, sans-serif">{tick}</text>
        </g>
      ))}
      <line x1={x} x2={x} y1="875" y2="1010" stroke={palette.orange} strokeWidth="7" />
      <circle cx={x} cy="875" r="25" fill={palette.orange} />
      <text x="170" y="1240" fill={palette.muted} fontSize="34" fontFamily="Arial, sans-serif">과거 분포에서 현재값의 위치</text>
      <text x="170" y="1312" fill={palette.orange} fontSize="40" fontWeight="700" fontFamily="Arial, sans-serif" opacity={reveal(frame, 65, 85)}>상위 {(100 - percentile).toFixed(1)}% 수준</text>
    </g>
  );
};

export const LineReveal: React.FC<{
  frame: number;
  label: string;
  values: number[];
  unit: string;
}> = ({ frame, label, values, unit }) => {
  const min = Math.floor(Math.min(...values) - 2);
  const max = Math.ceil(Math.max(...values) + 2);
  const points = linePoints(values, 145, 590, 790, 650, min, max);
  const progress = reveal(frame, 10, 88);
  const marker = pointAt(points, progress);
  return (
    <g>
      <text x="146" y="510" fill={palette.muted} fontSize="34" fontFamily="Arial, sans-serif">{label}</text>
      <Grid x={145} y={590} width={790} height={650} rows={4} />
      <DrawLine points={points} progress={progress} color={palette.teal} width={11} />
      <circle cx={marker.x} cy={marker.y} r="18" fill={palette.white} stroke={palette.teal} strokeWidth="8" />
      <text x="145" y="1310" fill={palette.muted} fontSize="30" fontFamily="Arial, sans-serif">시작</text>
      <text x="935" y="1310" textAnchor="end" fill={palette.muted} fontSize="30" fontFamily="Arial, sans-serif">최근</text>
      <text x="145" y="1420" fill={palette.white} fontSize="80" fontWeight="800" fontFamily="Arial, sans-serif" opacity={reveal(frame, 75, 95)}>{values[values.length - 1].toFixed(1)}<tspan fontSize="44" fill={palette.teal}> {unit}</tspan></text>
    </g>
  );
};

export type IndexedSeries = { name: string; color: string; values: number[] };

// IndexedLines adapted: real monthly observations, explicit common scale,
// date ticks and endpoint labels. The original fixed 90..130 scale is removed.
export const IndexedLines: React.FC<{
 frame: number; series: IndexedSeries[]; min?: number; max?: number;
}> = ({frame,series,min=80,max=280}) => {
 const x=174, y=658, width=640, height=555;
 const progress=reveal(frame,8,94);
 return <g fontFamily="Pretendard, sans-serif">
   <text x="130" y="580" fill={palette.muted} fontSize="29">2025년 8월 말 = 100 · 같은 기준, 같은 축</text>
   {[100,150,200,250].map(tick=><g key={tick}>
     <line x1={x} x2={x+width} y1={y+height-(tick-min)/(max-min)*height} y2={y+height-(tick-min)/(max-min)*height} stroke={palette.grid} strokeDasharray={tick===100?'7 9':undefined}/>
     <text x={x-22} y={y+height-(tick-min)/(max-min)*height+9} textAnchor="end" fontSize="25" fill={palette.muted}>{tick}</text>
   </g>)}
   {series.map(item=>{
     const points=linePoints(item.values,x,y,width,height,min,max);
     const marker=pointAt(points,progress);
     const end=points[points.length-1];
     return <g key={item.name}>
       <DrawLine points={points} progress={progress} color={item.color} width={8}/>
       <circle cx={marker.x} cy={marker.y} r="9" fill={item.color}/>
       <g opacity={reveal(frame,85,104)}>
         <text x={x+width+18} y={end.y-9} fill={item.color} fontSize="26" fontWeight="700">{item.name}</text>
         <text x={x+width+18} y={end.y+29} fill={palette.white} fontSize="32" fontWeight="800">{item.values.at(-1)?.toFixed(1)}</text>
       </g>
     </g>;
   })}
   {['2025.08','2026.02','2026.08'].map((label,i)=><text key={label} x={x+i*width/2} y="1277" fill={palette.muted} fontSize="26" textAnchor={i===0?'start':i===2?'end':'middle'}>{label}</text>)}
   <text x="540" y="1348" fill={palette.white} textAnchor="middle" fontSize="30">실제 월말 관측값 13개로 비교</text>
 </g>;
};

export const DualPanelCompare: React.FC<{
  frame: number;
  topLabel: string;
  bottomLabel: string;
  top: number[];
  bottom: number[];
}> = ({ frame, topLabel, bottomLabel, top, bottom }) => {
  const topPoints = linePoints(top, 150, 600, 760, 290, Math.min(...top) - 2, Math.max(...top) + 2);
  const progress = reveal(frame, 10, 80);
  const maxBottom = Math.max(...bottom) * 1.15;
  return (
    <g>
      <text x="150" y="530" fill={palette.teal} fontSize="38" fontWeight="700" fontFamily="Arial, sans-serif">{topLabel}</text>
      <Grid x={150} y={600} width={760} height={290} rows={3} />
      <DrawLine points={topPoints} progress={progress} color={palette.teal} width={10} />
      <circle cx={pointAt(topPoints, progress).x} cy={pointAt(topPoints, progress).y} r="14" fill={palette.white} />
      <line x1="150" x2="910" y1="1000" y2="1000" stroke={palette.grid} strokeWidth="3" />
      <text x="150" y="1070" fill={palette.orange} fontSize="38" fontWeight="700" fontFamily="Arial, sans-serif">{bottomLabel}</text>
      {bottom.map((value, index) => {
        const barHeight = value / maxBottom * 260 * reveal(frame, 15 + index * 6, 40 + index * 6);
        return <rect key={index} x={155 + index * (750 / bottom.length)} y={1400 - barHeight} width={750 / bottom.length - 18} height={barHeight} rx="8" fill={index === bottom.length - 1 ? palette.coral : palette.orange} />;
      })}
      <line x1="150" x2="910" y1="1400" y2="1400" stroke={palette.muted} strokeWidth="3" />
      <text x="150" y="1490" fill={palette.muted} fontSize="30" fontFamily="Arial, sans-serif">동일한 시간축 · 서로 다른 단위</text>
      <rect x={150 + 760 * clamp(progress)} y="585" width="2" height="825" fill={palette.white} opacity="0.24" />
    </g>
  );
};
