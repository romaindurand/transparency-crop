<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		variant?: 'primary' | 'secondary' | 'danger';
		disabled?: boolean;
		onclick?: () => void;
		children?: Snippet;
	}

	const { variant = 'primary', disabled = false, onclick, children }: Props = $props();

	const variantClasses = {
		primary: 'bg-amber-500 text-white',
		secondary: 'bg-gray-200 text-gray-900',
		danger: 'bg-indigo-500 text-white'
	};
</script>

<button
	type="button"
	class="hover:enabled:bg-opacity-90 rounded-lg border-0 px-4 py-2 font-['Space_Grotesk'] font-semibold transition-transform duration-150 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-45 {variantClasses[
		variant
	]}"
	{disabled}
	{onclick}
>
	{@render children?.()}
</button>
