<script lang="ts">
	import "../app.css";
	import favicon from "$lib/assets/favicon.svg";
	import { Toaster } from "$lib/components/ui/sonner";
	import { ModeWatcher } from "mode-watcher";

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Roombox</title>
</svelte:head>

<ModeWatcher defaultMode="dark" />
<Toaster richColors position="bottom-center" />

{@render children?.()}
