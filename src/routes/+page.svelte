<script lang="ts">
	import { canvasToBlob, createCroppedCanvas, getMimeTypeFromFile } from '$lib/imageProcessing';
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { createCropWorkerClient } from '$lib/workers/cropWorkerClient';
	import type { CropWorkerClient } from '$lib/workers/cropWorkerClient';
	import type { CropBox, ImageMetadata, LoadedFile, RGBA, ViewportTransform } from '$lib/types';
	import { zipSync } from 'fflate';
	import FileSidebar from '../components/FileSidebar.svelte';
	import ImageViewport from '../components/ImageViewport.svelte';
	import Toolbar from '../components/Toolbar.svelte';

	let viewportElement = $state<HTMLDivElement | null>(null);
	let canvasElement = $state<HTMLCanvasElement | null>(null);
	let fileInputElement = $state<HTMLInputElement | null>(null);

	let isDragOver = $state(false);
	let isLoading = $state(false);
	let isCroppingAll = $state(false);
	let errorMessage = $state<string | null>(null);
	let isPanning = $state(false);
	let panStartX = $state(0);
	let panStartY = $state(0);
	let panStartOffsetX = $state(0);
	let panStartOffsetY = $state(0);

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
	const bodyClasses = [
		'm-0',
		'bg-[radial-gradient(1100px_500px_at_-10%_-10%,#c1f7d6_0%,transparent_70%),radial-gradient(1000px_520px_at_110%_110%,#ffd8a8_0%,transparent_70%),linear-gradient(160deg,#f7f9fc_0%,#eef2f7_100%)]',
		"font-['Space_Grotesk','Segoe_UI',sans-serif]",
		'text-gray-800',
		'antialiased'
	];

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
		if (!activeFile) {
			return;
		}

		const point = getImageCoordinates(event.clientX, event.clientY);

		// Clic hors de la cropBox courante (y compris en dehors de l'image) → reset de la couleur sélectionnée
		if (selectedColor !== null && effectiveCropBox !== null) {
			if (!point) {
				// Clic complètement en dehors de l'image
				selectedColor = null;
				updateActiveFileCropBox(null);
				scheduleRender();
				return;
			}

			const { x, y } = point;
			const box = effectiveCropBox;
			if (x < box.x || x >= box.x + box.width || y < box.y || y >= box.y + box.height) {
				// Clic en dehors du cropBox
				selectedColor = null;
				updateActiveFileCropBox(null);
				scheduleRender();
				return;
			}
		}

		// Si pas de point, c'est qu'on a cliqué en dehors de l'image et pas de couleur n'était sélectionnée
		if (!point) {
			return;
		}

		const { x, y } = point;
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

	function handleMouseDown(event: MouseEvent): void {
		// Bouton milieu (wheel) pour le pan
		if (event.button !== 1 || !activeFile) {
			return;
		}

		event.preventDefault();
		isPanning = true;
		hasManualTransform = true;
		panStartX = event.clientX;
		panStartY = event.clientY;
		panStartOffsetX = transform.offsetX;
		panStartOffsetY = transform.offsetY;
	}

	function handleMouseMove(event: MouseEvent): void {
		if (!isPanning) {
			return;
		}

		const deltaX = event.clientX - panStartX;
		const deltaY = event.clientY - panStartY;

		transform = {
			scale: transform.scale,
			offsetX: panStartOffsetX + deltaX,
			offsetY: panStartOffsetY + deltaY
		};

		scheduleRender();
	}

	function handleMouseUp(): void {
		isPanning = false;
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

	async function appendLoadedFiles(fileList: File[]): Promise<void> {
		for (const file of fileList) {
			const loaded = await loadImageFile(file);
			if (loaded) {
				files = [...files, loaded];
			}
		}

		if (!activeFileId && files.length > 0) {
			await switchToFile(files[0].id);
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
		await appendLoadedFiles(fileList);

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
		await appendLoadedFiles(fileList);

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

	function handleStageDragOver(): void {
		isDragOver = true;
	}

	function handleStageDragLeave(event: DragEvent): void {
		if (event.currentTarget === event.target) {
			isDragOver = false;
		}
	}

	function handleToleranceChange(value: number): void {
		tolerance = value;
	}

	onMount(() => {
		ensureCropWorkerClient();
		document.body.classList.add(...bodyClasses);

		return () => {
			document.body.classList.remove(...bodyClasses);
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

<main class="grid min-h-svh grid-rows-[1fr_auto_auto] gap-4 p-4">
	<div class="flex min-h-0 gap-4">
		<FileSidebar {files} {activeFileId} onSelectFile={switchToFile} />

		<ImageViewport
			{activeFile}
			{isDragOver}
			{isLoading}
			onCanvasClick={handleCanvasClick}
			onCanvasWheel={handleWheel}
			onMouseDown={handleMouseDown}
			onMouseMove={handleMouseMove}
			onMouseUp={handleMouseUp}
			onDragOver={handleStageDragOver}
			onDragLeave={handleStageDragLeave}
			onDrop={handleDrop}
			onOpenFileDialog={openFileDialog}
			bind:canvasRef={canvasElement}
			bind:viewportRef={viewportElement}
		/>
	</div>

	{#if errorMessage}
		<p class="m-0 rounded-xl bg-red-100 px-3.5 py-2.5 font-semibold text-red-800">{errorMessage}</p>
	{/if}

	<Toolbar
		{tolerance}
		{selectedColor}
		{canCrop}
		{isCroppingAll}
		filesCount={files.length}
		onToleranceChange={handleToleranceChange}
		onDownloadCrop={downloadCrop}
		onCropAllToZip={cropAllToZip}
	/>

	<input
		type="file"
		accept="image/*"
		multiple
		bind:this={fileInputElement}
		hidden
		onchange={handleInputChange}
	/>
</main>
