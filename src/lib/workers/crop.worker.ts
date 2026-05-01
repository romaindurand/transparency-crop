import { expose } from 'comlink';
import { computeCropBoxCancelable } from '$lib/imageProcessing';
import type { CropBox, CropWorkerApi, RGBA } from '$lib/types';

let sourcePixels: Uint8ClampedArray | null = null;
let sourceWidth = 0;
let sourceHeight = 0;
let activeController: AbortController | null = null;

function ensureImageData(): {
	pixels: Uint8ClampedArray;
	width: number;
	height: number;
} {
	if (!sourcePixels || sourceWidth <= 0 || sourceHeight <= 0) {
		throw new Error('Image data has not been initialized in crop worker');
	}

	return {
		pixels: sourcePixels,
		width: sourceWidth,
		height: sourceHeight
	};
}

async function compute(target: RGBA, tolerancePercent: number): Promise<CropBox> {
	const { pixels, width, height } = ensureImageData();

	activeController = new AbortController();
	const currentController = activeController;

	try {
		return await computeCropBoxCancelable(pixels, width, height, target, tolerancePercent, {
			signal: currentController.signal,
			chunkSize: 16_384
		});
	} finally {
		if (activeController === currentController) {
			activeController = null;
		}
	}
}

const api: CropWorkerApi = {
	setImageData(pixels, width, height) {
		sourcePixels = pixels;
		sourceWidth = width;
		sourceHeight = height;
	},
	cancelCurrentComputation() {
		activeController?.abort();
	},
	computeCropBox(target, tolerancePercent) {
		return compute(target, tolerancePercent);
	},
	dispose() {
		activeController?.abort();
		activeController = null;
		sourcePixels = null;
		sourceWidth = 0;
		sourceHeight = 0;
	}
};

expose(api);
