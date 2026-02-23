export interface Vector3 {
    x: number; y: number; z: number;
}

export class HopfionGenerator {
    static generateFieldBuffer(
        gridSize: [number, number, number],
        scale: number = 1.0,
        charge: number = -1,
        offset: [number, number, number] = [0, 0, 0],
        velocity: [number, number, number] = [0, 0, 0],
        existingBuffer?: Float32Array
    ): Float32Array {
        const [nx, ny, nz] = gridSize;
        const numVoxels = nx * ny * nz;
        const buffer = existingBuffer || new Float32Array(numVoxels * 8);

        const cx = nx / 2 + offset[0];
        const cy = ny / 2 + offset[1];
        const cz = nz / 2 + offset[2];

        // Velocity components
        const vx = velocity[0];
        const vy = velocity[1];
        const vz = velocity[2];
        const v2 = vx * vx + vy * vy + vz * vz;
        const v = Math.sqrt(v2);

        let gamma = 1.0;
        if (v > 0.0001 && v < 0.999) {
            gamma = 1.0 / Math.sqrt(1.0 - v2);
        } else if (v >= 0.999) {
            gamma = 1.0 / Math.sqrt(1.0 - 0.999 * 0.999); // Cap to prevent Infinity
        }

        for (let z = 0; z < nz; z++) {
            for (let y = 0; y < ny; y++) {
                for (let x = 0; x < nx; x++) {
                    const idx = (x + y * nx + z * nx * ny) * 8;

                    // Relative pos
                    let px = (x - cx) * scale;
                    let py = (y - cy) * scale;
                    let pz = (z - cz) * scale;

                    // Lorentz Coordinate Contraction along the axis of motion
                    if (v > 0.0001) {
                        const r_dot_v = px * vx + py * vy + pz * vz;
                        const factor = (gamma - 1.0) * r_dot_v / v2;
                        px += factor * vx;
                        py += factor * vy;
                        pz += factor * vz;
                    }

                    // Get rest frame fields
                    const { E: E_rest, B: B_rest } = this.calculateRanadaField(px, py, pz, charge);

                    let Ex = E_rest.x; let Ey = E_rest.y; let Ez = E_rest.z;
                    let Bx = B_rest.x; let By = B_rest.y; let Bz = B_rest.z;

                    // Lorentz Field Transformation
                    if (v > 0.0001) {
                        // E_lab = gamma * (E_rest - v x B_rest) - (gamma - 1) * (v . E_rest) / v2 * v
                        // B_lab = gamma * (B_rest + v x E_rest) - (gamma - 1) * (v . B_rest) / v2 * v

                        const cross_v_B_x = vy * B_rest.z - vz * B_rest.y;
                        const cross_v_B_y = vz * B_rest.x - vx * B_rest.z;
                        const cross_v_B_z = vx * B_rest.y - vy * B_rest.x;

                        const cross_v_E_x = vy * E_rest.z - vz * E_rest.y;
                        const cross_v_E_y = vz * E_rest.x - vx * E_rest.z;
                        const cross_v_E_z = vx * E_rest.y - vy * E_rest.x;

                        const v_dot_E = vx * E_rest.x + vy * E_rest.y + vz * E_rest.z;
                        const v_dot_B = vx * B_rest.x + vy * B_rest.y + vz * B_rest.z;

                        const factor = (gamma - 1.0) / v2;

                        Ex = gamma * (E_rest.x - cross_v_B_x) - factor * v_dot_E * vx;
                        Ey = gamma * (E_rest.y - cross_v_B_y) - factor * v_dot_E * vy;
                        Ez = gamma * (E_rest.z - cross_v_B_z) - factor * v_dot_E * vz;

                        Bx = gamma * (B_rest.x + cross_v_E_x) - factor * v_dot_B * vx;
                        By = gamma * (B_rest.y + cross_v_E_y) - factor * v_dot_B * vy;
                        Bz = gamma * (B_rest.z + cross_v_E_z) - factor * v_dot_B * vz;
                    }

                    // Add to buffer (accumulation allows spawning multiple interacting solitons)
                    buffer[idx + 0] += Ex; buffer[idx + 1] += Ey; buffer[idx + 2] += Ez;
                    buffer[idx + 4] += Bx; buffer[idx + 5] += By; buffer[idx + 6] += Bz;
                }
            }
        }

        return buffer;
    }

    private static calculateRanadaField(x: number, y: number, z: number, charge: number): { E: Vector3, B: Vector3 } {
        const r2 = x * x + y * y + z * z;
        const r2_plus_1 = r2 + 1.0;
        const r2_plus_1_sq = r2_plus_1 * r2_plus_1;
        const r2_plus_1_cube = r2_plus_1_sq * r2_plus_1;

        if (charge === 0) {
            // Simple Gaussian light pulse (transverse wave) propagating in z
            // E dot B = 0, so helicity is 0.
            const width = 2.0;
            const envelope = Math.exp(-r2 / width);
            return {
                E: { x: envelope * 4.0, y: 0, z: 0 },
                B: { x: 0, y: envelope * 4.0, z: 0 }
            };
        }

        const a = 1.5;

        // Flipping the sign here acts as flipping the topological charge/helicity
        const sgn = charge < 0 ? -1 : 1;

        const Bx = sgn * 4 * a * (2 * x * y - 2 * z) / r2_plus_1_cube;
        const By = sgn * 4 * a * (2 * y * z + 2 * x) / r2_plus_1_cube;
        const Bz = sgn * 4 * a * (1 - x * x - y * y + z * z) / r2_plus_1_cube;

        const Ex = 4 * a * (2 * x * z + 2 * y) / r2_plus_1_cube;
        const Ey = 4 * a * (2 * y * z - 2 * x) / r2_plus_1_cube;
        const Ez = 4 * a * (1 + x * x - y * y - z * z) / r2_plus_1_cube;

        return {
            E: { x: Ex, y: Ey, z: Ez },
            B: { x: Bx, y: By, z: Bz }
        };
    }
}
