<script lang="ts">
    import { onMount } from "svelte";
    import { slide } from "svelte/transition";
    import { initWebGPU } from "../lib/gpu/init";
    import { SimulatorEngine } from "../lib/gpu/engine";
    import CurveEditor from "../lib/components/CurveEditor.svelte";

    let canvas: HTMLCanvasElement;
    let engine: SimulatorEngine;
    let errorMsg = "";

    // UI State
    let isPlaying = true;
    let dt = 0.005; // Finer precision for small dx stability
    let dx = 0.1; // Finer spatial grid spacing
    let blend = 0.5; // Spatial smoothing weight
    let absorption = 0.95; // Raymarching transparency

    // UI Panels Collapsible State
    let showControls = true;
    let showVisuals = true;
    let showSpawner = true;

    let gridRes = 128; // Dynamic grid resolution control
    let isRebuilding = false; // Prevents render loop during async teardown
    let spawnVelocity = 0.5; // Relativistic momentum scaling (v=c is 1.0)

    // Visual Fall-off Curve
    let curvePoints = [
        { x: 0, y: 0 },
        { x: 0.3, y: 0.1 },
        { x: 0.6, y: 0.8 },
        { x: 1, y: 1 },
    ];

    $: if (engine && curvePoints) {
        engine.dt = dt;
        engine.dx = dx;
        engine.blend = blend;
        engine.absorption = absorption;
        engine.updateCurve(curvePoints);
    }

    async function initSimulation() {
        if (!canvas) return;
        isRebuilding = true;
        try {
            if (engine) engine.dispose();

            const { device, context, format } = await initWebGPU(canvas);

            engine = new SimulatorEngine(device, context, format, [
                gridRes,
                gridRes,
                gridRes,
            ]);
            await engine.init();

            engine.dt = dt;
            engine.dx = dx;
            engine.blend = blend;
            engine.absorption = absorption;
            engine.updateCurve(curvePoints);

            // Start with a head-on collision demo
            engine.clearGrid();
            engine.injectSolitons([
                {
                    scale: 0.08,
                    charge: -1,
                    offset: [-30, 0, 0],
                    velocity: [spawnVelocity, 0, 0],
                },
                {
                    scale: 0.08,
                    charge: -1,
                    offset: [30, 0, 0],
                    velocity: [-spawnVelocity, 0, 0],
                },
            ]);
            isRebuilding = false;
        } catch (err: any) {
            errorMsg = err.message || "Failed to initialize WebGPU";
            console.error(err);
            isRebuilding = false;
        }
    }

    onMount(() => {
        initSimulation().then(() => {
            function loop() {
                if (engine && !isRebuilding) {
                    const shouldCompute = isPlaying;
                    engine.step(shouldCompute);
                }
                requestAnimationFrame(loop);
            }
            loop();
        });
    });

    function applyResolution() {
        initSimulation();
    }

    function togglePlay() {
        isPlaying = !isPlaying;
    }

    function spawnElectron() {
        if (!engine) return;
        engine.clearGrid();
        engine.injectSolitons([
            {
                scale: 0.08,
                charge: -1,
                offset: [0, 0, 0],
                velocity: [0, 0, spawnVelocity],
            },
        ]);
    }

    function spawnPositron() {
        if (!engine) return;
        engine.clearGrid();
        engine.injectSolitons([
            {
                scale: 0.08,
                charge: 1,
                offset: [0, 0, 0],
                velocity: [0, 0, spawnVelocity],
            },
        ]);
    }

    function spawnPhoton() {
        if (!engine) return;
        engine.clearGrid();
        engine.injectSolitons([
            {
                scale: 0.1,
                charge: 0,
                offset: [0, 0, 0],
                velocity: [0, 0, spawnVelocity],
            },
        ]);
    }

    // Advanced Spawner
    let spawnScale = 0.08;
    let spawnCharge = 2; // Default to something cool like a double knot

    function spawnCustom() {
        if (!engine) return;
        engine.clearGrid();
        engine.injectSolitons([
            {
                scale: spawnScale,
                charge: spawnCharge,
                offset: [0, 0, 0],
                velocity: [0, 0, spawnVelocity],
            },
        ]);
    }

    // Camera Drag Controls
    let isDragging = false;
    let lastX = 0;
    let lastY = 0;

    function handlePointerDown(e: PointerEvent) {
        if (!engine) return;
        isDragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        canvas.setPointerCapture(e.pointerId);
    }

    function handlePointerMove(e: PointerEvent) {
        if (!isDragging || !engine) return;
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;

        // update engine rotations
        engine.camRotY -= dx * 0.005;
        engine.camRotX += dy * 0.005;

        // clamp pitch
        engine.camRotX = Math.max(
            -Math.PI / 2,
            Math.min(Math.PI / 2, engine.camRotX),
        );
    }

    function handlePointerUp(e: PointerEvent) {
        isDragging = false;
        canvas.releasePointerCapture(e.pointerId);
    }

    function handleWheel(e: WheelEvent) {
        if (!engine) return;
        engine.camDistance += e.deltaY * 0.005;
        engine.camDistance = Math.max(1.0, Math.min(10.0, engine.camDistance));
    }
