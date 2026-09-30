import { DrawLine, Grid, linePoints, palette, pointAt, reveal } from "./primitives";

export const LeadLagTimeline: React.FC<{
  frame: number;
  firstLabel: string;
  secondLabel: string;
  first: number[];
  second: number[];
  lagLabel: string;
}> = ({ frame, firstLabel, secondLabel, first, second, lagLabel }) => {
  const firstPoints = linePoints(first, 150, 590, 760, 275, 90, 130);
  const secondPoints = linePoints(second, 150, 1090, 760, 275, 90, 130);
  const progress = reveal(frame, 8, 75);
  const firstPeak = firstPoints[first.indexOf(Math.max(...first))];
  const secondPeak = secondPoints[second.indexOf(Math.max(...second))];
  const revealLag = reveal(frame, 72, 102);
  return (
    <g>
      <text x="150" y="525" fill={palette.teal} fontSize="37" fontWeight="700" fontFamily="Arial, sans-serif">① {firstLabel}</text>
      <Grid x={150} y={590} width={760} height={275} rows={2} />
      <DrawLine points={firstPoints} progress={progress} color={palette.teal} width={9} />
      <text x="150" y="1020" fill={palette.orange} fontSize="37" fontWeight="700" fontFamily="Arial, sans-serif">② {secondLabel}</text>
      <Grid x={150} y={1090} width={760} height={275} rows={2} />
      <DrawLine points={secondPoints} progress={progress} color={palette.orange} width={9} />
      <circle cx={firstPeak.x} cy={firstPeak.y} r={15 * revealLag} fill={palette.teal} />
      <circle cx={secondPeak.x} cy={secondPeak.y} r={15 * revealLag} fill={palette.orange} />
      <line x1={firstPeak.x} x2={firstPeak.x} y1={firstPeak.y + 20} y2="970" stroke={palette.teal} strokeWidth="3" strokeDasharray="10 12" opacity={revealLag} />
      <line x1={secondPeak.x} x2={secondPeak.x} y1="970" y2={secondPeak.y - 20} stroke={palette.orange} strokeWidth="3" strokeDasharray="10 12" opacity={revealLag} />
      <line x1={firstPeak.x} x2={firstPeak.x + (secondPeak.x - firstPeak.x) * revealLag} y1="966" y2="966" stroke={palette.white} strokeWidth="5" />
      <text x="540" y="1510" textAnchor="middle" fill={palette.white} fontSize="46" fontWeight="700" fontFamily="Arial, sans-serif" opacity={revealLag}>{lagLabel}</text>
      <text x="540" y="1560" textAnchor="middle" fill={palette.muted} fontSize="26" fontFamily="Arial, sans-serif" opacity={revealLag}>시차는 연관성 탐색이며 인과관계의 증거는 아닙니다</text>
    </g>
  );
};

export type Contribution = { label: string; value: number };

export const ContributionBars: React.FC<{
  frame: number;
  items: Contribution[];
  unit: string;
}> = ({ frame, items, unit }) => {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const zeroX = 390;
  const scale = 530;
  return (
    <g>
      <text x="140" y="520" fill={palette.muted} fontSize="32" fontFamily="Arial, sans-serif">전체 변화를 구성한 항목</text>
      <line x1={zeroX} x2={zeroX} y1="610" y2="1370" stroke={palette.white} strokeWidth="3" opacity="0.55" />
      {items.map((item, index) => {
        const y = 650 + index * 180;
        const width = Math.abs(item.value) * scale * reveal(frame, 12 + index * 13, 46 + index * 13);
        const positive = item.value >= 0;
        return (
          <g key={item.label}>
            <text x="137" y={y + 36} fill={palette.white} fontSize="34" fontWeight="700" fontFamily="Arial, sans-serif">{item.label}</text>
            <rect x={positive ? zeroX : zeroX - width} y={y} width={width} height="58" rx="14" fill={positive ? palette.teal : palette.coral} />
            <text x="938" y={y + 40} textAnchor="end" fill={positive ? palette.teal : palette.coral} fontSize="38" fontWeight="700" fontFamily="Arial, sans-serif">{item.value > 0 ? "+" : ""}{item.value.toFixed(1)}{unit}</text>
          </g>
        );
      })}
      <line x1="140" x2="940" y1="1410" y2="1410" stroke={palette.grid} strokeWidth="3" />
      <text x="140" y="1510" fill={palette.muted} fontSize="34" fontFamily="Arial, sans-serif">합계</text>
      <text x="938" y="1510" textAnchor="end" fill={palette.white} fontSize="62" fontWeight="800" fontFamily="Arial, sans-serif" opacity={reveal(frame, 75, 95)}>{total > 0 ? "+" : ""}{total.toFixed(1)}{unit}</text>
    </g>
  );
};

