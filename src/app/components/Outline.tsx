/** The landing art: the outline of a tenkeyless board lying on the desk, drawn in SVG. */
const ROWS: readonly (readonly number[])[] = [
  [1, -1, 1, 1, 1, 1, -0.5, 1, 1, 1, 1, -0.5, 1, 1, 1, 1, -0.25, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, -0.25, 1, 1, 1],
  [1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5, -0.25, 1, 1, 1],
  [1.75, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.25],
  [2.25, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.75, -1.25, 1],
  [1.25, 1.25, 1.25, 6.25, 1.25, 1.25, 1.25, 1.25, -0.25, 1, 1, 1],
];

export function Outline() {
  const u = 40;
  const keys: {x: number; y: number; w: number}[] = [];
  ROWS.forEach((row, r) => {
    let x = 0;
    const y = r === 0 ? 0 : r + 0.25;
    for (const width of row) {
      if (width < 0) {
        x += -width;
        continue;
      }
      keys.push({x, y, w: width});
      x += width;
    }
  });
  return (
    <svg className="landing-art" viewBox={`-30 -50 ${18.25 * u + 60} ${6.25 * u + 80}`} aria-hidden="true">
      <rect x={-18} y={-38} width={18.25 * u + 36} height={6.25 * u + 56} rx={20} />
      {keys.map((key) => (
        <rect key={`${key.x}-${key.y}`} x={key.x * u + 3} y={key.y * u + 3} width={key.w * u - 6} height={u - 6} rx={6} />
      ))}
    </svg>
  );
}
