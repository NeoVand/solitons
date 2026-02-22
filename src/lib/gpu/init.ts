/**
 * WebGPU initialization utilities
 */

export async function initWebGPU(canvas: HTMLCanvasElement): Promise<{
    device: GPUDevice;
    context: GPUCanvasContext;
    format: GPUTextureFormat;
}> {
    if (!navigator.gpu) {
        throw new Error("WebGPU not supported on this browser.");
    }

    const adapter = await navigator.gpu.requestAdapter({
        powerPreference: "high-performance"
    });

    if (!adapter) {
        throw new Error("No appropriate GPUAdapter found.");
    }

    // Require high limits for our 3D grid compute shaders
    const device = await adapter.requestDevice({
        requiredFeatures: ["float32-filterable"], // Allows sampling f32 textures in some rendering
        requiredLimits: {
            maxComputeWorkgroupStorageSize: 32768,
            maxComputeWorkgroupsPerDimension: 65535,
            maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
            maxBufferSize: adapter.limits.maxBufferSize
        }
    });

    const context = canvas.getContext("webgpu") as GPUCanvasContext;
    if (!context) {
        throw new Error("Failed to get WebGPU context from canvas.");
    }

    const format = navigator.gpu.getPreferredCanvasFormat();

    context.configure({
        device,
        format,
        alphaMode: "premultiplied",
    });

    return { device, context, format };
}
