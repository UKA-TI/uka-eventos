/** Representación de ocupación; las sillas no son controles ni lugares numerados. */
export function SeatingTableGraphic({
  capacity,
  occupied,
  zoned,
}: {
  capacity: number;
  occupied: number;
  zoned: boolean;
}) {
  const chairWidth = Math.min(10, 220 / Math.max(capacity, 1));
  return (
    <svg
      className="seating-table-graphic"
      viewBox="0 0 120 120"
      aria-hidden="true"
    >
      <circle className="table-selection-ring" cx="60" cy="60" r="57" />
      {zoned && <circle className="table-zone-ring" cx="60" cy="60" r="34" />}
      <circle className="table-surface" cx="60" cy="60" r="29" />
      {Array.from({ length: capacity }, (_, index) => {
        const degrees = (index / capacity) * 360 - 90;
        const angle = (degrees * Math.PI) / 180;
        return (
          <g
            key={index}
            className={
              index < occupied ? 'table-chair occupied' : 'table-chair'
            }
            transform={`translate(${60 + 45 * Math.cos(angle)} ${60 + 45 * Math.sin(angle)}) rotate(${degrees + 90})`}
          >
            <rect
              x={-chairWidth / 2}
              y="-5"
              width={chairWidth}
              height="10"
              rx="2"
            />
            <path d={`M${-chairWidth / 2} -2 H${chairWidth / 2}`} />
          </g>
        );
      })}
    </svg>
  );
}
