import { radarModel, type RadarAxis, type RadarLayer } from '@heist/shared';

/** Okabe–Ito colours: readable with every common kind of colour blindness; outlines also differ by dash. */
export const RADAR_COLOURS = {
  fill: '#0072b2',
  outline: '#e69f00',
  thin: '#8a93a6',
  grid: '#9aa3b5',
};

/**
 * A radar (spider) chart from the shared geometry. Axes with no evidence are a
 * dashed grey spoke labelled "not enough data", never a zero.
 */
export function Radar({
  axes,
  layers,
  title,
  size = 260,
}: {
  axes: readonly RadarAxis[];
  layers: readonly RadarLayer[];
  title: string;
  size?: number;
}) {
  const m = radarModel(axes, layers, size);
  const thin = new Set(m.layers[0]?.thin ?? []);
  return (
    <svg
      viewBox={`0 0 ${m.size} ${m.size}`}
      role="img"
      aria-label={title}
      className="radar"
      style={{ width: '100%', maxWidth: size, height: 'auto' }}
    >
      <title>{title}</title>
      {m.rings.map((r) => (
        <path
          key={r.percent}
          d={r.path}
          fill="none"
          stroke={RADAR_COLOURS.grid}
          strokeWidth={0.6}
        />
      ))}
      {m.axes.map((a) => (
        <line
          key={a.key}
          x1={m.centre.x}
          y1={m.centre.y}
          x2={a.end.x}
          y2={a.end.y}
          stroke={RADAR_COLOURS.grid}
          strokeWidth={0.6}
        />
      ))}
      {m.layers.map((layer) => {
        const colour = layer.kind === 'fill' ? RADAR_COLOURS.fill : RADAR_COLOURS.outline;
        return (
          <g key={layer.id} data-layer={layer.id}>
            <path
              d={layer.path}
              fill={layer.kind === 'fill' ? colour : 'none'}
              fillOpacity={layer.kind === 'fill' ? 0.3 : 0}
              stroke={colour}
              strokeWidth={2}
              strokeDasharray={layer.dashed || layer.kind === 'outline' ? '5 3' : undefined}
            />
            {layer.points.map((p, i) =>
              p ? <circle key={i} cx={p.x} cy={p.y} r={3} fill={colour} /> : null,
            )}
          </g>
        );
      })}
      {m.axes.map((a, i) =>
        thin.has(i) ? (
          <line
            key={`thin-${a.key}`}
            data-thin={a.key}
            x1={m.centre.x}
            y1={m.centre.y}
            x2={a.end.x}
            y2={a.end.y}
            stroke={RADAR_COLOURS.thin}
            strokeWidth={1.5}
            strokeDasharray="3 3"
          />
        ) : null,
      )}
      {m.axes.map((a, i) => (
        <text
          key={`label-${a.key}`}
          x={a.labelAt.x}
          y={a.labelAt.y}
          textAnchor={a.anchor}
          dominantBaseline="middle"
          fontSize={9}
          fill={thin.has(i) ? RADAR_COLOURS.thin : 'currentColor'}
        >
          <tspan>{a.label}</tspan>
          {thin.has(i) && (
            <tspan x={a.labelAt.x} dy={10} fontSize={7.5}>
              not enough data
            </tspan>
          )}
        </text>
      ))}
    </svg>
  );
}
