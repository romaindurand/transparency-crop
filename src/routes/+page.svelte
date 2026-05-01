<script lang="ts">
	import { canvasToBlob, createCroppedCanvas, getMimeTypeFromFile } from '$lib/imageProcessing';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { createCropWorkerClient } from '$lib/workers/cropWorkerClient';
	import type { CropWorkerClient } from '$lib/workers/cropWorkerClient';
	import type { CropBox, ImageMetadata, LoadedFile, RGBA, ViewportTransform } from '$lib/types';
	import { zipSync } from 'fflate';

	let viewportElement = $state<HTMLDivElement | null>(null);
	let canvasElement = $state<HTMLCanvasElement | null>(null);
	let fileInputElement = $state<HTMLInputElement | null>(null);

	let isDragOver = $state(false);
	let isPipetteEnabled = $state(true);
	let isLoading = $state(false);
	let isCroppingAll = $state(false);
	let errorMessage = $state<string | null>(null);

	let files = $state<LoadedFile[]>([]);
	let activeFileId = $state<string | null>(null);
	let selectedColor = $state<RGBA | null>(null);
	let tolerance = $state(6);
	let cropWorkerClient: CropWorkerClient | null = null;

	const activeFile = $derived(files.find((f) => f.id === activeFileId) ?? null);

	const effectiveCropBox = $derived(
		activeFile
			? selectedColor !== null && activeFile.cropBox !== null
				? activeFile.cropBox
				: { x: 0, y: 0, width: activeFile.metadata.width, height: activeFile.metadata.height }
			: null
	);

	let transform = $state<ViewportTransform>({
		scale: 1,
		offsetX: 0,
		offsetY: 0
	});

	let hasManualTransform = $state(false);
	let debounceTimer: number | null = null;
	let workerRequestId = 0;
	let renderFrameId: number | null = null;

	const selectedColorCss = $derived(
		selectedColor
			? `rgba(${selectedColor[0]}, ${selectedColor[1]}, ${selectedColor[2]}, ${selectedColor[3] / 255})`
			: 'transparent'
	);

	const canCrop = $derived(activeFile !== null);

	function getExtensionFromMimeType(mimeType: string): string {
		if (mimeType === 'image/jpeg') return 'jpg';
		if (mimeType === 'image/webp') return 'webp';
		if (mimeType === 'image/gif') return 'gif';
		return 'png';
	}

	function createInternalCanvas(width: number, height: number): HTMLCanvasElement {
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		return canvas;
	}

	function drawCheckerboard(ctx: CanvasRenderingContext2D, width: number, height: number): void {
		const size = 16;
		ctx.fillStyle = '#f4f4f5';
		ctx.fillRect(0, 0, width, height);

		ctx.fillStyle = '#e7e7ea';
		for (let y = 0; y < height; y += size) {
			for (let x = (y / size) % 2 === 0 ? 0 : size; x < width; x += size * 2) {
				ctx.fillRect(x, y, size, size);
			}
		}
	}

	function fitImageToViewport(): void {
		if (!viewportElement || !activeFile) {
			return;
		}

		const rect = viewportElement.getBoundingClientRect();
		if (!rect.width || !rect.height) {
			return;
		}

		const { width, height } = activeFile.metadata;
		const scale = Math.min(rect.width / width, rect.height / height) * 0.9;
		transform = {
			scale,
			offsetX: (rect.width - width * scale) / 2,
			offsetY: (rect.height - height * scale) / 2
		};
	}

	function ensureCropWorkerClient(): CropWorkerClient | null {
		if (!browser) {
			return null;
		}

		if (!cropWorkerClient) {
			cropWorkerClient = createCropWorkerClient();
		}

		return cropWorkerClient;
	}

	function cancelOngoingComputation(): void {
		if (debounceTimer !== null) {
			window.clearTimeout(debounceTimer);
			debounceTimer = null;
		}

		cropWorkerClient?.cancelCurrentComputation();
	}

	function updateActiveFileCropBox(box: CropBox | null): void {
		if (!activeFileId) return;
		files = files.map((f) => (f.id === activeFileId ? { ...f, cropBox: box } : f));
	}

	async function runCropComputation(jobId: number): Promise<void> {
		if (!activeFile || !selectedColor) {
			scheduleRender();
			return;
		}

		const targetColor: RGBA = [
			selectedColor[0],
			selectedColor[1],
			selectedColor[2],
			selectedColor[3]
		];

		const workerClient = ensureCropWorkerClient();
		if (!workerClient) {
			console.warn('Crop worker client is not available. Crop computation cannot be performed.');
			return;
		}

		try {
			const nextCropBox = await workerClient.computeCropBox(targetColor, tolerance);
			if (jobId !== workerRequestId) {
				return;
			}

			updateActiveFileCropBox(nextCropBox);
			scheduleRender();
		} catch (error) {
			if (
				error instanceof DOMException
					? error.name === 'AbortError'
					: typeof error === 'object' &&
						error !== null &&
						'name' in error &&
						error.name === 'AbortError'
			) {
				return;
			}

			throw error;
		}
	}

	function scheduleCropComputation(delayMs: number): void {
		// Ignore scheduling during batch crop to prevent interruptions
		if (isCroppingAll) return;

		if (!selectedColor || !activeFile) {
			cancelOngoingComputation();
			scheduleRender();
			return;
		}

		if (debounceTimer !== null) {
			window.clearTimeout(debounceTimer);
		}

		cropWorkerClient?.cancelCurrentComputation();
		const nextJobId = ++workerRequestId;

		debounceTimer = window.setTimeout(() => {
			debounceTimer = null;
			void runCropComputation(nextJobId);
		}, delayMs);
	}

	function scheduleRender(): void {
		if (!browser) {
			render();
			return;
		}

		if (renderFrameId !== null) {
			return;
		}

		renderFrameId = window.requestAnimationFrame(() => {
			renderFrameId = null;
			render();
		});
	}

	function render(): void {
		if (!canvasElement || !viewportElement) {
			return;
		}

		const rect = viewportElement.getBoundingClientRect();
		if (!rect.width || !rect.height) {
			return;
		}

		const dpr = window.devicePixelRatio || 1;
		const nextWidth = Math.max(1, Math.floor(rect.width * dpr));
		const nextHeight = Math.max(1, Math.floor(rect.height * dpr));

		if (canvasElement.width !== nextWidth || canvasElement.height !== nextHeight) {
			canvasElement.width = nextWidth;
			canvasElement.height = nextHeight;
		}

		const ctx = canvasElement.getContext('2d');
		if (!ctx) {
			return;
		}

		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		drawCheckerboard(ctx, rect.width, rect.height);

		if (!activeFile) {
			return;
		}

		ctx.save();
		ctx.translate(transform.offsetX, transform.offsetY);
		ctx.scale(transform.scale, transform.scale);
		ctx.drawImage(activeFile.sourceCanvas, 0, 0);
		ctx.restore();

		if (effectiveCropBox) {
			const holeX = transform.offsetX + effectiveCropBox.x * transform.scale;
			const holeY = transform.offsetY + effectiveCropBox.y * transform.scale;
			const holeWidth = effectiveCropBox.width * transform.scale;
			const holeHeight = effectiveCropBox.height * transform.scale;

			ctx.save();
			ctx.fillStyle = 'rgba(0, 0, 0, 0.58)';
			ctx.beginPath();
			ctx.rect(0, 0, rect.width, rect.height);
			ctx.rect(holeX, holeY, holeWidth, holeHeight);
			ctx.fill('evenodd');

			ctx.strokeStyle = 'rgba(255, 255, 255, 0.82)';
			ctx.lineWidth = 1.5;
			ctx.strokeRect(
				holeX + 0.75,
				holeY + 0.75,
				Math.max(0, holeWidth - 1.5),
				Math.max(0, holeHeight - 1.5)
			);
			ctx.restore();
		}
	}

	function getImageCoordinates(clientX: number, clientY: number): { x: number; y: number } | null {
		if (!canvasElement || !activeFile) {
			return null;
		}

		const rect = canvasElement.getBoundingClientRect();
		const canvasX = clientX - rect.left;
		const canvasY = clientY - rect.top;

		const imageX = Math.floor((canvasX - transform.offsetX) / transform.scale);
		const imageY = Math.floor((canvasY - transform.offsetY) / transform.scale);

		if (
			imageX < 0 ||
			imageY < 0 ||
			imageX >= activeFile.metadata.width ||
			imageY >= activeFile.metadata.height
		) {
			return null;
		}

		return { x: imageX, y: imageY };
	}

	function handleCanvasClick(event: MouseEvent): void {
		if (!isPipetteEnabled || !activeFile) {
			return;
		}

		const point = getImageCoordinates(event.clientX, event.clientY);
		if (!point) {
			return;
		}

		const { x, y } = point;

		// Clic hors de la cropBox courante → reset de la couleur sélectionnée
		if (selectedColor !== null && effectiveCropBox !== null) {
			const box = effectiveCropBox;
			if (x < box.x || x >= box.x + box.width || y < box.y || y >= box.y + box.height) {
				selectedColor = null;
				updateActiveFileCropBox(null);
				scheduleRender();
				return;
			}
		}

		const pixelIndex = (y * activeFile.metadata.width + x) * 4;
		selectedColor = [
			activeFile.sourcePixels[pixelIndex],
			activeFile.sourcePixels[pixelIndex + 1],
			activeFile.sourcePixels[pixelIndex + 2],
			activeFile.sourcePixels[pixelIndex + 3]
		];
		errorMessage = null;
		scheduleCropComputation(0);
	}

	function handleWheel(event: WheelEvent): void {
		if (!activeFile || !canvasElement) {
			return;
		}

		event.preventDefault();
		hasManualTransform = true;

		const rect = canvasElement.getBoundingClientRect();
		const mouseX = event.clientX - rect.left;
		const mouseY = event.clientY - rect.top;

		const imageX = (mouseX - transform.offsetX) / transform.scale;
		const imageY = (mouseY - transform.offsetY) / transform.scale;

		const zoomFactor = event.deltaY < 0 ? 1.1 : 0.9;
		const nextScale = Math.min(100, Math.max(0.02, transform.scale * zoomFactor));

		transform = {
			scale: nextScale,
			offsetX: mouseX - imageX * nextScale,
			offsetY: mouseY - imageY * nextScale
		};

		scheduleRender();
	}

	async function loadImageFile(file: File): Promise<LoadedFile | null> {
		if (!file.type.startsWith('image/')) {
			errorMessage = "Le fichier déposé n'est pas une image.";
			return null;
		}

		try {
			const imageBitmap = await createImageBitmap(file);
			const canvas = createInternalCanvas(imageBitmap.width, imageBitmap.height);
			const context = canvas.getContext('2d', { willReadFrequently: true });
			if (!context) {
				throw new Error('Impossible de créer le contexte 2D');
			}

			context.drawImage(imageBitmap, 0, 0);
			const sourcePixels = context.getImageData(0, 0, imageBitmap.width, imageBitmap.height).data;

			const THUMB_MAX = 120;
			const thumbScale = Math.min(THUMB_MAX / imageBitmap.width, THUMB_MAX / imageBitmap.height, 1);
			const thumbCanvas = document.createElement('canvas');
			thumbCanvas.width = Math.round(imageBitmap.width * thumbScale);
			thumbCanvas.height = Math.round(imageBitmap.height * thumbScale);
			thumbCanvas
				.getContext('2d')!
				.drawImage(imageBitmap, 0, 0, thumbCanvas.width, thumbCanvas.height);
			const thumbnailUrl = thumbCanvas.toDataURL('image/jpeg', 0.7);

			const metadata: ImageMetadata = {
				name: file.name.replace(/\.[^/.]+$/, ''),
				mimeType: getMimeTypeFromFile(file),
				width: imageBitmap.width,
				height: imageBitmap.height
			};

			return {
				id: crypto.randomUUID(),
				metadata,
				sourceCanvas: canvas,
				sourcePixels,
				cropBox: null,
				thumbnailUrl
			};
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Impossible de charger cette image.';
			return null;
		}
	}

	async function switchToFile(id: string): Promise<void> {
		activeFileId = id;
		const file = files.find((f) => f.id === id);
		if (!file) return;

		cancelOngoingComputation();
		const workerClient = ensureCropWorkerClient();
		if (workerClient) {
			await workerClient.setImageData(file.sourcePixels, file.metadata.width, file.metadata.height);
		}

		hasManualTransform = false;
		fitImageToViewport();

		if (selectedColor !== null) {
			scheduleCropComputation(0);
		} else {
			scheduleRender();
		}
	}

	async function handleInputChange(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const fileList = Array.from(input.files ?? []);
		if (!fileList.length) {
			return;
		}

		isLoading = true;
		errorMessage = null;

		for (const file of fileList) {
			const loaded = await loadImageFile(file);
			if (loaded) {
				files = [...files, loaded];
			}
		}

		if (!activeFileId && files.length > 0) {
			await switchToFile(files[0].id);
		}

		isLoading = false;
		input.value = '';
	}

	async function handleDrop(event: DragEvent): Promise<void> {
		event.preventDefault();
		isDragOver = false;

		const fileList = Array.from(event.dataTransfer?.files ?? []);
		if (!fileList.length) {
			return;
		}

		isLoading = true;
		errorMessage = null;

		for (const file of fileList) {
			const loaded = await loadImageFile(file);
			if (loaded) {
				files = [...files, loaded];
			}
		}

		if (!activeFileId && files.length > 0) {
			await switchToFile(files[0].id);
		}

		isLoading = false;
	}

	async function downloadCrop(): Promise<void> {
		if (!activeFile || !effectiveCropBox) {
			return;
		}

		const croppedCanvas = createCroppedCanvas(activeFile.sourceCanvas, effectiveCropBox);
		const blob = await canvasToBlob(croppedCanvas, activeFile.metadata.mimeType);
		const extension = getExtensionFromMimeType(activeFile.metadata.mimeType);

		const link = document.createElement('a');
		const url = URL.createObjectURL(blob);
		link.href = url;
		link.download = `${activeFile.metadata.name}.${extension}`;
		link.click();
		URL.revokeObjectURL(url);
	}

	async function cropAllToZip(): Promise<void> {
		if (!files.length) return;
		isCroppingAll = true;

		const client = ensureCropWorkerClient();
		const capturedColor = selectedColor
			? ([selectedColor[0], selectedColor[1], selectedColor[2], selectedColor[3]] as RGBA)
			: null;
		const capturedTolerance = tolerance;
		const entries: Record<string, Uint8Array> = {};

		for (const file of files) {
			try {
				if (client) {
					await client.setImageData(file.sourcePixels, file.metadata.width, file.metadata.height);
				}
				const box =
					capturedColor !== null && client
						? await client.computeCropBox(capturedColor, capturedTolerance)
						: { x: 0, y: 0, width: file.metadata.width, height: file.metadata.height };

				const croppedCanvas = createCroppedCanvas(file.sourceCanvas, box);
				const blob = await canvasToBlob(croppedCanvas, file.metadata.mimeType);
				const arrayBuffer = await blob.arrayBuffer();
				const ext = getExtensionFromMimeType(file.metadata.mimeType);
				entries[`${file.metadata.name}.${ext}`] = new Uint8Array(arrayBuffer);
			} catch (error) {
				if (
					error instanceof DOMException
						? error.name === 'AbortError'
						: typeof error === 'object' &&
							error !== null &&
							'name' in error &&
							error.name === 'AbortError'
				) {
					continue;
				}
				throw error;
			}
		}

		// Restaurer le worker avec le fichier actif
		if (activeFile && client) {
			await client.setImageData(
				activeFile.sourcePixels,
				activeFile.metadata.width,
				activeFile.metadata.height
			);
		}

		const zipped = zipSync(entries);
		const zipBlob = new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' });
		const url = URL.createObjectURL(zipBlob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'cropped-images.zip';
		a.click();
		URL.revokeObjectURL(url);
		isCroppingAll = false;
	}

	function openFileDialog(): void {
		fileInputElement?.click();
	}

	onMount(() => {
		ensureCropWorkerClient();

		return () => {
			cancelOngoingComputation();
			if (renderFrameId !== null) {
				window.cancelAnimationFrame(renderFrameId);
				renderFrameId = null;
			}

			cropWorkerClient?.terminate();
			cropWorkerClient = null;
		};
	});

	$effect(() => {
		void tolerance;
		scheduleCropComputation(100);
	});

	$effect(() => {
		void selectedColor;
		scheduleCropComputation(0);
	});

	$effect(() => {
		scheduleRender();
	});

	$effect(() => {
		if (!viewportElement) {
			return;
		}

		const observer = new ResizeObserver(() => {
			if (!hasManualTransform) {
				fitImageToViewport();
			}
			scheduleRender();
		});

		observer.observe(viewportElement);

		return () => {
			cancelOngoingComputation();
			observer.disconnect();
		};
	});
</script>

<main class="page-shell">
	<div class="main-area">
		{#if files.length > 0}
			<aside class="sidebar">
				{#each files as file (file.id)}
					<button
						class="file-item"
						class:active={file.id === activeFileId}
						onclick={() => switchToFile(file.id)}
					>
						<img src={file.thumbnailUrl} alt={file.metadata.name} class="thumb" />
						<span class="filename">{file.metadata.name}</span>
					</button>
				{/each}
			</aside>
		{/if}

		<section
			class="stage"
			aria-label="Zone de dépôt d'image"
			ondragover={(event) => {
				event.preventDefault();
				isDragOver = true;
			}}
			ondragleave={(event) => {
				if (event.currentTarget === event.target) {
					isDragOver = false;
				}
			}}
			ondrop={handleDrop}
		>
			<div class="glow"></div>
			<div class="viewport-wrap" bind:this={viewportElement}>
				<canvas
					bind:this={canvasElement}
					class="viewport-canvas"
					tabindex="0"
					onclick={handleCanvasClick}
					onwheel={handleWheel}
				></canvas>

				{#if !activeFile}
					<button class="drop-overlay" type="button" onclick={openFileDialog}>
						<p class="drop-title">Drop an image here</p>
						<p class="drop-subtitle">ou cliquez pour choisir un fichier</p>
					</button>
				{/if}

				{#if isDragOver}
					<div class="drop-highlight">Relâchez l'image pour la charger</div>
				{/if}

				{#if isLoading}
					<div class="drop-highlight">Chargement de l'image...</div>
				{/if}
			</div>
		</section>
	</div>

	{#if errorMessage}
		<p class="error-banner">{errorMessage}</p>
	{/if}

	<section class="toolbar">
		<button
			type="button"
			class:is-active={isPipetteEnabled}
			class="tool-button"
			onclick={() => {
				isPipetteEnabled = !isPipetteEnabled;
			}}
			disabled={!activeFile}
		>
			Pipette
		</button>

		<div class="tolerance-group">
			<label for="tolerance">Tolérance: {tolerance}%</label>
			<input id="tolerance" type="range" min="0" max="100" step="1" bind:value={tolerance} />
		</div>

		<div class="color-info">
			<span>Couleur</span>
			{#if selectedColor !== null}
				<div class="color-preview">
					<div class="swatch" style={`background:${selectedColorCss};`}></div>
					<small>
						rgba({selectedColor[0]}, {selectedColor[1]}, {selectedColor[2]}, {selectedColor[3]})
					</small>
				</div>
			{:else}
				<span class="no-color">Aucune</span>
			{/if}
		</div>

		<div class="crop-buttons">
			<button type="button" class="crop-button" onclick={downloadCrop} disabled={!canCrop}>
				Crop
			</button>
			{#if files.length > 1}
				<button
					type="button"
					class="crop-button crop-all-button"
					onclick={cropAllToZip}
					disabled={isCroppingAll}
				>
					{isCroppingAll ? 'Traitement…' : 'Crop all'}
				</button>
			{/if}
		</div>
	</section>

	<input
		type="file"
		accept="image/*"
		multiple
		bind:this={fileInputElement}
		hidden
		onchange={handleInputChange}
	/>
</main>

<style>
	:global(body) {
		margin: 0;
		font-family: 'Space Grotesk', 'Segoe UI', sans-serif;
		background:
			radial-gradient(1100px 500px at -10% -10%, #c1f7d6 0%, transparent 70%),
			radial-gradient(1000px 520px at 110% 110%, #ffd8a8 0%, transparent 70%),
			linear-gradient(160deg, #f7f9fc 0%, #eef2f7 100%);
		color: #1f2937;
	}

	.page-shell {
		display: grid;
		grid-template-rows: 1fr auto auto;
		gap: 1rem;
		min-height: 100svh;
		padding: 1rem;
	}

	.main-area {
		display: flex;
		gap: 1rem;
		overflow: hidden;
		min-height: 0;
	}

	.stage {
		position: relative;
		flex: 1;
		min-width: 0;
		border-radius: 1.25rem;
		background: color-mix(in srgb, #ffffff 76%, #fefce8 24%);
		box-shadow:
			0 18px 40px -30px #1f2937,
			0 0 0 1px color-mix(in srgb, #0f172a 8%, transparent);
		overflow: hidden;
	}

	.sidebar {
		width: 160px;
		min-width: 160px;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		overflow-y: auto;
		background: color-mix(in srgb, #ffffff 88%, transparent);
		border-radius: 1.25rem;
		padding: 0.5rem;
		box-shadow: 0 8px 20px -18px #111827;
	}

	.file-item {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.3rem;
		padding: 0.5rem;
		border: 0;
		border-radius: 0.75rem;
		background: transparent;
		cursor: pointer;
		font-family: 'Space Grotesk', sans-serif;
		transition: background 150ms ease;
		width: 100%;
	}

	.file-item:hover {
		background: color-mix(in srgb, #14b8a6 15%, transparent);
	}

	.file-item.active {
		background: color-mix(in srgb, #14b8a6 25%, transparent);
		box-shadow: inset 3px 0 0 #14b8a6;
	}

	.thumb {
		width: 100%;
		height: auto;
		border-radius: 0.5rem;
		object-fit: contain;
		display: block;
	}

	.filename {
		font-size: 0.75rem;
		color: #374151;
		text-overflow: ellipsis;
		overflow: hidden;
		white-space: nowrap;
		width: 100%;
		text-align: center;
	}

	.glow {
		position: absolute;
		inset: -40% -20% auto -20%;
		height: 220px;
		background: linear-gradient(90deg, #5eead4 0%, #facc15 100%);
		opacity: 0.1;
		filter: blur(36px);
		pointer-events: none;
	}

	.viewport-wrap {
		position: relative;
		height: min(72vh, 900px);
		min-height: 300px;
	}

	.viewport-canvas {
		width: 100%;
		height: 100%;
		display: block;
		cursor: crosshair;
	}

	.drop-overlay {
		position: absolute;
		inset: 0;
		display: grid;
		place-content: center;
		gap: 0.4rem;
		background: color-mix(in srgb, #ffffff 78%, transparent);
		border: 0;
		cursor: pointer;
		font-family: 'Space Grotesk', sans-serif;
	}

	.drop-title {
		margin: 0;
		font-size: clamp(1.25rem, 3vw, 2rem);
		font-weight: 700;
	}

	.drop-subtitle {
		margin: 0;
		font-size: 0.95rem;
		color: #4b5563;
	}

	.drop-highlight {
		position: absolute;
		inset: 0;
		display: grid;
		place-content: center;
		background: color-mix(in srgb, #111827 35%, transparent);
		color: #f9fafb;
		font-size: 1.1rem;
		font-weight: 600;
	}

	.toolbar {
		display: grid;
		grid-template-columns: auto 1fr auto auto;
		gap: 0.75rem;
		align-items: center;
		padding: 0.75rem;
		border-radius: 1rem;
		background: color-mix(in srgb, #ffffff 88%, transparent);
		box-shadow: 0 8px 20px -18px #111827;
	}

	.color-info {
		display: grid;
		gap: 0.2rem;
		font-size: 0.86rem;
	}

	.no-color {
		color: #9ca3af;
		font-size: 0.86rem;
	}

	.crop-buttons {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	.crop-all-button {
		background: #6366f1;
		color: white;
	}

	.tool-button,
	.crop-button {
		border: 0;
		border-radius: 0.8rem;
		padding: 0.7rem 1rem;
		font-weight: 600;
		font-family: 'Space Grotesk', sans-serif;
		background: #e5e7eb;
		color: #111827;
		cursor: pointer;
		transition: transform 150ms ease;
	}

	.tool-button:hover,
	.crop-button:hover {
		transform: translateY(-1px);
	}

	.tool-button.is-active {
		background: #14b8a6;
		color: white;
	}

	.crop-button {
		background: #f59e0b;
	}

	.tolerance-group {
		display: grid;
		gap: 0.2rem;
	}

	.tolerance-group label {
		font-size: 0.92rem;
		color: #374151;
	}

	.tolerance-group input {
		width: 100%;
	}

	.color-preview {
		display: grid;
		grid-auto-flow: column;
		gap: 0.5rem;
		align-items: center;
	}

	.swatch {
		width: 1.8rem;
		height: 1.8rem;
		border-radius: 0.45rem;
		border: 1px solid color-mix(in srgb, #111827 20%, transparent);
		background-image:
			linear-gradient(45deg, #e5e7eb 25%, transparent 25%),
			linear-gradient(-45deg, #e5e7eb 25%, transparent 25%),
			linear-gradient(45deg, transparent 75%, #e5e7eb 75%),
			linear-gradient(-45deg, transparent 75%, #e5e7eb 75%);
		background-size: 10px 10px;
		background-position:
			0 0,
			0 5px,
			5px -5px,
			-5px 0;
	}

	.error-banner {
		margin: 0;
		padding: 0.65rem 0.85rem;
		border-radius: 0.75rem;
		background: #fee2e2;
		color: #991b1b;
		font-weight: 600;
	}

	button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
		transform: none;
	}

	@media (max-width: 900px) {
		.toolbar {
			grid-template-columns: 1fr;
		}

		.color-info {
			grid-auto-flow: row;
			justify-items: start;
		}
	}
</style>
