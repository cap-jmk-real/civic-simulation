declare module "gifenc" {
  export function quantize(
    rgba: Uint8Array,
    maxColors: number,
    options?: Record<string, unknown>,
  ): Uint32Array;

  export function applyPalette(
    rgba: Uint8Array,
    palette: Uint32Array,
  ): Uint8Array;

  export default function GIFEncoder(options?: {
    initialCapacity?: number;
    auto?: boolean;
  }): {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      opts?: {
        palette?: Uint32Array;
        delay?: number;
        repeat?: number;
        transparent?: boolean;
        transparentIndex?: number;
      },
    ): void;
    finish(): void;
    bytes(): Uint8Array;
  };
}
