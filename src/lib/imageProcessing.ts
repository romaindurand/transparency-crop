import type { CropBox, CropComputationResult, RGBA } from './types';

const MAX_RGBA_DISTANCE = Math.sqrt(255 * 255 * 4);
const MAX_RGBA_DISTANCE_SQUARED = 255 * 255 * 4;

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export function tolerancePercentToDistance(tolerancePercent: number): number {
	const ratio = clamp(tolerancePercent, 0, 100) / 100;
	return ratio * MAX_RGBA_DISTANCE;
}

function rgbaDistance(
	r: number,
	g: number,
	b: number,
	a: number,
	[targetR, targetG, targetB, targetA]: RGBA
): number {
	const dr = r - targetR;
	const dg = g - targetG;
	const db = b - targetB;
	const da = a - targetA;

	return Math.sqrt(dr * dr + dg * dg + db * db + da * da);
}

function rgbaDistanceSquared(
	r: number,
	g: number,
	b: number,
	a: number,
	[targetR, targetG, targetB, targetA]: RGBA
): number {
	const dr = r - targetR;
	const dg = g - targetG;
	const db = b - targetB;
	const da = a - targetA;

	return dr * dr + dg * dg + db * db + da * da;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) {
		return;
	}

	throw new DOMException('Aborted', 'AbortError');
}

async function yieldToEventLoop(): Promise<void> {
	await new Promise<void>((resolve) => {
		setTimeout(resolve, 0);
	});
}

export function detectMatchingMask(
	pixels: Uint8ClampedArray,
	width: number,
	height: number,
	target: RGBA,
	tolerancePercent: number
): Uint8Array {
	const pixelCount = width * height;
	const mask = new Uint8Array(pixelCount);
	const maxDistance = tolerancePercentToDistance(tolerancePercent);

	for (let i = 0; i < pixelCount; i += 1) {
		const offset = i * 4;
		const distance = rgbaDistance(
			pixels[offset],
			pixels[offset + 1],
			pixels[offset + 2],
			pixels[offset + 3],
			target
		);

		if (distance <= maxDistance) {
			mask[i] = 1;
		}
	}

	return mask;
}

export function computeCropBox(
	pixels: Uint8ClampedArray,
	width: number,
	height: number,
	target: RGBA,
	tolerancePercent: number
): CropComputationResult {
	const mask = detectMatchingMask(pixels, width, height, target, tolerancePercent);

	let minX = width;
	let minY = height;
	let maxX = -1;
	let maxY = -1;

	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const index = y * width + x;

			if (mask[index] === 1) {
				continue;
			}

			if (x < minX) minX = x;
			if (y < minY) minY = y;
			if (x > maxX) maxX = x;
			if (y > maxY) maxY = y;
		}
	}

	if (maxX < 0 || maxY < 0) {
		return {
			box: { x: 0, y: 0, width, height },
			mask
		};
	}

	return {
		box: {
			x: minX,
			y: minY,
			width: maxX - minX + 1,
			height: maxY - minY + 1
		},
		mask
	};
}

export async function computeCropBoxCancelable(
	pixels: Uint8ClampedArray,
	width: number,
	height: number,
	target: RGBA,
	tolerancePercent: number,
	options?: {
		signal?: AbortSignal;
		chunkSize?: number;
	}
): Promise<CropBox> {
	const threshold =
		(Math.min(100, Math.max(0, tolerancePercent)) / 100) ** 2 * MAX_RGBA_DISTANCE_SQUARED;
	const chunkSize = Math.max(1_024, options?.chunkSize ?? 32_768);

	let minX = width;
	let minY = height;
	let maxX = -1;
	let maxY = -1;

	let processed = 0;
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			throwIfAborted(options?.signal);

			const index = y * width + x;
			const offset = index * 4;

			const isMatchingColor =
				rgbaDistanceSquared(
					pixels[offset],
					pixels[offset + 1],
					pixels[offset + 2],
					pixels[offset + 3],
					target
				) <= threshold;

			if (!isMatchingColor) {
				if (x < minX) minX = x;
				if (y < minY) minY = y;
				if (x > maxX) maxX = x;
				if (y > maxY) maxY = y;
			}

			processed += 1;
			if (processed % chunkSize === 0) {
				throwIfAborted(options?.signal);
				await yieldToEventLoop();
			}
		}
	}

	if (maxX < 0 || maxY < 0) {
		return { x: 0, y: 0, width, height };
	}

	return {
		x: minX,
		y: minY,
		width: maxX - minX + 1,
		height: maxY - minY + 1
	};
}

export function getMimeTypeFromFile(file: File): string {
	const supported = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
	return supported.has(file.type) ? file.type : 'image/png';
}

export function createCroppedCanvas(
	source: HTMLCanvasElement,
	cropBox: CropBox
): HTMLCanvasElement {
	const output = document.createElement('canvas');
	output.width = cropBox.width;
	output.height = cropBox.height;

	const context = output.getContext('2d');
	if (!context) {
		throw new Error('Unable to create 2D context for output canvas');
	}

	context.drawImage(
		source,
		cropBox.x,
		cropBox.y,
		cropBox.width,
		cropBox.height,
		0,
		0,
		cropBox.width,
		cropBox.height
	);

	return output;
}

export async function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (blob) {
				resolve(blob);
				return;
			}

			reject(new Error('Canvas export failed'));
		}, mimeType);
	});
}