</script>

<div class="simulator-container">
    {#if errorMsg}
        <div class="error">
            <p>{errorMsg}</p>
            <small>Requires a WebGPU-enabled browser.</small>
        </div>
    {:else}
        <canvas
            bind:this={canvas}
            on:pointerdown={handlePointerDown}
            on:pointermove={handlePointerMove}
            on:pointerup={handlePointerUp}
            on:pointercancel={handlePointerUp}
            on:wheel|preventDefault={handleWheel}
        ></canvas>

        <main class="dashboard">
            <header>
                <h1>SOLITON <span>ENGINE</span></h1>
                <p>Non-Linear Electromagnetic Hopfion Simulator</p>
            </header>

            <section class="panel">
                <button
                    class="panel-header"
                    on:click={() => (showControls = !showControls)}
                >
                    <h2>Physics Parameters</h2>
                    <span class="chevron" class:open={showControls}>▼</span>
                </button>
                {#if showControls}
                    <div class="panel-content flex-row" transition:slide>
                        <button
                            class={isPlaying ? "btn-active" : ""}
                            on:click={togglePlay}
                        >
                            {isPlaying ? "PAUSE" : "PLAY"}
                        </button>

                        <div class="slider-group">
                            <label for="dt"
                                >Time Step (dt): {dt.toFixed(4)}</label
                            >
                            <input
                                type="range"
                                id="dt"
                                min="0.0001"
                                max="0.05"
                                step="0.0001"
                                bind:value={dt}
                            />
                        </div>

                        <div class="slider-group">
                            <label for="dx"
                                >Grid Spacing (dx): {dx.toFixed(2)}</label
                            >
                            <input
                                type="range"
                                id="dx"
                                min="0.01"
                                max="2.0"
                                step="0.01"
                                bind:value={dx}
                            />
                        </div>

                        <div class="slider-group">
                            <label for="blend"
                                >LF Smoothing Blend: {blend.toFixed(2)}</label
                            >
                            <input
                                type="range"
                                id="blend"
                                min="0.0"
                                max="0.5"
                                step="0.01"
                                bind:value={blend}
                            />
                        </div>

                        <div class="slider-group mt-half">
                            <label for="gridRes"
                                >Grid Resolution: {gridRes}³</label
                            >
                            <div
                                style="display: flex; gap: 0.5rem; justify-content: space-between; align-items: center;"
                            >
                                <input
                                    type="range"
                                    id="gridRes"
                                    min="32"
                                    max="500"
                                    step="4"
                                    bind:value={gridRes}
                                />
                                <button
                                    on:click={applyResolution}
                                    style="padding: 0.4rem 0.6rem; font-size: 0.7rem; min-width: 60px;"
                                    >APPLY</button
                                >
                            </div>
                            <small
                                class="desc"
                                style="margin: 0; color: #ff5555; display: {gridRes >
                                256
                                    ? 'block'
                                    : 'none'};"
                                >Warning: >256 requires 1GB+ VRAM.</small
                            >
                        </div>
                    </div>
                {/if}
            </section>

            <section class="panel">
                <button
                    class="panel-header"
                    on:click={() => (showVisuals = !showVisuals)}
                >
                    <h2>Volumetric Rendering</h2>
                    <span class="chevron" class:open={showVisuals}>▼</span>
                </button>
                {#if showVisuals}
                    <div class="panel-content flex-row" transition:slide>
                        <CurveEditor
                            points={curvePoints}
                            onPointsChange={(p) => (curvePoints = p)}
                            label="Opacity Fall-Off Curve"
                        />

                        <div class="slider-group mt-half">
                            <label for="absorption"
                                >Base Gas Density: {absorption.toFixed(
                                    2,
                                )}</label
                            >
                            <input
                                type="range"
                                id="absorption"
                                min="0.0"
                                max="5.0"
                                step="0.05"
                                bind:value={absorption}
                            />
                        </div>
                    </div>
                {/if}
            </section>

            <section class="panel">
                <button
                    class="panel-header"
                    on:click={() => (showSpawner = !showSpawner)}
                >
                    <h2>Particle Spawner</h2>
                    <span class="chevron" class:open={showSpawner}>▼</span>
                </button>
                {#if showSpawner}
                    <div class="panel-content" transition:slide>
                        <p class="desc">
                            Injects a topological knot of electromagnetic energy
                            directly into the WebGPU 3D grid.
                        </p>
                        <div class="spawner-buttons">
                            <button
                                class="btn-spawn electron"
                                on:click={spawnElectron}
                                >Spawn Electron (H-)</button
                            >
                            <button
                                class="btn-spawn positron"
                                on:click={spawnPositron}
                                >Spawn Positron (H+)</button
                            >
                            <button
                                class="btn-spawn photon"
                                on:click={spawnPhoton}>Spawn Light Pulse</button
                            >
                        </div>

                        <hr class="divider" />
                        <h3>Advanced Generator</h3>
                        <div class="slider-group">
                            <label for="spawnScale"
                                >Knot Scale: {spawnScale.toFixed(2)}</label
                            >
                            <input
                                type="range"
                                id="spawnScale"
                                min="0.01"
                                max="0.30"
                                step="0.01"
                                bind:value={spawnScale}
                            />
                        </div>
                        <div class="slider-group mt-half">
                            <label for="spawnCharge"
                                >Topological Charge: {spawnCharge}</label
                            >
                            <input
                                type="range"
                                id="spawnCharge"
                                min="-5"
                                max="5"
                                step="1"
                                bind:value={spawnCharge}
                            />
                        </div>
                        <div class="slider-group mt-half">
                            <label for="spawnVelocity"
                                >Z-Axis Momentum (v/c): {spawnVelocity.toFixed(
                                    2,
                                )}</label
                            >
                            <input
                                type="range"
                                id="spawnVelocity"
                                min="0.0"
                                max="0.95"
                                step="0.01"
                                bind:value={spawnVelocity}
                            />
                        </div>
                        <div class="spawner-buttons mt-half">
                            <button
                                class="btn-spawn custom"
                                on:click={spawnCustom}
                                >Inject Custom Knot</button
                            >
                        </div>

                        <hr class="divider" />
                        <h3>Soliton Collision Simulator</h3>
                        <p class="desc">
                            Mathematically injects multiple opposing Hopfions
                            using linear superposition. The non-linear GPU
                            kernel will compute their interaction!
                        </p>
                        <div class="spawner-buttons">
                            <button
                                class="btn-spawn annihilation"
                                on:click={() => {
                                    if (!engine) return;
                                    engine.clearGrid();
                                    engine.injectSolitons([
                                        {
                                            scale: 0.08,
                                            charge: -1,
                                            offset: [0, 0, -35],
                                            velocity: [0, 0, spawnVelocity],
                                        },
                                        {
                                            scale: 0.08,
                                            charge: 1,
                                            offset: [0, 0, 35],
                                            velocity: [0, 0, -spawnVelocity],
                                        },
                                    ]);
                                }}>💥 Scatter: Annihilation</button
                            >
                            <button
                                class="btn-spawn repulsion"
                                on:click={() => {
                                    if (!engine) return;
                                    engine.clearGrid();
                                    engine.injectSolitons([
                                        {
                                            scale: 0.08,
                                            charge: -1,
                                            offset: [0, 0, -35],
                                            velocity: [0, 0, spawnVelocity],
                                        },
                                        {
                                            scale: 0.08,
                                            charge: -1,
                                            offset: [0, 0, 35],
                                            velocity: [0, 0, -spawnVelocity],
                                        },
                                    ]);
                                }}>💥 Scatter: Repulsion</button
                            >
                        </div>
                    </div>
                {/if}
            </section>
        </main>
    {/if}
</div>

<style>
    :global(body) {
        margin: 0;
        padding: 0;
        font-family:
            "Inter",
            system-ui,
            -apple-system,
            sans-serif;
        background: #050505;
        color: #fff;
        overflow: hidden;
    }

    .simulator-container {
        position: relative;
        width: 100vw;
        height: 100vh;
        display: flex;
    }

    canvas {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 0;
        background: radial-gradient(circle at center, #111 0%, #000 100%);
    }

    .dashboard {
        position: relative;
        z-index: 10;
        width: 320px;
        height: 100%;
        background: rgba(10, 10, 15, 0.4);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border-right: 1px solid rgba(255, 255, 255, 0.05);
        padding: 2rem;
        display: flex;
        flex-direction: column;
        gap: 1.25rem;
        box-shadow: 20px 0 50px rgba(0, 0, 0, 0.5);
        overflow-y: auto;
        overflow-x: hidden;
    }

    .dashboard::-webkit-scrollbar {
        width: 6px;
    }
    .dashboard::-webkit-scrollbar-track {
        background: transparent;
    }
    .dashboard::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.2);
        border-radius: 3px;
    }

    header h1 {
        margin: 0;
        font-size: 1.5rem;
        font-weight: 800;
        letter-spacing: 0.1em;
        background: linear-gradient(90deg, #fff, #555);
        background-clip: text;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
    }

    header h1 span {
        font-weight: 300;
    }

    header p {
        margin: 0.5rem 0 0 0;
        font-size: 0.75rem;
        color: rgba(255, 255, 255, 0.5);
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    .panel {
        background: rgba(255, 255, 255, 0.02);
        border: 1px solid rgba(255, 255, 255, 0.05);
        border-radius: 12px;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .panel-header {
        background: transparent;
        border: none;
        padding: 1.25rem 1.5rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
        width: 100%;
        cursor: pointer;
        text-align: left;
        color: inherit;
        border-radius: 0;
        text-transform: none;
        letter-spacing: normal;
        font-weight: inherit;
    }

    .panel-header:hover {
        background: rgba(255, 255, 255, 0.03);
        border-color: transparent;
        box-shadow: none;
    }

    .panel-header h2 {
        margin: 0;
        font-size: 0.85rem;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: rgba(255, 255, 255, 0.8);
    }

    .chevron {
        font-size: 0.65rem;
        color: rgba(255, 255, 255, 0.5);
        transition: transform 0.2s ease;
    }

    .chevron.open {
        transform: rotate(180deg);
    }

    .panel-content {
        padding: 0 1.5rem 1.5rem 1.5rem;
        display: flex;
        flex-direction: column;
    }

    .desc {
        font-size: 0.75rem;
        color: rgba(255, 255, 255, 0.4);
        margin-bottom: 1rem;
        line-height: 1.4;
    }

    .flex-row {
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    button {
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        color: white;
        padding: 0.75rem 1rem;
        border-radius: 8px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        font-size: 0.8rem;
    }

    button:hover {
        background: rgba(255, 255, 255, 0.1);
        border-color: rgba(255, 255, 255, 0.3);
        box-shadow: 0 0 15px rgba(255, 255, 255, 0.05);
    }

    button.btn-active {
        background: rgba(0, 255, 128, 0.1);
        border-color: rgba(0, 255, 128, 0.3);
        color: #00ff80;
        box-shadow: 0 0 20px rgba(0, 255, 128, 0.1);
    }

    .slider-group {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .slider-group label {
        font-size: 0.75rem;
        color: rgba(255, 255, 255, 0.6);
        display: flex;
        justify-content: space-between;
    }

    input[type="range"] {
        width: 100%;
        accent-color: #00ff80;
    }

    .spawner-buttons {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    .btn-spawn {
        text-align: left;
        padding-left: 2rem;
        position: relative;
    }

    .btn-spawn::before {
        content: "";
        position: absolute;
        left: 0.75rem;
        top: 50%;
        transform: translateY(-50%);
        width: 8px;
        height: 8px;
        border-radius: 50%;
    }

    .electron::before {
        background: #00d2ff;
        box-shadow: 0 0 12px #00d2ff;
    }
    .positron::before {
        background: #ff0055;
        box-shadow: 0 0 12px #ff0055;
    }
    .photon::before {
        background: #fff;
        box-shadow: 0 0 12px #fff;
    }
    .custom::before {
        background: #aa00ff;
        box-shadow: 0 0 12px #aa00ff;
    }

    .divider {
        border: 0;
        height: 1px;
        background: rgba(255, 255, 255, 0.1);
        margin: 1.5rem 0;
    }

    .panel h3 {
        margin: 0 0 1rem 0;
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: rgba(255, 255, 255, 0.6);
    }

    .mt-half {
        margin-top: 0.5rem;
    }

    .error {
        margin: auto;
        background: rgba(255, 0, 0, 0.1);
        border: 1px solid red;
        padding: 2rem;
        border-radius: 8px;
        text-align: center;
        z-index: 100;
        font-family: monospace;
    }
</style>
