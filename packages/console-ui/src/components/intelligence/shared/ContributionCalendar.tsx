interface DayData {
  date: string; // YYYY-MM-DD
  count: number;
}

interface ContributionCalendarProps {
  data: DayData[];
  weeks?: number;
  label?: string;
}

type Intensity = 0 | 1 | 2 | 3 | 4;

function getIntensity(count: number, max: number): Intensity {
  if (count === 0 || max === 0) return 0;
  const ratio = count / max;
  if (ratio <= 0.15) return 1;
  if (ratio <= 0.4) return 2;
  if (ratio <= 0.7) return 3;
  return 4;
}

const INTENSITY_CLASSES: Record<Intensity, string> = {
  0: "fill-muted/40",
  1: "fill-primary/20",
  2: "fill-primary/45",
  3: "fill-primary/70",
  4: "fill-primary",
};

const DAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];
const CELL = 11;
const GAP = 2;
const STRIDE = CELL + GAP;

export function ContributionCalendar({
  data,
  weeks = 52,
  label = "prompts",
}: ContributionCalendarProps) {
  const countByDate = new Map<string, number>(data.map((d) => [d.date, d.count]));
  const maxCount = Math.max(...data.map((d) => d.count), 1);

  // Build grid: weeks columns × 7 rows (Sun=0 … Sat=6)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Align end to Saturday
  const dayOfWeek = today.getDay(); // Sun=0
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + (6 - dayOfWeek));

  const totalDays = weeks * 7;
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - totalDays + 1);

  interface Cell {
    date: string;
    count: number;
    intensity: 0 | 1 | 2 | 3 | 4;
    inFuture: boolean;
  }

  const grid: Cell[][] = Array.from({ length: weeks }, () => Array(7).fill(null));
  const monthBreaks: { weekIdx: number; label: string }[] = [];
  let lastMonth = -1;

  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const offset = w * 7 + d;
      const date = new Date(startDate);
      date.setDate(date.getDate() + offset);
      const yyyy = date.getFullYear();
      const mm = String(date.getMonth() + 1).padStart(2, "0");
      const dd = String(date.getDate()).padStart(2, "0");
      const dateStr = `${yyyy}-${mm}-${dd}`;
      const count = countByDate.get(dateStr) ?? 0;
      const inFuture = date > today;

      if (date.getMonth() !== lastMonth && d === 0) {
        monthBreaks.push({
          weekIdx: w,
          label: date.toLocaleString("default", { month: "short" }),
        });
        lastMonth = date.getMonth();
      }

      grid[w]![d] = { date: dateStr, count, intensity: getIntensity(count, maxCount), inFuture };
    }
  }

  const svgWidth = weeks * STRIDE + 30; // 30px for day labels
  const svgHeight = 7 * STRIDE + 20; // 20px for month labels

  const totalCount = data.reduce((s, d) => s + d.count, 0);

  return (
    <div className="w-full overflow-x-auto">
      <svg
        width="100%"
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        aria-label={`Contribution calendar: ${totalCount} ${label}`}
        role="img"
        style={{ minWidth: Math.min(svgWidth, 400) }}
      >
        {/* Month labels */}
        {monthBreaks.map(({ weekIdx, label: ml }) => (
          <text
            key={`${weekIdx}-${ml}`}
            x={30 + weekIdx * STRIDE}
            y={9}
            fontSize={8}
            fill="currentColor"
            opacity={0.5}
          >
            {ml}
          </text>
        ))}

        {/* Day labels */}
        {DAY_LABELS.map((dl, i) =>
          dl ? (
            <text
              key={i}
              x={22}
              y={14 + i * STRIDE + CELL / 2}
              fontSize={7}
              fill="currentColor"
              opacity={0.5}
              textAnchor="end"
              dominantBaseline="middle"
            >
              {dl}
            </text>
          ) : null,
        )}

        {/* Cells */}
        {grid.map((week, w) =>
          week.map((cell, d) => (
            <rect
              key={`${w}-${d}`}
              x={30 + w * STRIDE}
              y={14 + d * STRIDE}
              width={CELL}
              height={CELL}
              rx={2}
              className={cell.inFuture ? "fill-muted/20" : INTENSITY_CLASSES[cell.intensity]}
            >
              <title>
                {cell.date}: {cell.count} {label}
              </title>
            </rect>
          )),
        )}
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-1 mt-1 justify-end">
        <span className="text-[10px] text-muted-foreground mr-1">Less</span>
        {([0, 1, 2, 3, 4] as const).map((level) => (
          <svg key={level} width={CELL} height={CELL}>
            <rect
              width={CELL}
              height={CELL}
              rx={2}
              className={INTENSITY_CLASSES[level]}
            />
          </svg>
        ))}
        <span className="text-[10px] text-muted-foreground ml-1">More</span>
      </div>
    </div>
  );
}
