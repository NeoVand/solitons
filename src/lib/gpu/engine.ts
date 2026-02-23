/// <reference types="@webgpu/types" />

import { fdtdComputeShader } from './shaders/compute';
import { raymarchShader } from './shaders/render';
import { HopfionGenerator } from '../math/hopfion';
import { monotonicCubicInterpolation } from '../stores/simulation';

export class SimulatorEngine {
    device: GPUDevice;
    context: GPUCanvasContext;
    format: GPUTextureFormat;

    gridSize: [number, number, number];
    fieldBufferA!: GPUBuffer;
    fieldBufferB!: GPUBuffer;
    paramsBuffer!: GPUBuffer;
    cameraBuffer!: GPUBuffer;
    curveTexture!: GPUTexture;

    computePipeline!: GPUComputePipeline;
    renderPipeline!: GPURenderPipeline;

    computeBindGroupA!: GPUBindGroup;
    computeBindGroupB!: GPUBindGroup;
    renderBindGroupA!: GPUBindGroup;
    renderBindGroupB!: GPUBindGroup;

    pingpong = false;
    time = 0;

    // Interactive Camera controls
    camRotX = 0;
    camRotY = 0;
    camDistance = 3.5;

    // Physics & Visual Parameters
    dt = 0.05;
    dx = 1.0;
    blend = 0.5;
    absorption = 0.95;

    constructor(device: GPUDevice, context: GPUCanvasContext, format: GPUTextureFormat, gridSize: [number, number, number] = [64, 64, 64]) {
        this.device = device;
        this.context = context;
        this.format = format;
        this.gridSize = gridSize;
    }

