//! Mulberry32 PRNG — matches `packages/sim-core/src/rng.ts` (uses JS `Math.imul` semantics).

/// Stream of values in **[0, 1)** (TS `next` / `mulberry32`); used by the full sim step.
pub trait Rng01 {
    fn next_f64(&mut self) -> f64;
}

/// Fixed value on every call — matches TS tests’ `() => x` PRNG.
#[derive(Clone, Copy, Debug)]
pub struct ConstantRng(pub f64);

impl Rng01 for ConstantRng {
    #[inline]
    fn next_f64(&mut self) -> f64 {
        self.0
    }
}

#[inline]
fn imul(a: u32, b: u32) -> u32 {
    (a as i32).wrapping_mul(b as i32) as u32
}

/// Deterministic PRNG; [`Self::next_f64`] returns values in **[0, 1)** like the TS engine.
#[derive(Clone, Debug)]
pub struct MulBerry32 {
    state: u32,
}

impl MulBerry32 {
    #[inline]
    pub fn new(seed: u32) -> Self {
        Self { state: seed }
    }

    #[inline]
    pub fn next_f64(&mut self) -> f64 {
        self.state = self.state.wrapping_add(0x6d2b79f5);
        let t = self.state;
        let mut r = imul(t ^ (t >> 15), t | 1);
        r ^= r.wrapping_add(imul(r ^ (r >> 7), r | 61));
        let out = r ^ (r >> 14);
        out as f64 / 4294967296.0
    }
}

impl Rng01 for MulBerry32 {
    #[inline]
    fn next_f64(&mut self) -> f64 {
        MulBerry32::next_f64(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_ts_first_twenty_values_seed_12345() {
        let expected: [f64; 20] = [
            0.979_728_267_760_947_3,
            0.306_752_264_499_664_3,
            0.484_205_421_525_985,
            0.817_934_412_509_203,
            0.509_428_369_347_006_1,
            0.347_471_860_470_250_25,
            0.073_757_541_831_582_78,
            0.766_396_467_341_110_1,
            0.996_826_439_397_409_6,
            0.825_022_485_107_183_5,
            0.459_934_873_506_426_8,
            0.945_844_186_004_251_2,
            0.890_623_041_195_794_9,
            0.969_343_685_545_027_3,
            0.627_660_528_058_186_2,
            0.248_825_674_643_740_06,
            0.473_342_839_162_796_74,
            0.305_045_148_124_918_34,
            0.772_419_034_736_231,
            0.865_174_876_758_828_8,
        ];
        let mut g = MulBerry32::new(12345);
        for e in expected {
            let x = g.next_f64();
            assert!(
                (x - e).abs() < 1e-15,
                "mulberry32 mismatch: got {x:.17}, expected {e:.17}"
            );
        }
    }
}
