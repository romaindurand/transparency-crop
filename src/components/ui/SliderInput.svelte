<script lang="ts">
	interface Props {
		id: string;
		label: string;
		value: number;
		min?: number;
		max?: number;
		step?: number;
		onValueChange: (value: number) => void;
	}

	const { id, label, value, min = 0, max = 100, step = 1, onValueChange }: Props = $props();
</script>

<div class="grid gap-1">
	<label for={id} class="text-sm text-gray-700">{label}</label>
	<input
		{id}
		type="range"
		{min}
		{max}
		{step}
		{value}
		oninput={(event) => onValueChange(Number(event.currentTarget.value))}
		class="w-full"
	/>
</div>
