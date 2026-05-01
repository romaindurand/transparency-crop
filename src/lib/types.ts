export type RGBA = [number, number, number, number];

export type CropBox = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type CropComputationResult = {
	box: CropBox;
	mask: Uint8Array;
};

export type ImageMetadata = {
	name: string;
	mimeType: string;
	width: number;
	height: number;
};

export type ViewportTransform = {
	scale: number;
	offsetX: number;
	offsetY: number;
};

export type LoadedFile = {
	id: string;
	metadata: ImageMetadata;
	sourceCanvas: HTMLCanvasElement;
	sourcePixels: Uint8ClampedArray;
	cropBox: CropBox | null;
	thumbnailUrl: string;
};

export type CropWorkerApi = {
	setImageData(pixels: Uint8ClampedArray, width: number, height: number): void;
	cancelCurrentComputation(): void;
	computeCropBox(target: RGBA, tolerancePercent: number): Promise<CropBox>;
	dispose(): void;
};
