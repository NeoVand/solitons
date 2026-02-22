export interface CurvePoint {
    x: number;
    y: number;
}

// Monotonic cubic interpolation to prevent overshooting in curve
export function monotonicCubicInterpolation(points: { x: number; y: number }[], x: number): number {
    if (points.length === 0) return 0;
    if (points.length === 1) return points[0].y;

    // Handle out of bounds
    if (x <= points[0].x) return points[0].y;
    if (x >= points[points.length - 1].x) return points[points.length - 1].y;

    // Find the interval containing x
    let i = 0;
    while (i < points.length - 1 && x > points[i + 1].x) {
        i++;
    }

    const p0 = points[i];
    const p1 = points[i + 1];

    // Linear interpolation if monotonic cubic fails (fallback)
    const t = (x - p0.x) / (p1.x - p0.x);

    // Calculate secant slopes
    const m: number[] = new Array(points.length).fill(0);
    const dx: number[] = new Array(points.length - 1).fill(0);
    const dy: number[] = new Array(points.length - 1).fill(0);

    for (let j = 0; j < points.length - 1; j++) {
        dx[j] = points[j + 1].x - points[j].x;
        dy[j] = points[j + 1].y - points[j].y;
        m[j] = dy[j] / dx[j];
    }

    // Calculate tangent slopes
    const c: number[] = new Array(points.length).fill(0);
    c[0] = m[0];
    for (let j = 1; j < points.length - 1; j++) {
        if (m[j - 1] * m[j] <= 0) {
            c[j] = 0;
        } else {
            c[j] = (dx[j - 1] + dx[j]) / ((dx[j - 1] / m[j - 1]) + (dx[j] / m[j]));
        }
    }
    c[points.length - 1] = m[points.length - 2];

    // Cubic Hermite spline interpolation
    const h = p1.x - p0.x;
    const t2 = t * t;
    const t3 = t2 * t;

    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;

    const y = h00 * p0.y + h10 * h * c[i] + h01 * p1.y + h11 * h * c[i + 1];
    return Math.max(0, Math.min(1, y)); // clamp just in case
}