export type BasketItem = { label: string; change: number };

const BasketIcon: React.FC<{ index: number; x: number; y: number }> = ({ index, x, y }) => {
  if (index % 3 === 0) return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M -12 -22 Q 0 -42 13 -22 L 8 -6 L 22 25 Q 0 44 -22 25 L -8 -6 Z" fill="#f6a64d" />
      <path d="M -4 -25 Q -23 -46 -30 -36 M 5 -25 Q 18 -49 27 -38" fill="none" stroke="#5ee4cf" strokeWidth="9" strokeLinecap="round" />
    </g>
  );
  if (index % 3 === 1) return (
    <g transform={`translate(${x} ${y})`}>
      <rect x="-22" y="-35" width="44" height="72" rx="7" fill="#e8eef1" />
      <path d="M -22 -18 L 22 -18 M -22 0 L 22 0" stroke="#5caed0" strokeWidth="5" />
      <rect x="-13" y="-47" width="26" height="14" rx="4" fill="#5caed0" />
    </g>
  );
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M -30 -5 Q -30 -34 0 -33 Q 30 -34 30 -5 L 30 29 Q 0 44 -30 29 Z" fill="#e8b16d" />
      <path d="M -19 -2 Q 0 10 19 -2" fill="none" stroke="#bc774d" strokeWidth="5" />
    </g>
  );
};

export const BasketBreakdown: React.FC<{
  frame: number;
  items: BasketItem[];
}> = ({ frame, items }) => (
  <g>
    <text x="140" y="520" fill={palette.muted} fontSize="32" fontFamily="Arial, sans-serif">같은 물가라도 품목마다 다릅니다</text>
    {items.map((item, index) => {
      const y = 610 + index * 275;
      const progress = reveal(frame, 10 + index * 18, 48 + index * 18);
      const color = index === 0 ? palette.coral : index === 1 ? palette.orange : palette.teal;
      return (
        <g key={item.label} opacity={progress}>
          <rect x="128" y={y} width="824" height="216" rx="28" fill={palette.panelAlt} stroke="#315366" strokeWidth="2" />
          <circle cx="224" cy={y + 105} r="67" fill="#294b59" />
          <BasketIcon index={index} x={224} y={y + 105} />
          <text x="330" y={y + 86} fill={palette.white} fontSize="39" fontWeight="700" fontFamily="Arial, sans-serif">{item.label}</text>
          <text x="330" y={y + 154} fill={color} fontSize="53" fontWeight="800" fontFamily="Arial, sans-serif">{item.change > 0 ? "+" : ""}{(item.change * progress).toFixed(1)}%</text>
          <rect x="730" y={y + 80} width="156" height="20" rx="10" fill="#39586a" />
          <rect x="730" y={y + 80} width={Math.min(156, Math.abs(item.change) / 10 * 156) * progress} height="20" rx="10" fill={color} />
        </g>
      );
    })}
    <text x="140" y="1530" fill={palette.muted} fontSize="30" fontFamily="Arial, sans-serif">실제 데이터에서는 동일한 기준 기간으로 비교</text>
  </g>
);

