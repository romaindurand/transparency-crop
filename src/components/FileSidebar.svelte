<script lang="ts">
	import type { LoadedFile } from '$lib/types';

	interface Props {
		files: LoadedFile[];
		activeFileId: string | null;
		onSelectFile: (id: string) => void;
	}

	const { files, activeFileId, onSelectFile }: Props = $props();
</script>

{#if files.length > 0}
	<aside
		class="flex h-full w-40 shrink-0 flex-col gap-2 overflow-y-auto rounded-xl bg-white/88 p-2 shadow-lg"
	>
		{#each files as file (file.id)}
			<button
				class="flex w-full cursor-pointer flex-col items-center gap-1 rounded-lg border-0 bg-transparent p-2 font-['Space_Grotesk'] transition-colors hover:bg-teal-500/15 {file.id ===
				activeFileId
					? 'bg-teal-500/25 shadow-[inset_3px_0_0_#14b8a6]'
					: ''}"
				onclick={() => onSelectFile(file.id)}
			>
				<img
					src={file.thumbnailUrl}
					alt={file.metadata.name}
					class="block h-auto w-full rounded object-contain"
				/>
				<span class="w-full truncate text-center text-xs text-gray-600">
					{file.metadata.name}
				</span>
			</button>
		{/each}
	</aside>
{/if}
