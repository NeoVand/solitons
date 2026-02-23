# Soliton Engine

**Non-Linear Electromagnetic Hopfion Simulator**

A high-performance, real-time 3D physics engine and volumetric renderer built entirely in the browser using WebGPU and Svelte. This project simulates the propagation and interaction of localized electromagnetic energy knots (topological solitons or "Hopfions") based on non-linear extensions of Maxwell's equations (inspired by the Rañada model).

## Features

### ⚡ Core Physics Engine (WebGPU)
- **FDTD Simulation:** Uses the Finite-Difference Time-Domain method to numerically integrate non-linear Maxwell's equations.
- **Unconditional Stability:** Implements Lax-Friedrichs style spatial smoothing to prevent numerical divergence and checkerboarding artifacts at high resolutions.
- **Dynamic Grid Resolution:** Capable of hot-swapping the 3D grid resolution dynamically, from a fast $32^3$ up to an extreme $500^3$ (depending on available hardware VRAM limits up to 4GB+).
- **Ping-Pong Compute:** Utilizes dual `$E$` and `$B$` field and dual `$D$` and `$H$` field WebGPU `GPUBuffer` storage arrays to eliminate race conditions during temporal Euler integration.

### 🎨 Volumetric Rendering Pipeline
- **Volume Raymarching:** Casts rays through the 3D physics grid, integrating optical density and color based on localized electromagnetic tensor energies ($E^2 + B^2$).
- **Topological Color Mapping:** Colors the volumetric gas dynamically based on Topological Helicity ($E \cdot B$). Electrons ($H^-$) glow cyan, while Positrons ($H^+$) glow magenta. Light pulses ($H^0$) glow yellow.
- **Exact Trilinear Interpolation:** The rendering WGSL shader performs real-time 8-tap fractional `mix` weighting over all 8 voxel corners, completely eliminating "Minecraft" blocky artifacts and ensuring ultra-smooth, photo-realistic optical volumes regardless of camera zoom or grid spacing.

### UI & Interaction (Svelte)
- **Interactive Dashboard:** A sleek, premium dashboard built with Svelte, featuring smooth scrolling and collapsible accordion panels.
- **Dynamic Fall-Off Curve Editor:** An interactive SVG spline curve that allows users to map energy intensity to opacity non-linearly. The CPU interpolates the spline into a 256-byte `Float32Array` which is loaded directly into the WebGPU texture fetch (`textureLoad()`), bypassing strict `TextureSampler` hardware limitations completely.
- **Live Parameter Controls:** Sliders to adjust Time Step ($dt$), Grid Spacing ($dx$), Smoothing Blend, and Base Gas Density in real-time.
- **Particle Spawner:** Buttons to instantly inject canonical topological knots (Electrons, Positrons, Light).
- **Advanced Generator:** Sliders to customize knot scale and topological charge (winding number) for exotic physics exploration.
- **Interactive Camera:** Click and drag to orbit the 3D volume, use the scroll wheel to zoom in and out.

## System Architecture

The project cleanly separates the lightweight UI frontend from the heavy, VRAM-intensive physics pipelines.

```mermaid
graph TD
    subclassDef svelte fill:#f43f5e,stroke:#fff,stroke-width:2px,color:#fff;
    subclassDef js fill:#facc15,stroke:#fff,stroke-width:2px,color:#000;
    subclassDef webgpu fill:#3b82f6,stroke:#fff,stroke-width:2px,color:#fff;

    UI[Svelte UI Dashboard]:::svelte --> |Parameters dt/dx| Engine[SimulatorEngine `engine.ts`]:::js
    UI --> |Opacity Fall-Off SVG| Curve[Curve Interpolator]:::js
    UI --> |Velocity & Scale| Hopfion[HopfionGenerator `hopfion.ts`]:::js
    
    Curve --> |Float32Array| Tex1D[(Curve Texture 1D)]:::webgpu
    Hopfion --> |Lorentz Transformed Tensors| CPUBuffer[Combined CPU Field Buffer]:::js
    
    CPUBuffer --> |Queue Write| GPUTensorA[(GPU Field Buffer A)]:::webgpu
    CPUBuffer --> |Queue Write| GPUTensorB[(GPU Field Buffer B)]:::webgpu
    
    GPUTensorA <--> |Ping-Pong FDTD| ComputeShader[WGSL `compute.ts`]:::webgpu
    GPUTensorB <--> |Ping-Pong FDTD| ComputeShader
    Engine --> |Dispatch Workgroups| ComputeShader
    
    ComputeShader --> |Volumetric State| RenderShader[WGSL `render.ts`]:::webgpu
    Tex1D --> |Density Mapping| RenderShader
    Engine --> |Camera Matrix| RenderShader
    
    RenderShader --> Canvas[HTML5 Canvas Visualization]:::svelte
```

