export interface Vector3 {
    x: number; y: number; z: number;
}

export class HopfionGenerator {
    static generateFieldBuffer(gridSize: [number, number, number], scale: number = 1.0, charge: number = -1): Float32Array {
        const [nx, ny, nz] = gridSize;
        const numVoxels = nx * ny * nz;
        const buffer = new Float32Array(numVoxels * 8);

        const cx = nx / 2;
        const cy = ny / 2;
        const cz = nz / 2;

        for (let z = 0; z < nz; z++) {
            for (let y = 0; y < ny; y++) {
                for (let x = 0; x < nx; x++) {
                    const idx = (x + y * nx + z * nx * ny) * 8;

                    const px = (x - cx) * scale;
                    const py = (y - cy) * scale;
                    const pz = (z - cz) * scale;

                    const { E, B } = this.calculateRanadaField(px, py, pz, charge);

                    buffer[idx + 0] = E.x; buffer[idx + 1] = E.y; buffer[idx + 2] = E.z;
                    buffer[idx + 4] = B.x; buffer[idx + 5] = B.y; buffer[idx + 6] = B.z;
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
