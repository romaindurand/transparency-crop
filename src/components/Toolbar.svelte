<script lang="ts">
	import type { RGBA } from '$lib/types';
	import Button from './ui/Button.svelte';
	import SliderInput from './ui/SliderInput.svelte';

	interface Props {
		tolerance: number;
		selectedColor: RGBA | null;
		canCrop: boolean;
		isCroppingAll: boolean;
		filesCount: number;
		onToleranceChange: (value: number) => void;
		onDownloadCrop: () => void;
		onCropAllToZip: () => void;
	}

	const {
		tolerance,
		selectedColor,
		canCrop,
		isCroppingAll,
		filesCount,
		onToleranceChange,
		onDownloadCrop,
		onCropAllToZip
	}: Props = $props();

	const selectedColorCss = $derived(
		selectedColor
			? `rgba(${selectedColor[0]}, ${selectedColor[1]}, ${selectedColor[2]}, ${selectedColor[3] / 255})`
			: 'transparent'
	);
</script>

<section class="grid h-full grid-cols-[1fr_auto_auto] gap-3 rounded-lg bg-white/88 p-3 shadow-lg">
	<SliderInput
		id="tolerance"
		label={`Tolérance: ${tolerance}%`}
		min={0}
		max={100}
		step={1}
		value={tolerance}
		onValueChange={onToleranceChange}
	/>

	<div class="grid gap-1">
		<span class="text-sm text-gray-700">Couleur</span>
		{#if selectedColor !== null}
			<div class="flex items-center gap-2">
				<div
					class="h-7 w-7 rounded border border-gray-900/20"
					style={`background: linear-gradient(45deg, #e5e7eb 25%, transparent 25%),
                    linear-gradient(-45deg, #e5e7eb 25%, transparent 25%),
                    linear-gradient(45deg, transparent 75%, #e5e7eb 75%),
                    linear-gradient(-45deg, transparent 75%, #e5e7eb 75%);
                    background-size: 10px 10px;
                    background-position: 0 0, 0 5px, 5px -5px, -5px 0;
                    background-color: ${selectedColorCss};`}
				></div>
				<small class="text-xs text-gray-600">
					rgba({selectedColor[0]}, {selectedColor[1]}, {selectedColor[2]}, {selectedColor[3]})
				</small>
			</div>
		{:else}
			<span class="text-sm text-gray-400">Aucune</span>
		{/if}
	</div>

	<div class="flex items-center gap-2">
		<Button variant="primary" disabled={!canCrop} onclick={onDownloadCrop}>Crop</Button>
		{#if filesCount > 1}
			<Button variant="danger" disabled={isCroppingAll} onclick={onCropAllToZip}>
				{isCroppingAll ? 'Traitement…' : 'Crop all'}
			</Button>
		{/if}
	</div>
</section>
