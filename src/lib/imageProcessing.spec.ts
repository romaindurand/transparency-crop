import { describe, expect, it } from 'vitest';
import {
	computeCropBoxCancelable,
	computeCropBox,
	detectMatchingMask,
	getMimeTypeFromFile,
	tolerancePercentToDistance
} from './imageProcessing';

describe('tolerancePercentToDistance', () => {
	it('maps 0% to 0', () => {
		expect(tolerancePercentToDistance(0)).toBe(0);
	});

	it('maps 100% to max RGBA distance', () => {
		expect(tolerancePercentToDistance(100)).toBe(510);
	});

	it('clamps outside range', () => {
		expect(tolerancePercentToDistance(-10)).toBe(0);
		expect(tolerancePercentToDistance(200)).toBe(510);
	});
});

describe('detectMatchingMask', () => {
	it('matches exact color when tolerance is 0', () => {
		const data = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);

		const mask = detectMatchingMask(data, 2, 1, [255, 255, 255, 255], 0);

		expect(Array.from(mask)).toEqual([1, 0]);
	});

	it('includes near colors when tolerance increases', () => {
		const data = new Uint8ClampedArray([255, 255, 255, 255, 248, 248, 248, 255]);

		const maskAtZero = detectMatchingMask(data, 2, 1, [255, 255, 255, 255], 0);
		const maskAtTen = detectMatchingMask(data, 2, 1, [255, 255, 255, 255], 10);

		expect(Array.from(maskAtZero)).toEqual([1, 0]);
		expect(Array.from(maskAtTen)).toEqual([1, 1]);
	});

	it('uses alpha channel in comparison', () => {
		const data = new Uint8ClampedArray([255, 255, 255, 0, 255, 255, 255, 30]);

		const maskAtZero = detectMatchingMask(data, 2, 1, [255, 255, 255, 0], 0);
		const maskAtTwelve = detectMatchingMask(data, 2, 1, [255, 255, 255, 0], 12);

		expect(Array.from(maskAtZero)).toEqual([1, 0]);
		expect(Array.from(maskAtTwelve)).toEqual([1, 1]);
	});

	it('treats almost transparent pixels as very close even with opposite RGB', () => {
		const data = new Uint8ClampedArray([
			255, 255, 255, 1, 0, 0, 0, 1, 0, 0, 0, 0, 255, 255, 255, 255
		]);

		const maskAtZero = detectMatchingMask(data, 4, 1, [255, 255, 255, 1], 0);
		const maskAtOne = detectMatchingMask(data, 4, 1, [255, 255, 255, 1], 1);

		expect(Array.from(maskAtZero)).toEqual([1, 0, 0, 0]);
		expect(Array.from(maskAtOne)).toEqual([1, 1, 1, 0]);
	});
});

describe('computeCropBox', () => {
	it('returns minimal box around non-matching content', () => {
		const width = 5;
		const height = 5;
		const white = [255, 255, 255, 255] as const;
		const black = [0, 0, 0, 255] as const;
		const data = new Uint8ClampedArray(width * height * 4);

		for (let i = 0; i < width * height; i += 1) {
			data.set(white, i * 4);
		}

		const contentPixels = [
			[2, 1],
			[1, 2],
			[2, 2],
			[3, 2],
			[2, 3]
		];

		for (const [x, y] of contentPixels) {
			data.set(black, (y * width + x) * 4);
		}

		const result = computeCropBox(data, width, height, [255, 255, 255, 255], 0);

		expect(result.box).toEqual({ x: 1, y: 1, width: 3, height: 3 });
	});

	it('returns full image when everything matches selected color', () => {
		const width = 2;
		const height = 2;
		const data = new Uint8ClampedArray([
			255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255
		]);

		const result = computeCropBox(data, width, height, [255, 255, 255, 255], 0);

		expect(result.box).toEqual({ x: 0, y: 0, width: 2, height: 2 });
	});
});

describe('computeCropBoxCancelable', () => {
	it('returns minimal box around non-matching content', async () => {
		const width = 4;
		const height = 4;
		const white = [255, 255, 255, 255] as const;
		const black = [0, 0, 0, 255] as const;
		const data = new Uint8ClampedArray(width * height * 4);

		for (let i = 0; i < width * height; i += 1) {
			data.set(white, i * 4);
		}

		for (const [x, y] of [
			[1, 1],
			[2, 1],
			[1, 2],
			[2, 2]
		] as const) {
			data.set(black, (y * width + x) * 4);
		}

		const box = await computeCropBoxCancelable(data, width, height, [255, 255, 255, 255], 0);

		expect(box).toEqual({ x: 1, y: 1, width: 2, height: 2 });
	});

	it('throws AbortError when signal is aborted', async () => {
		const width = 200;
		const height = 200;
		const data = new Uint8ClampedArray(width * height * 4);
		const controller = new AbortController();
		controller.abort();

		await expect(
			computeCropBoxCancelable(data, width, height, [255, 255, 255, 255], 10, {
				signal: controller.signal,
				chunkSize: 1_024
			})
		).rejects.toMatchObject({ name: 'AbortError' });
	});
});

describe('getMimeTypeFromFile', () => {
	it('preserves known output formats and falls back to png', () => {
		expect(getMimeTypeFromFile({ type: 'image/jpeg' } as File)).toBe('image/jpeg');
		expect(getMimeTypeFromFile({ type: 'image/gif' } as File)).toBe('image/gif');
		expect(getMimeTypeFromFile({ type: 'image/unknown' } as File)).toBe('image/png');
	});
});
