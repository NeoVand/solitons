/**
 * High-End Electromagnetic Volume Raymarching Graphic Shader
 * Renders the 3D FDTD grid into the canvas with dynamic blooming energies.
 */

export const raymarchShader = `
struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
};

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    const pos = array<vec2f, 3>(
        vec2f(-1.0, -1.0),
        vec2f(3.0, -1.0),
        vec2f(-1.0, 3.0)
    );
    var output: VertexOutput;
    output.position = vec4f(pos[vertexIndex], 0.0, 1.0);
    output.uv = pos[vertexIndex];
    return output;
}

struct FieldData {
    E: vec3f,
    B: vec3f,
};

@group(0) @binding(0) var<storage, read> fields: array<FieldData>;

struct SimParams {
    gridSize: vec3u,
    pad: u32,
    dt: f32,
    dx: f32,
    blend: f32,
    absorption: f32,
}
@group(0) @binding(1) var<uniform> params: SimParams;

struct CameraParams {
    rotX: f32,
    rotY: f32,
    distance: f32,
    time: f32,
}
@group(0) @binding(2) var<uniform> camera: CameraParams;
@group(0) @binding(3) var curveTexture: texture_1d<f32>;

fn getIndex(pos: vec3u) -> u32 {
    let clmp = clamp(pos, vec3u(0u), params.gridSize - vec3u(1u));
    return clmp.x + clmp.y * params.gridSize.x + clmp.z * params.gridSize.x * params.gridSize.y;
}

// Trilinear interpolation for smooth glowing volumetric look
fn sampleGrid(p: vec3f) -> FieldData {
    let boxScale = 3.5;
    let normalizedP = (p / boxScale + 1.0) * 0.5; // Map [-3.5, 3.5] to [0, 1]
    let scaledP = normalizedP * vec3f(
        f32(params.gridSize.x - 1),
        f32(params.gridSize.y - 1),
        f32(params.gridSize.z - 1)
    );
    
    let base = vec3u(scaledP);
    let fract = scaledP - vec3f(base);
    
    // Sample 8 corners (simplified interpolation logic for performance limits)
    // Could do full trilinear, but nearest + a bit of jitter or smoothstep is faster.
    // For now, let's keep it near-neighbor for raw speed and rely on density accumulation for smoothness.
    
    return fields[getIndex(base)];
}

// Box intersection
fn iBox(ro: vec3f, rd: vec3f, boxShape: vec3f) -> vec2f {
    let m = 1.0 / rd;
    let n = m * ro;
    let k = abs(m) * boxShape;
    let t1 = -n - k;
    let t2 = -n + k;
    let tN = max(max(t1.x, t1.y), t1.z);
    let tF = min(min(t2.x, t2.y), t2.z);
    if (tN > tF || tF < 0.0) { return vec2f(-1.0); }
    return vec2f(max(tN, 0.0), tF);
}

// Color palettes for electromagnetic states
fn getParticleColor(energy: f32, helicity: f32) -> vec3f {
    // E dot B (helicity approx)
    // Negative = Electron (Cyan/Blue)
    // Positive = Positron (Red/Magenta)
    // Zero = Photon/Light (White/Yellow)
    
    let electronColor = vec3f(0.0, 0.8, 1.0);
    let positronColor = vec3f(1.0, 0.1, 0.4);
    let lightColor = vec3f(1.0, 0.9, 0.7);

    let mixFactor = clamp(helicity * 50.0, -1.0, 1.0);
    
    var baseColor = lightColor;
    if (mixFactor < 0.0) {
        baseColor = mix(lightColor, electronColor, -mixFactor);
    } else {
        baseColor = mix(lightColor, positronColor, mixFactor);
    }
    
    return baseColor * energy;
}

fn rotX(v: vec3f, a: f32) -> vec3f {
    let s = sin(a); let c = cos(a);
    return vec3f(v.x, v.y * c - v.z * s, v.y * s + v.z * c);
}
fn rotY(v: vec3f, a: f32) -> vec3f {
    let s = sin(a); let c = cos(a);
    return vec3f(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
    // Interactive Camera Matrix
    let final_rot_y = camera.rotY + camera.time * 0.2; // Slow auto-orbit + user input
    let final_rot_x = camera.rotX;
    
    // Fix aspect ratio distortion making the mathematical ray miss the target volume
    // Hack: assume roughly 16:9 for a typical full-screen canvas
    let uvFixed = vec2f(input.uv.x * 1.77, input.uv.y); 
    
    // Scale FOV roughly with distance
    var ro = vec3f(uvFixed.x * (camera.distance * 0.7), uvFixed.y * (camera.distance * 0.7), -camera.distance);
    var rd = normalize(vec3f(0.0, 0.0, 1.0));
    
    // Apply pitch and yaw
    ro = rotX(ro, final_rot_x);
    ro = rotY(ro, final_rot_y);
    rd = rotX(rd, final_rot_x);
    rd = rotY(rd, final_rot_y);

    let roR = ro;
    let rdR = rd;

    let boxScale = 3.5;
    let hit = iBox(roR, rdR, vec3f(boxScale)); // Expanded bounding box for wide views
    
    var col = vec3f(0.0);
    
    if (hit.y > 0.0) {
        var tRay = hit.x;
        let tMax = hit.y;
        let numSteps = 120u;
        let stepSize = (tMax - tRay) / f32(numSteps);
        
        var accumColor = vec3f(0.0);
        let absorption = params.absorption;  
        
        for (var i = 0u; i < numSteps; i++) {
            let p = roR + rdR * tRay;
            let field = sampleGrid(p);
            
            // Energy Density  E^2 + B^2
            let energy = (dot(field.E, field.E) + dot(field.B, field.B));
            
            // Topological Helicity E dot B
            let helicity = dot(field.E, field.B);
            
            if (energy > 0.00) { 
                // Look up user-defined visual fall-off curve using normalized E^2 bounding
                // We map energy [0 ... max_expected] to the [0 ... 1] texture coordinates
                // We'll assume a max energy around 2.0 based on the current knot generation
                let u = clamp(energy * 0.5, 0.0, 1.0);
                
                // textureLoad takes an integer index, bypassing samplers which aren't supported for r32float
                let texCoord = min(u32(u * 255.0), 255u);
                let glowFalloff = textureLoad(curveTexture, texCoord, 0).r;
                
                let sampleColor = getParticleColor(energy * 2.0, helicity);
                
                // The curve editor defines the alpha/density multiplier at that specific energy intensity
                accumColor += sampleColor * glowFalloff * exp(-length(accumColor) * absorption);
            }
            
            tRay += stepSize;
        }
        
        // Tone mapping (ACES approx)
        col = (accumColor * (2.51 * accumColor + 0.03)) / (accumColor * (2.43 * accumColor + 0.59) + 0.14);
    }
    
    // Vignette
    let uv2 = input.uv;
    col *= 1.0 - dot(uv2, uv2) * 0.3;
    
    return vec4f(col, 1.0);
}
`;