## Mathematics: Topology & FDTD

Standard textbook electromagnetism (linear Maxwell equations) cannot support stable, localized "knots" of energy propagating through a vacuum without dispersing. To simulate these particles (solitons), this engine utilizes a non-linear formulation inspired by Antonio Rañada's work. 

### 1. The Rañada Hopfion (Rest Frame)
The fields are constructed using a pair of complex scalar fields $(\phi, \theta)$ mapped stereographically to the 3D grid, creating a Hopf fibration. This ensures the electromagnetic field lines ($E$ and $B$) are topologically linked and knotted.

Given spatial coordinates normalized by an envelope scale $a$, the core rest-frame fields for a unit charge ($H^-$ electron) are:
$$ B_x = -4a \frac{2xy - 2z}{(r^2 + 1)^3}, \quad B_y = -4a \frac{2yz + 2x}{(r^2 + 1)^3}, \quad B_z = -4a \frac{1 - x^2 - y^2 + z^2}{(r^2 + 1)^3} $$
$$ E_x = 4a \frac{2xz + 2y}{(r^2 + 1)^3}, \quad E_y = 4a \frac{2yz - 2x}{(r^2 + 1)^3}, \quad E_z = 4a \frac{1 + x^2 - y^2 - z^2}{(r^2 + 1)^3} $$

### 2. Relativistic Lorentz Boosts
To simulate particle scattering, we must inject true momentum into the fields before they reach the GPU. We parameterize a velocity vector $\mathbf{v}$ and calculate the Lorentz factor:
$$ \gamma = \frac{1}{\sqrt{1 - |\mathbf{v}|^2}} $$

First, spatial length contraction is applied along the axis of motion:
$$ \mathbf{r}' = \mathbf{r} + (\gamma - 1)\frac{\mathbf{r} \cdot \mathbf{v}}{|\mathbf{v}|^2} \mathbf{v} $$

Then, the static rest fields are relativistically transformed into the laboratory frame so their Poynting vector inherently models the structural momentum:
$$ \mathbf{E}_{lab} = \gamma (\mathbf{E}_{rest} - \mathbf{v} \times \mathbf{B}_{rest}) - (\gamma - 1) \frac{\mathbf{v} \cdot \mathbf{E}_{rest}}{|\mathbf{v}|^2} \mathbf{v} $$
$$ \mathbf{B}_{lab} = \gamma (\mathbf{B}_{rest} + \mathbf{v} \times \mathbf{E}_{rest}) - (\gamma - 1) \frac{\mathbf{v} \cdot \mathbf{B}_{rest}}{|\mathbf{v}|^2} \mathbf{v} $$

### 3. FDTD Numerical Integration
Once the initial fields are loaded into the WebGPU buffer, the `compute.ts` shader iteratively solves Faraday's and Ampere's laws across millions of voxels in parallel:

$$ \frac{\partial \mathbf{B}}{\partial t} = -\nabla \times \mathbf{E} $$
$$ \frac{\partial \mathbf{E}}{\partial t} = \nabla \times \mathbf{B} $$

To ensure unconditional stability at extreme energy topologies without numerical checkerboard divergence, we apply a **Lax-Friedrichs spatial smoothing** blend over the immediate $3^3$ Moore neighborhood:
$$ \mathbf{E}_{smoothed} = \mathbf{E}_{cell} \cdot (1 - \text{blend}) + \mathbf{E}_{avg\_neighbors} \cdot \text{blend} $$

## Running the Project

Ensure you are using a modern, WebGPU-enabled browser (Chrome, Edge Canary, etc.).

\`\`\`bash
npm install
npm run dev
\`\`\`

Open your browser to the local server address provided (usually `http://localhost:5173`). Have fun exploring the physics!
