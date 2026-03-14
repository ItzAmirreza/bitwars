// ── Seeded Noise Helpers ──
// Deterministic noise functions for terrain generation.

pub fn hash2d_seeded(x: i32, z: i32, seed: u64) -> f64 {
    let sx = x.wrapping_add(seed as i32);
    let sz = z.wrapping_add((seed >> 32) as i32);
    let mut h: i32 = sx
        .wrapping_mul(374761393)
        .wrapping_add(sz.wrapping_mul(668265263));
    h = (h ^ (h >> 13)).wrapping_mul(1274126177);
    ((h ^ (h >> 16)) & 0x7fffffff) as f64 / 0x7fffffff as f64
}

fn sm(t: f64) -> f64 {
    t * t * (3.0 - 2.0 * t)
}

pub fn lrp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

fn vnoise_seeded(x: f64, z: f64, seed: u64) -> f64 {
    let ix = x.floor() as i32;
    let iz = z.floor() as i32;
    let fx = sm(x - ix as f64);
    let fz = sm(z - iz as f64);
    lrp(
        lrp(
            hash2d_seeded(ix, iz, seed),
            hash2d_seeded(ix + 1, iz, seed),
            fx,
        ),
        lrp(
            hash2d_seeded(ix, iz + 1, seed),
            hash2d_seeded(ix + 1, iz + 1, seed),
            fx,
        ),
        fz,
    )
}

pub fn fbm_seeded(mut x: f64, mut z: f64, oct: usize, seed: u64) -> f64 {
    let mut v = 0.0;
    let mut a = 1.0;
    let mut m = 0.0;
    for i in 0..oct {
        v += vnoise_seeded(x, z, seed.wrapping_add(i as u64 * 7919)) * a;
        m += a;
        a *= 0.5;
        x *= 2.0;
        z *= 2.0;
    }
    v / m
}
