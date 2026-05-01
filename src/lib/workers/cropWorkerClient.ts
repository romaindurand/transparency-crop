import { transfer, wrap } from 'comlink';
import type { CropBox, CropWorkerApi, RGBA } from '$lib/types';
import CropWorker from './crop.worker?worker';

export type CropWorkerClient = {
	setImageData(pixels: Uint8ClampedArray, width: number, height: number): Promise<void>;
	cancelCurrentComputation(): void;
	computeCropBox(target: RGBA, tolerancePercent: number): Promise<CropBox>;
	terminate(): void;
};

export function createCropWorkerClient(): CropWorkerClient {
	const worker = new CropWorker({ name: 'crop-worker' });
	const api = wrap<CropWorkerApi>(worker);

	return {
		async setImageData(pixels, width, height) {
			const transferablePixels = new Uint8ClampedArray(pixels);
			await api.setImageData(
				transfer(transferablePixels, [transferablePixels.buffer]),
				width,
				height
			);
		},
		cancelCurrentComputation() {
			void api.cancelCurrentComputation();
		},
		computeCropBox(target, tolerancePercent) {
			return api.computeCropBox(target, tolerancePercent);
		},
		terminate() {
			void api.dispose();
			worker.terminate();
		}
	};
}
