<script lang="ts">
	import type { LoadedFile } from '$lib/types';

	interface Props {
		activeFile: LoadedFile | null;
		isDragOver: boolean;
		isLoading: boolean;
		onCanvasClick: (event: MouseEvent) => void;
		onCanvasWheel: (event: WheelEvent) => void;
		onMouseDown: (event: MouseEvent) => void;
		onMouseMove: (event: MouseEvent) => void;
		onMouseUp: () => void;
		onDragOver: (event: DragEvent) => void;
		onDragLeave: (event: DragEvent) => void;
		onDrop: (event: DragEvent) => void;
		onOpenFileDialog: () => void;
		canvasRef: HTMLCanvasElement | null;
		viewportRef: HTMLDivElement | null;
	}

	let {
		activeFile,
		isDragOver,
		isLoading,
		onCanvasClick,
		onCanvasWheel,
		onMouseDown,
		onMouseMove,
		onMouseUp,
		onDragOver,
		onDragLeave,
		onDrop,
		onOpenFileDialog,
		canvasRef = $bindable(),
		viewportRef = $bindable()
	}: Props = $props();
</script>

<section
	class="relative min-w-0 flex-1 overflow-hidden rounded-2xl bg-yellow-50/60"
	aria-label="Zone de dépôt d'image"
	ondragover={(event) => {
		event.preventDefault();
		onDragOver(event);
	}}
	ondragleave={onDragLeave}
	ondrop={onDrop}
>
	<!-- <div
		class="pointer-events-none absolute inset-x-0 -top-2/5 h-56 bg-linear-to-r from-cyan-300 to-yellow-300 opacity-10 blur-3xl"
	></div> -->

	<div class="relative h-full min-h-80" bind:this={viewportRef}>
		<canvas
			bind:this={canvasRef}
			class="block h-full w-full cursor-crosshair"
			tabindex="0"
			onclick={onCanvasClick}
			onwheel={onCanvasWheel}
			onmousedown={onMouseDown}
			onmousemove={onMouseMove}
			onmouseup={onMouseUp}
			onmouseleave={onMouseUp}
		></canvas>

		{#if !activeFile}
			<button
				class="absolute inset-0 grid cursor-pointer place-content-center gap-1 border-0 bg-white/78 font-['Space_Grotesk']"
				type="button"
				onclick={onOpenFileDialog}
			>
				<p class="m-0 text-2xl font-bold">Déposez des images</p>
				<p class="m-0 text-sm text-gray-600">ou cliquez pour les sélectionner</p>
			</button>
		{/if}

		{#if isDragOver}
			<div
				class="absolute inset-0 grid place-content-center bg-gray-900/35 text-lg font-semibold text-white"
			>
				Relâchez l'image pour la charger
			</div>
		{/if}

		{#if isLoading}
			<div
				class="absolute inset-0 grid place-content-center bg-gray-900/35 text-lg font-semibold text-white"
			>
				Chargement de l'image...
			</div>
		{/if}
	</div>
</section>
