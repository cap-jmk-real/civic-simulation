import type { TickRecord } from "@ip-sim/core";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

export interface IpSimProps {
  history: TickRecord[];
}

export const IpSimMetrics: React.FC<IpSimProps> = ({ history }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps, width, height } = useVideoConfig();
  const idx = Math.min(history.length - 1, Math.max(0, Math.floor(frame / 2)));
  const tick = history[idx]?.metrics;

  const gini = tick?.giniWealth ?? 0;
  const power = tick?.powerHHI ?? 0;
  const innov = tick?.innovationFlow ?? 0;

  const barW = width * 0.65;
  const left = (width - barW) / 2;

  const giniBar = interpolate(gini, [0, 1], [0, 100]);
  const powerBar = interpolate(power, [0, 1], [0, 100]);
  const innovBar = interpolate(Math.min(innov, 80), [0, 80], [0, 100]);

  return (
    <AbsoluteFill style={{ backgroundColor: "#0d0d0f", color: "#e8e8ed", fontFamily: "JetBrains Mono, monospace" }}>
      <div style={{ padding: 72 }}>
        <div style={{ fontSize: 42, fontWeight: 600, marginBottom: 24 }}>IP · Sharing ABM — metrics</div>
        <div style={{ fontSize: 22, opacity: 0.65, marginBottom: 48 }}>
          Frame {frame}/{durationInFrames - 1} · {fps} fps · tick {tick?.tick ?? "—"}
        </div>

        <MetricRow label="Gini wealth" value={gini} pct={giniBar} color="#f472b6" left={left} barW={barW} />
        <MetricRow label="Power HHI" value={power} pct={powerBar} color="#60a5fa" left={left} barW={barW} />
        <MetricRow label="Innovation flow" value={innov} pct={innovBar} color="#fbbf24" left={left} barW={barW} />

        <div style={{ position: "absolute", bottom: 48, left: 72, right: 72, fontSize: 18, opacity: 0.45 }}>
          Render from a downloaded run JSON: extract `history` into `--props` for this composition.
        </div>
      </div>
    </AbsoluteFill>
  );
};

function MetricRow(props: {
  label: string;
  value: number;
  pct: number;
  color: string;
  left: number;
  barW: number;
}) {
  return (
    <div style={{ marginBottom: 36 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 22 }}>
        <span>{props.label}</span>
        <span>{props.value.toFixed(3)}</span>
      </div>
      <div
        style={{
          width: props.barW,
          marginLeft: props.left,
          height: 18,
          borderRadius: 8,
          background: "#1f1f27",
          overflow: "hidden",
          border: "1px solid #2a2a32",
        }}
      >
        <div
          style={{
            width: `${props.pct}%`,
            height: "100%",
            background: props.color,
          }}
        />
      </div>
    </div>
  );
}
