<script lang="ts">
    import {
        type CurvePoint,
        monotonicCubicInterpolation,
    } from "../stores/simulation";

    // Props
    interface Props {
        points: CurvePoint[];
        onPointsChange: (points: CurvePoint[]) => void;
        label?: string;
    }

    let { points, onPointsChange, label = "Fall-Off Curve" }: Props = $props();

    // SVG dimensions
    const width = 220;
    const height = 120;
    const padding = { top: 10, right: 4, bottom: 18, left: 4 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;

    // Visual inset for points
    const visualInset = 6;

    // State
    let svgElement: SVGSVGElement | null = $state(null);
    let draggingIndex: number | null = $state(null);
    let hoverIndex: number | null = $state(null);

    // Coordinate conversions with visual inset
    function toSvgX(x: number): number {
        const innerWidth = plotWidth - visualInset * 2;
        return padding.left + visualInset + x * innerWidth;
    }

    function toSvgY(y: number): number {
        const innerHeight = plotHeight - visualInset * 2;
        return padding.top + visualInset + (1 - y) * innerHeight;
    }

    function fromSvgX(svgX: number): number {
        const innerWidth = plotWidth - visualInset * 2;
        return Math.max(
            0,
            Math.min(1, (svgX - padding.left - visualInset) / innerWidth),
        );
    }

    function fromSvgY(svgY: number): number {
        const innerHeight = plotHeight - visualInset * 2;
        return Math.max(
            0,
            Math.min(1, 1 - (svgY - padding.top - visualInset) / innerHeight),
        );
    }

    function isAnchorX(index: number): boolean {
        const p = points[index];
        return p.x === 0 || p.x === 1;
    }

    // Generate curve path using monotonic cubic interpolation
    function getCurvePath(): string {
        if (points.length < 2) return "";

        const samples = 50;
        let path = "";

        for (let i = 0; i <= samples; i++) {
            const x = i / samples;
            const y = monotonicCubicInterpolation(points, x);
            const svgX = toSvgX(x);
            const svgY = toSvgY(y);

            if (i === 0) {
                path = `M ${svgX} ${svgY}`;
            } else {
                path += ` L ${svgX} ${svgY}`;
            }
        }

        return path;
    }

    // Generate filled area path
    function getFillPath(): string {
        if (points.length < 2) return "";

        const samples = 50;
        let path = "";
        const bottomY = toSvgY(0);

        // Start at bottom-left
        path = `M ${toSvgX(0)} ${bottomY}`;

        // Draw curve
        for (let i = 0; i <= samples; i++) {
            const x = i / samples;
            const y = monotonicCubicInterpolation(points, x);
            path += ` L ${toSvgX(x)} ${toSvgY(y)}`;
        }

        // Close to bottom-right and back
        path += ` L ${toSvgX(1)} ${bottomY} Z`;

        return path;
    }

    function updateDragPosition(clientX: number, clientY: number) {
        if (draggingIndex === null || !svgElement) return;

        const rect = svgElement.getBoundingClientRect();
        const scaleX = width / rect.width;
        const scaleY = height / rect.height;

        const svgX = (clientX - rect.left) * scaleX;
        const svgY = (clientY - rect.top) * scaleY;

        let newX = fromSvgX(svgX);
        const newY = fromSvgY(svgY);

        // Sort points to find neighbors
        const sortedWithIndex = points
            .map((p, i) => ({ ...p, originalIndex: i }))
            .sort((a, b) => a.x - b.x);
        const sortedPos = sortedWithIndex.findIndex(
            (p) => p.originalIndex === draggingIndex,
        );

        // Constrain X to not cross neighbors (except for anchor points)
        if (!isAnchorX(draggingIndex)) {
            const prevPoint =
                sortedPos > 0 ? sortedWithIndex[sortedPos - 1] : null;
            const nextPoint =
                sortedPos < sortedWithIndex.length - 1
                    ? sortedWithIndex[sortedPos + 1]
                    : null;

            const minX = prevPoint ? prevPoint.x + 0.02 : 0.02;
            const maxX = nextPoint ? nextPoint.x - 0.02 : 0.98;
            newX = Math.max(minX, Math.min(maxX, newX));
        } else {
            // Anchor points can only move vertically
            newX = points[draggingIndex].x;
        }

        const newPoints = [...points];
        newPoints[draggingIndex] = { x: newX, y: newY };
        onPointsChange(newPoints);
    }

    function handlePointMouseDown(index: number, e: MouseEvent) {
        e.preventDefault();
        e.stopPropagation();
        draggingIndex = index;
        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);
    }

    function handleMouseMove(e: MouseEvent) {
        updateDragPosition(e.clientX, e.clientY);
    }

    function handleMouseUp() {
        draggingIndex = null;
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
    }

    function handleSvgInteraction(clientX: number, clientY: number) {
        if (!svgElement) return false;

        const rect = svgElement.getBoundingClientRect();
        const scaleX = width / rect.width;
        const scaleY = height / rect.height;

        const svgX = (clientX - rect.left) * scaleX;
        const svgY = (clientY - rect.top) * scaleY;

        if (
            svgX < padding.left ||
            svgX > width - padding.right ||
            svgY < padding.top ||
            svgY > height - padding.bottom
        ) {
            return false;
        }

        const newX = fromSvgX(svgX);
        const newY = fromSvgY(svgY);

        const closePointIndex = points.findIndex(
            (p) => Math.abs(p.x - newX) < 0.08,
        );
        if (closePointIndex !== -1) {
            draggingIndex = closePointIndex;
            window.addEventListener("mousemove", handleMouseMove);
            window.addEventListener("mouseup", handleMouseUp);
            return true;
        }

        const newPoints = [...points, { x: newX, y: newY }].sort(
            (a, b) => a.x - b.x,
        );
        const newIndex = newPoints.findIndex(
            (p) => p.x === newX && p.y === newY,
        );

        onPointsChange(newPoints);

        draggingIndex = newIndex;
        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);

        return true;
    }

    function handleSvgMouseDown(e: MouseEvent) {
        handleSvgInteraction(e.clientX, e.clientY);
    }

    function handlePointDoubleClick(index: number, e: MouseEvent) {
        e.preventDefault();
        e.stopPropagation();

        if (isAnchorX(index)) return;
        if (points.length <= 2) return;

        const newPoints = points.filter((_, i) => i !== index);
        onPointsChange(newPoints);
    }

    function getPointRadius(index: number): number {
        if (draggingIndex === index) return 6;
        if (hoverIndex === index) return 5;
        return 4;
    }