    async init() {
        const numVoxels = this.gridSize[0] * this.gridSize[1] * this.gridSize[2];
        const bytesPerVoxel = (3 + 3 + 2) * 4;
        const bufferSize = numVoxels * bytesPerVoxel;

        this.fieldBufferA = this.device.createBuffer({
            size: bufferSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
        });
        this.fieldBufferB = this.device.createBuffer({
            size: bufferSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
        });

        // Blank slate initially, wait for UI to inject
        const emptyData = new Float32Array(numVoxels * 8);
        this.device.queue.writeBuffer(this.fieldBufferA, 0, emptyData);
        this.device.queue.writeBuffer(this.fieldBufferB, 0, emptyData);

        this.paramsBuffer = this.device.createBuffer({
            size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        const paramsData = new ArrayBuffer(32);
        const paramsViewU32 = new Uint32Array(paramsData);
        paramsViewU32[0] = this.gridSize[0];
        paramsViewU32[1] = this.gridSize[1];
        paramsViewU32[2] = this.gridSize[2];
        paramsViewU32[3] = 0; // padding for vec3u -> 16 bytes alignment

        // Let updateParams write the rest
        this.device.queue.writeBuffer(this.paramsBuffer, 0, paramsData);
        this.updateParams();

        this.cameraBuffer = this.device.createBuffer({
            size: 80,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        // 1D Texture for the Falloff Curve Lookup Table
        this.curveTexture = this.device.createTexture({
            size: [256, 1, 1],
            dimension: '1d',
            format: 'r32float',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
        });

        const computeModule = this.device.createShaderModule({ code: fdtdComputeShader });
        this.computePipeline = await this.device.createComputePipelineAsync({
            layout: "auto",
            compute: { module: computeModule, entryPoint: "main" }
        });

        this.computeBindGroupA = this.device.createBindGroup({
            layout: this.computePipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: this.fieldBufferA } }, { binding: 1, resource: { buffer: this.fieldBufferB } }, { binding: 2, resource: { buffer: this.paramsBuffer } }]
        });

        this.computeBindGroupB = this.device.createBindGroup({
            layout: this.computePipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: this.fieldBufferB } }, { binding: 1, resource: { buffer: this.fieldBufferA } }, { binding: 2, resource: { buffer: this.paramsBuffer } }]
        });

        const renderModule = this.device.createShaderModule({ code: raymarchShader });
        this.renderPipeline = await this.device.createRenderPipelineAsync({
            layout: "auto",
            vertex: { module: renderModule, entryPoint: "vertexMain" },
            fragment: { module: renderModule, entryPoint: "fragmentMain", targets: [{ format: this.format }] },
            primitive: { topology: "triangle-list" }
        });

        this.renderBindGroupA = this.device.createBindGroup({
            layout: this.renderPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.fieldBufferA } },
                { binding: 1, resource: { buffer: this.paramsBuffer } },
                { binding: 2, resource: { buffer: this.cameraBuffer } },
                { binding: 3, resource: this.curveTexture.createView({ dimension: '1d' }) }
            ]
        });

        this.renderBindGroupB = this.device.createBindGroup({
            layout: this.renderPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.fieldBufferB } },
                { binding: 1, resource: { buffer: this.paramsBuffer } },
                { binding: 2, resource: { buffer: this.cameraBuffer } },
                { binding: 3, resource: this.curveTexture.createView({ dimension: '1d' }) }
            ]
        });
    }

    /**
     * Clears the grid explicitly.
     */
    clearGrid() {
        const numVoxels = this.gridSize[0] * this.gridSize[1] * this.gridSize[2];
        const emptyData = new Float32Array(numVoxels * 8);
        this.device.queue.writeBuffer(this.fieldBufferA, 0, emptyData);
        this.device.queue.writeBuffer(this.fieldBufferB, 0, emptyData);
    }

    /**
     * Injects multiple Hopfions (solitons) into the grid, accurately accumulating their fields.
     */
    injectSolitons(solitons: { scale: number, charge: number, offset: [number, number, number], velocity: [number, number, number] }[]) {
        if (solitons.length === 0) return;

        const numVoxels = this.gridSize[0] * this.gridSize[1] * this.gridSize[2];
        let combinedBuffer = new Float32Array(numVoxels * 8);

        // Accumulate exactly (linear superposition applies strictly to generating fields before FDTD processing)
        for (const sol of solitons) {
            combinedBuffer = HopfionGenerator.generateFieldBuffer(
                this.gridSize,
                sol.scale,
                sol.charge,
                sol.offset,
                sol.velocity,
                combinedBuffer
            );
        }

        // Write to both buffers so the compute shader doesn't overwrite it with empty history on frame 1
        this.device.queue.writeBuffer(this.fieldBufferA, 0, combinedBuffer);
        this.device.queue.writeBuffer(this.fieldBufferB, 0, combinedBuffer);
    }

    /**
     * Legacy helper to inject a single stationary central soliton.
     */
    injectSoliton(scale: number = 0.2, chargeType: number = -1) {
        this.injectSolitons([{
            scale: scale,
            charge: chargeType,
            offset: [0, 0, 0],
            velocity: [0, 0, 0]
        }]);
    }

    updateCamera() {
        this.time += 0.01;
        const camData = new ArrayBuffer(80);
        const camView = new Float32Array(camData);

        // We pack the transformation data:
        // camView[0..15] = placeholder view matrix (or rotation angles)
        // Let's pass the Euler angles and distance directly, WGSL will rotate the rays
        camView[0] = this.camRotX;
        camView[1] = this.camRotY;
        camView[2] = this.camDistance;
        camView[3] = this.time;

        this.device.queue.writeBuffer(this.cameraBuffer, 0, camData);
    }

    updateCurve(points: { x: number; y: number }[]) {
        if (!this.curveTexture) return;

        const resolution = 256;
        const curveData = new Float32Array(resolution);

        for (let i = 0; i < resolution; i++) {
            const x = i / (resolution - 1);
            curveData[i] = monotonicCubicInterpolation(points, x);
        }

        this.device.queue.writeTexture(
            { texture: this.curveTexture },
            curveData,
            { bytesPerRow: resolution * 4, rowsPerImage: 1 },
            [resolution, 1, 1]
        );
    }

    updateParams() {
        // Write the dynamic float properties into the second half of paramsBuffer (offset 16 bytes)
        const floatData = new Float32Array([this.dt, this.dx, this.blend, this.absorption]);
        this.device.queue.writeBuffer(this.paramsBuffer, 16, floatData);
    }

    step(shouldCompute: boolean = true) {
        this.updateParams();
        this.updateCamera();
        const commandEncoder = this.device.createCommandEncoder();

        if (shouldCompute) {
            const computePass = commandEncoder.beginComputePass();
            computePass.setPipeline(this.computePipeline);
            computePass.setBindGroup(0, this.pingpong ? this.computeBindGroupB : this.computeBindGroupA);
            const workgroupSize = 4;
            computePass.dispatchWorkgroups(
                Math.ceil(this.gridSize[0] / workgroupSize),
                Math.ceil(this.gridSize[1] / workgroupSize),
                Math.ceil(this.gridSize[2] / workgroupSize)
            );
            computePass.end();
            this.pingpong = !this.pingpong;
        }

        const textureView = this.context.getCurrentTexture().createView();
        const renderPass = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: textureView,
                clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                loadOp: 'clear',
                storeOp: 'store'
            }]
        });

        renderPass.setPipeline(this.renderPipeline);
        renderPass.setBindGroup(0, this.pingpong ? this.renderBindGroupB : this.renderBindGroupA);
        renderPass.draw(3);
        renderPass.end();

        this.device.queue.submit([commandEncoder.finish()]);
    }

    dispose() {
        if (this.fieldBufferA) this.fieldBufferA.destroy();
        if (this.fieldBufferB) this.fieldBufferB.destroy();
        if (this.paramsBuffer) this.paramsBuffer.destroy();
        if (this.cameraBuffer) this.cameraBuffer.destroy();
        if (this.curveTexture) this.curveTexture.destroy();
    }
}
