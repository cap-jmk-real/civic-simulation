import { Composition } from "remotion";
import type { TickRecord } from "@ip-sim/core";
import { IpSimMetrics } from "./IpSimMetrics";

export type IpSimProps = {
  history: TickRecord[];
};

export const RemotionRoot = () => {
  return (
    <>
      <Composition<IpSimProps>
        id="IpSimMetrics"
        component={IpSimMetrics}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          history: [],
        }}
        calculateMetadata={({ props }) => {
          const len = props.history?.length ?? 0;
          const frames = len > 0 ? Math.min(3600, Math.max(30, len * 2)) : 300;
          return { durationInFrames: frames };
        }}
      />
    </>
  );
};