</script>

<div class="curve-editor-container">
    <div class="header">
        <span class="label">{label}</span>
    </div>

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <svg
        bind:this={svgElement}
        {width}
        {height}
        viewBox="0 0 {width} {height}"
        onmousedown={handleSvgMouseDown}
    >
        <!-- Grid/Background -->
        <rect x="0" y="0" {width} {height} class="bg" rx="4" />

        <line
            x1={toSvgX(0)}
            y1={toSvgY(0.5)}
            x2={toSvgX(1)}
            y2={toSvgY(0.5)}
            class="grid-line"
        />
        <line
            x1={toSvgX(0.5)}
            y1={toSvgY(0)}
            x2={toSvgX(0.5)}
            y2={toSvgY(1)}
            class="grid-line"
        />

        <!-- Filled area under curve -->
        <path d={getFillPath()} class="area-fill" />

        <!-- The Curve itself -->
        <path d={getCurvePath()} class="curve-line" />

        <!-- The points -->
        {#each points as point, i (i)}
            <circle
                cx={toSvgX(point.x)}
                cy={toSvgY(point.y)}
                r={getPointRadius(i)}
                class="point"
                class:active={draggingIndex === i}
                onmousedown={(e) => handlePointMouseDown(i, e)}
                ondblclick={(e) => handlePointDoubleClick(i, e)}
                onmouseenter={() => (hoverIndex = i)}
                onmouseleave={() => (hoverIndex = null)}
            />
        {/each}
    </svg>
    <div class="hint">Double-click point to remove</div>
</div>

<style>
    .curve-editor-container {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 0.5rem;
        user-select: none;
    }

    .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0 4px;
    }

    .label {
        font-size: 0.75rem;
        color: rgba(255, 255, 255, 0.6);
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    svg {
        display: block;
        cursor: crosshair;
        background: rgba(0, 0, 0, 0.2);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        touch-action: none;
    }

    .bg {
        fill: transparent;
    }

    .grid-line {
        stroke: rgba(255, 255, 255, 0.05);
        stroke-width: 1;
        stroke-dasharray: 2, 2;
    }

    .area-fill {
        fill: rgba(0, 255, 128, 0.15);
    }

    .curve-line {
        fill: none;
        stroke: #00ff80;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
    }

    .point {
        fill: #00ff80;
        stroke: #050505;
        stroke-width: 1.5;
        cursor: pointer;
        transition: r 0.15s cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    .point:hover {
        fill: #fff;
    }

    .point.active {
        fill: #fff;
        filter: drop-shadow(0 0 4px rgba(0, 255, 128, 0.8));
    }

    .hint {
        font-size: 0.65rem;
        color: rgba(255, 255, 255, 0.3);
        text-align: center;
        margin-top: -4px;
        font-style: italic;
    }
</style>
