/**
 * WebGPU Compute Shader for Electromagnetic FDTD
 * This implements the core wave propagation.
 * To support Solitons/Hopfions, we need non-linear equations. 
 * We will start with a placeholder structure that can be extended.
 */

export const fdtdComputeShader = `
struct FieldData {
    E: vec3f, // Electric field
    B: vec3f, // Magnetic field
};

@group(0) @binding(0) var<storage, read_write> fields: array<FieldData>;
// We need a secondary buffer to ping-pong the state
@group(0) @binding(1) var<storage, read> fieldsOld: array<FieldData>;

struct SimParams {
    gridSize: vec3u,
    pad: u32,
    dt: f32, // Time step
    dx: f32, // Spatial step
    blend: f32,
    absorption: f32,
}
@group(0) @binding(2) var<uniform> params: SimParams;

// Helper to get 1D index from 3D coordinates
fn getIndex(x: i32, y: i32, z: i32) -> u32 {
    // Absorbing boundary logic: clamp to edge for finite differences
    let cx = u32(clamp(x, 0, i32(params.gridSize.x) - 1));
    let cy = u32(clamp(y, 0, i32(params.gridSize.y) - 1));
    let cz = u32(clamp(z, 0, i32(params.gridSize.z) - 1));
    return cx + cy * params.gridSize.x + cz * params.gridSize.x * params.gridSize.y;
}

fn getField(x: i32, y: i32, z: i32) -> FieldData {
    return fieldsOld[getIndex(x, y, z)];
}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) id: vec3u) {
    if (id.x >= params.gridSize.x || id.y >= params.gridSize.y || id.z >= params.gridSize.z) {
        return; // Out of bounds
    }

    let x = i32(id.x);
    let y = i32(id.y);
    let z = i32(id.z);
    let idx = getIndex(x, y, z);
    
    // Fetch neighbors
    let fx_p = getField(x + 1, y, z);
    let fx_m = getField(x - 1, y, z);
    let fy_p = getField(x, y + 1, z);
    let fy_m = getField(x, y - 1, z);
    let fz_p = getField(x, y, z + 1);
    let fz_m = getField(x, y, z - 1);

    // Compute curl E
    // curlE.x = dEz/dy - dEy/dz
    let curlE_x = (fy_p.E.z - fy_m.E.z) / (2.0 * params.dx) - (fz_p.E.y - fz_m.E.y) / (2.0 * params.dx);
    let curlE_y = (fz_p.E.x - fz_m.E.x) / (2.0 * params.dx) - (fx_p.E.z - fx_m.E.z) / (2.0 * params.dx);
    let curlE_z = (fx_p.E.y - fx_m.E.y) / (2.0 * params.dx) - (fy_p.E.x - fy_m.E.x) / (2.0 * params.dx);
    let curlE = vec3f(curlE_x, curlE_y, curlE_z);

    // Compute curl B
    // curlB.x = dBz/dy - dBy/dz
    let curlB_x = (fy_p.B.z - fy_m.B.z) / (2.0 * params.dx) - (fz_p.B.y - fz_m.B.y) / (2.0 * params.dx);
    let curlB_y = (fz_p.B.x - fz_m.B.x) / (2.0 * params.dx) - (fx_p.B.z - fx_m.B.z) / (2.0 * params.dx);
    let curlB_z = (fx_p.B.y - fx_m.B.y) / (2.0 * params.dx) - (fy_p.B.x - fy_m.B.x) / (2.0 * params.dx);
    let curlB = vec3f(curlB_x, curlB_y, curlB_z);

    // Damping to simulate open boundaries (simple absorbing layer approximation)
    let b_dist_x = min(f32(id.x), f32(params.gridSize.x - 1u - id.x));
    let b_dist_y = min(f32(id.y), f32(params.gridSize.y - 1u - id.y));
    let b_dist_z = min(f32(id.z), f32(params.gridSize.z - 1u - id.z));
    let b_dist = min(min(b_dist_x, b_dist_y), b_dist_z);
    
    // Ramp down fields near the edge to prevent reflection
    var damp = 1.0;
    let margin = 4.0;
    if (b_dist < margin) {
        damp = b_dist / margin;
    }

    var currentField = fieldsOld[idx];
    
    // Lax-Friedrichs style spatial smoothing to prevent collocated grid checkerboarding 
    // and stabilize the Forward Euler integration.
    // E_avg is the average of 6 neighbors in 3D.
    let E_avg = (fx_p.E + fx_m.E + fy_p.E + fy_m.E + fz_p.E + fz_m.E) / 6.0;
    let B_avg = (fx_p.B + fx_m.B + fy_p.B + fy_m.B + fz_p.B + fz_m.B) / 6.0;

    // Blend E_old and E_avg. 
    // Increased blend to 0.5 to aggressively damp the highest-frequency (pixel-level)
    // Blend E_old and E_avg using the uniform passed from the GUI slider.
    let blend = params.blend; 
    let E_smoothed = mix(currentField.E, E_avg, blend);
    let B_smoothed = mix(currentField.B, B_avg, blend);

    // Classic Maxwell FDTD updates
    // dE/dt = curl(B) => E_new = E_smoothed + dt * curl(B)
    // dB/dt = -curl(E) => B_new = B_smoothed - dt * curl(E)
    currentField.E = (E_smoothed + params.dt * curlB) * damp;
    currentField.B = (B_smoothed - params.dt * curlE) * damp;

    // Write back
    fields[idx] = currentField;
}
`;