export const HousingPriceVolume: React.FC<{
  frame: number;
  price: number[];
  volume: number[];
}> = ({ frame, price, volume }) => {
  const pricePoints = linePoints(price, 165, 745, 745, 270, Math.min(...price) - 2, Math.max(...price) + 2);
  const volumeMax = Math.max(...volume) * 1.1;
  const progress = reveal(frame, 13, 82);
  return (
    <g>
      <path d="M 145 598 L 230 523 L 315 598" fill="none" stroke={palette.orange} strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M 170 580 V 650 H 290 V 580" fill="none" stroke={palette.orange} strokeWidth="13" strokeLinejoin="round" />
      <rect x="218" y="607" width="28" height="43" fill={palette.orange} />
      <text x="340" y="588" fill={palette.white} fontSize="42" fontWeight="700" fontFamily="Arial, sans-serif">가격과 거래량을 함께 보기</text>
      <text x="165" y="715" fill={palette.teal} fontSize="33" fontWeight="700" fontFamily="Arial, sans-serif">매매가격지수</text>
      <Grid x={165} y={745} width={745} height={270} rows={2} />
      <DrawLine points={pricePoints} progress={progress} color={palette.teal} width={10} />
      <circle cx={pointAt(pricePoints, progress).x} cy={pointAt(pricePoints, progress).y} r="13" fill={palette.white} />
      <text x="165" y="1130" fill={palette.orange} fontSize="33" fontWeight="700" fontFamily="Arial, sans-serif">거래량</text>
      {volume.map((value, index) => {
        const height = value / volumeMax * 245 * reveal(frame, 18 + index * 6, 46 + index * 6);
        return <rect key={index} x={168 + index * (740 / volume.length)} y={1430 - height} width={740 / volume.length - 14} height={height} rx="7" fill={palette.orange} />;
      })}
      <line x1="165" x2="910" y1="1430" y2="1430" stroke={palette.muted} strokeWidth="3" />
      <text x="165" y="1530" fill={palette.muted} fontSize="30" fontFamily="Arial, sans-serif">같은 상승이라도 거래량에 따라 해석이 달라집니다</text>
    </g>
  );
};

export type Payment = { principal: number; interest: number };

export const LoanPaymentStack: React.FC<{
  frame: number;
  before: Payment;
  after: Payment;
  unit: string;
}> = ({ frame, before, after, unit }) => {
  const max = Math.max(before.principal + before.interest, after.principal + after.interest) * 1.15;
  const rows = [
    { x: 245, label: "이전", data: before, start: 12 },
    { x: 625, label: "이후", data: after, start: 42 },
  ];
  return (
    <g>
      <text x="150" y="535" fill={palette.muted} fontSize="34" fontFamily="Arial, sans-serif">월 납입액 구성 예시</text>
      <line x1="150" x2="930" y1="1400" y2="1400" stroke={palette.grid} strokeWidth="4" />
      {rows.map(({ x, label, data, start }) => {
        const progress = reveal(frame, start, start + 45);
        const principalHeight = data.principal / max * 675 * progress;
        const interestHeight = data.interest / max * 675 * progress;
        return (
          <g key={label}>
            <text x={x + 105} y="670" textAnchor="middle" fill={palette.white} fontSize="46" fontWeight="700" fontFamily="Arial, sans-serif">{label}</text>
            <rect x={x} y={1400 - principalHeight} width="210" height={principalHeight} fill={palette.blue} rx="15" />
            <rect x={x} y={1400 - principalHeight - interestHeight} width="210" height={interestHeight} fill={palette.orange} rx="15" />
            <text x={x + 105} y={1400 - principalHeight / 2 + 12} textAnchor="middle" fill={palette.background} fontSize="38" fontWeight="800" fontFamily="Arial, sans-serif" opacity={progress}>원금</text>
            <text x={x + 105} y={1400 - principalHeight - interestHeight / 2 + 12} textAnchor="middle" fill={palette.background} fontSize="38" fontWeight="800" fontFamily="Arial, sans-serif" opacity={progress}>이자</text>
            <text x={x + 105} y="1490" textAnchor="middle" fill={palette.white} fontSize="48" fontWeight="800" fontFamily="Arial, sans-serif">{Math.round((data.principal + data.interest) * progress)}{unit}</text>
          </g>
        );
      })}
      <circle cx="213" cy="1580" r="10" fill={palette.blue} />
      <text x="238" y="1592" fill={palette.muted} fontSize="31" fontFamily="Arial, sans-serif">원금</text>
      <circle cx="441" cy="1580" r="10" fill={palette.orange} />
      <text x="466" y="1592" fill={palette.muted} fontSize="31" fontFamily="Arial, sans-serif">이자</text>
    </g>
  );
};
