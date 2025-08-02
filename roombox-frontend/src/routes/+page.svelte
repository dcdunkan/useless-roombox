<script lang="ts">
	import { io, Socket } from "socket.io-client";
	import { Button, buttonVariants } from "$lib/components/ui/button";
	import * as InputOTP from "$lib/components/ui/input-otp";
	import clsx from "clsx";
	import { toast } from "svelte-sonner";
	import { slide } from "svelte/transition";
	import { Input } from "$lib/components/ui/input";
	import { type LoadedData } from "$lib/types";
	import * as Dialog from "$lib/components/ui/dialog";
	import {
		AudioLinesIcon,
		EllipsisVerticalIcon,
		Icon,
		ListMusicIcon,
		ListVideoIcon,
		LoaderCircleIcon,
		PauseIcon,
		PlayIcon,
		PlusIcon,
		SearchIcon,
		SkipBackIcon,
		SkipForwardIcon,
		UsersIcon,
		VideoIcon
	} from "lucide-svelte";
	import * as Command from "$lib/components/ui/command/index.js";
	import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
	import * as Select from "$lib/components/ui/select";
	import type { SearchResult } from "$lib/yt-types";
	import { onDestroy } from "svelte";

	let audioel = $state<HTMLAudioElement | null>(null);

	const STATES = {
		init: 0,
		connecting: 1,
		connection_error: 2,
		disconnected: 3,
		connected: 50,
		creating_room: 51,
		leaving_room: 52,
		in_room: 53
	};

	type State = keyof typeof STATES;

	const STATUS_MESSAGES: Record<State, string> = {
		init: "Initializing the connection...",
		connecting: "Connecting to server...",
		connection_error: "Error while connecting to server",
		connected: "Connected to server",
		disconnected: "Disconnected from server",
		creating_room: "Creating room...",
		in_room: "In room",
		leaving_room: "Leaving room..."
	};

	let userState = $state<State>("init");

	let socket: Socket | null = $state(null);

	interface QueueItem {
		title: string;
		id: string;
		thumbnail: string;
		duration: string;
		artists: string;
		duration_seconds: number;
	}

	interface Room {
		id: string;
		name: string;
		hostSocket: string;
		permission: "creator" | "member";
		members: RoomMember[];
		focusedItem: number;
		queue: QueueItem[];
		playbackState: "loading" | "playing" | "paused" | "finished";
	}
	interface RoomMember {
		socketId: string;
		name: string;
		role: "creator" | "member";
	}

	let currentRoom = $state<Room | null>(null);
	let me = $derived.by(() => {
		if (currentRoom == null) return null;
		const member = currentRoom.members.find((member) => socket?.id && member.socketId == socket.id);
		return member == null ? null : member;
	});

	const jamRoomPhrases = [
		"chilling in",
		"vibing in",
		"jamming in",
		"lost in",
		"camped up in",
		"tuning in at",
		"hanging out in",
		"grooving in",
		"rocking out in",
		"messing around in",
		"laying down tracks in",
		"riffing in",
		"spinning beats in",
		"freestyling in",
		"improvising in",
		"soundchecking in",
		"recording in",
		"mixing in",
		"jamming out in",
		"dropping bars in",
		"harmonizing in",
		"tapping in",
		"plugged in at",
		"losing track of time in",
		"bouncing ideas in",
		"warming up in"
	];
	type SearchDocument = SearchResult;

	const PERMISSION_STRINGS = {
		creator: "Creator",
		member: "Everyone"
	};

	let joinCode = $state("");
	let searchString = $state("");
	let searchResults = $state<LoadedData<SearchDocument[]>>({
		state: "resolved",
		data: []
	});

	let abortController: AbortController | null = null;

	async function performSearch(query: string) {
		if (query == null || query.trim().length == 0) {
			searchResults = { state: "resolved", data: [] };
			return;
		}
		if (abortController != null) {
			abortController.abort();
		}
		abortController = new AbortController();
		try {
			searchResults = { state: "pending", message: "One moment..." };
			const response = await fetch(
				`http://192.168.105.122:5000/search?q=${encodeURIComponent(query)}`,
				{
					signal: abortController.signal
				}
			);
			if (response.ok) {
				const results = (await response.json()) as SearchDocument[];
				searchResults = { state: "resolved", data: results };
			} else {
				searchResults = { state: "failed", message: "Failed to get search results" };
			}
		} catch (error) {
			if ((error as Error).name === "AbortError") {
				return;
			}
			searchResults = { state: "failed", message: "Something went wrong" };
		} finally {
			abortController = null;
		}
	}

	let debounceTimer: NodeJS.Timeout;

	function debouncedSearch(query: string) {
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			performSearch(query);
		}, 400);
	}

	$effect(() => {
		debouncedSearch(searchString);
	});

	onDestroy(() => {
		clearTimeout(debounceTimer);
		if (abortController != null) {
			abortController.abort();
		}
	});

	$effect(() => {
		if (socket != null) return;
		socket = io("ws://192.168.105.52:3000");
		userState = "connecting";

		// connections
		socket.on("connect", () => {
			userState = "connected";
		});
		socket.on("connect_error", () => {
			userState = "connection_error";
		});
		socket.on("disconnect", () => {
			userState = "disconnected";
		});

		// rooms
		function joinRoom(room: Room) {
			userState = "in_room";
			currentRoom = room;
		}

		socket.on("room_hosted", (room: Room) => {
			joinRoom(room);
			joinCode = room.id;
		});
		socket.on("deleted_room", (id) => {
			userState = "connected";
			if (currentRoom?.id == id) {
				currentRoom = null;
			}
		});
		socket.on("joined_room", (room) => {
			joinRoom(room);
		});
		socket.on("left_room", (id) => {
			userState = "connected";
			currentRoom = null;
		});
		socket.on("member_joined", (newMember) => {
			if (currentRoom == null) return;
			const index = currentRoom.members.findIndex(
				(member) => member.socketId === newMember.socketId
			);
			if (index == -1) currentRoom.members.push(newMember);
			else currentRoom.members.splice(index, 1, newMember); // if it happens so
		});
		socket.on("member_removed", (oldMember: RoomMember) => {
			if (currentRoom == null) return;
			const index = currentRoom.members.findIndex(
				(member) => member.socketId === oldMember.socketId
			);
			if (index != -1) currentRoom.members.splice(index, 1);
		});
		socket.on("permission_set_changed", (permission: Room["permission"]) => {
			if (currentRoom == null) return;
			currentRoom.permission = permission;
		});

		// songs
		socket.on("song_added_to_queue", (song: QueueItem) => {
			if (currentRoom == null) return;
			currentRoom.queue.push(song);
		});
		socket.on("song_added_to_next", (song: QueueItem, index: number) => {
			if (currentRoom == null) return;
			currentRoom.queue.splice(index, 0, song);
		});
		socket.on("playback_state", async (index: number, playbackState: Room["playbackState"]) => {
			if (currentRoom == null || socket == null) return;
			currentRoom.focusedItem = index;
			currentRoom.playbackState = playbackState;

			const song = currentRoom.queue.at(index);
			if (song == null) {
				toast.error("Something seems very wrang.");
				return;
			}

			if (audioel == null) {
				toast.error("its supposed to be there");
				return;
			}

			if (currentRoom.hostSocket === socket.id) {
				if (playbackState === "loading") {
					const response = await fetch(
						`http://192.168.105.122:5000/download?id=${encodeURIComponent(song.id)}`
					);
					if (response.ok) {
						const { message, filename, url } = (await response.json()) as {
							message: string;
							filename: string;
							url: string;
						};

						audioel.src = new URL(`/file/${song.id}.mp3`, "http://192.168.105.122:5000").href;
						audioel.play().then(() => {
							socket?.emit("playback_state_change", "playing");
						});
					} else {
						toast.error("Something went wrong.");
					}
				} else if (playbackState === "playing") {
					audioel.play();
				} else if (playbackState === "paused") {
					audioel.pause();
				}
			}
		});

		// errors
		socket.on("error:already_in_room", () => {
			toast.error("You are already in a room!");
		});
		socket.on("error:not_in_a_room", () => {
			toast.error("You are not in a room to leave!");
		});
		socket.on("error:invalid_room_code", () => {
			toast.error("Invalid room code!");
		});
		socket.on("error:no_permission_to_manage", () => {
			toast.error("You are not allowed to manage the playlist.");
		});
		socket.on("error:invalid_addition", () => {
			toast.error("Invalid item to be added!");
		});
		socket.on("error:invalid_item", () => {
			toast.error("Invalid item to be played!");
		});
		socket.on("error:not_your_floor", () => {
			toast.error("You have no permission to do that.");
		});
	});

	let showSearchMenu = $state(false);
	function handleKeydown(e: KeyboardEvent) {
		if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			showSearchMenu = !showSearchMenu;
		}
		if (e.key === " ") {
			e.preventDefault();
			if (currentRoom?.playbackState === "playing") socket?.emit("playback_state_change", "paused");
			else if (currentRoom?.playbackState === "paused")
				socket?.emit("playback_state_change", "playing");
		}
	}
	let showMembersMenu = $state(false);

	function getDetailsFromSearchResult(result: SearchDocument): {
		id: string;
		title: string;
		duration: string;
		thumbnail: string | null;
		artists: string | null;
		duration_seconds: number;
	} {
		switch (result.resultType) {
			case "video":
			case "song":
				return {
					id: result.videoId,
					title: result.title,
					duration: result.duration,
					thumbnail: result.thumbnails[0]?.url ?? null,
					artists:
						result.artists.length > 0
							? result.artists.map((artist) => artist.name).join(", ")
							: null,
					duration_seconds: result.duration_seconds
				};
			case "artist":
			case "profile":
			case "playlist":
			case "album":
				throw new Error("not implemented: unexpected type of search result obtained");
		}
	}
	const RESULT_TYPE_ICONS: Record<string, typeof Icon> = {
		video: VideoIcon,
		song: AudioLinesIcon
	};

	let isVisible = $state(true);
	let lastScrollY = $state(0);

	$effect(() => {
		const handleScroll = () => {
			const currentScrollY = window.scrollY;

			// Show FAB when scrolling up, hide when scrolling down
			if (currentScrollY < lastScrollY || currentScrollY < 100) {
				isVisible = true;
			} else if (currentScrollY > lastScrollY && currentScrollY > 100) {
				isVisible = false;
			}

			lastScrollY = currentScrollY;
		};

		window.addEventListener("scroll", handleScroll, { passive: true });

		return () => window.removeEventListener("scroll", handleScroll);
	});
</script>

<svelte:document onkeydown={handleKeydown} />

<div
	class={clsx("mx-auto min-h-screen max-w-screen-md space-y-6 p-8", {
		// "animate-bounce": currentRoom?.playbackState === "playing"
	})}
>
	<div class="flex flex-col place-items-center items-center justify-center space-y-2">
		{#if userState !== "in_room"}
			<div class="my-4 text-center" transition:slide>
				<h1 class="text-5xl font-bold">Roombox</h1>
				<div>Create a room or join one with a code.</div>
			</div>
		{/if}

		<div class="flex place-items-center gap-2">
			<InputOTP.Root
				maxlength={6}
				bind:value={joinCode}
				disabled={STATES[userState] !== STATES.connected}
			>
				{#snippet children({ cells })}
					<InputOTP.Group>
						{#each cells as cell (cell)}
							<InputOTP.Slot {cell} />
						{/each}
					</InputOTP.Group>
				{/snippet}
			</InputOTP.Root>
			<Button
				disabled={joinCode.length < 6 || STATES[userState] !== STATES.connected}
				onclick={() => {
					if (socket == null) return;
					if (STATES[userState] != STATES.connected) {
						return;
					}
					if (joinCode.length < 6) {
						return;
					}
					socket.emit("join_room", joinCode);
				}}
			>
				Join Room
			</Button>
			<Button
				disabled={STATES[userState] === STATES.creating_room}
				variant={currentRoom == null ? "default" : "destructive"}
				onclick={() => {
					if (socket == null) return;
					if (STATES[userState] < STATES.connected) {
						return;
					}
					if (STATES[userState] == STATES.creating_room) {
						return;
					}
					if (currentRoom == null) {
						userState = "creating_room";
						socket.emit("create_room");
					} else {
						userState = "leaving_room";
						joinCode = "";
						socket.emit("leave_room");
					}
				}}
			>
				{#if currentRoom == null}
					Create
				{:else}
					Leave
				{/if}
			</Button>
		</div>

		{#if userState !== "in_room"}
			<div class="text-center text-sm text-muted-foreground">
				{STATUS_MESSAGES[userState]}
			</div>
		{/if}
	</div>

	<audio
		bind:this={audioel}
		class="sr-only"
		onended={() => {
			if (currentRoom == null) return;
			const nextSong = currentRoom.queue.at(currentRoom.focusedItem + 1);
			if (nextSong == null) return;
			socket?.emit("play_song", currentRoom.focusedItem + 1);
		}}
	></audio>

	{#if currentRoom != null && me != null}
		{#snippet resultItem(result: SearchDocument)}
			{@const Icon = RESULT_TYPE_ICONS[result.resultType]}
			{@const details = getDetailsFromSearchResult(result)}
			<Command.Item
				value={details.id}
				class="flex place-items-center justify-between gap-2"
				onclick={() => {
					socket?.emit("add_play_next_and_play", details as QueueItem);
				}}
			>
				<div class="flex place-items-center gap-2 truncate **:truncate">
					{#if details.thumbnail}
						<img
							alt="thumbnail"
							loading="lazy"
							decoding="async"
							class="mr-4 aspect-square size-6"
							src={details.thumbnail}
						/>
					{:else}
						<Icon class="mr-2 size-6" />
					{/if}
					<div class="truncate **:truncate">
						<div>{details.title}</div>

						{#if details.artists}
							<div class="flex gap-1 text-xs text-muted-foreground">
								{details.artists}
							</div>
						{/if}
					</div>
				</div>

				<DropdownMenu.Root>
					<DropdownMenu.Trigger class={buttonVariants({ variant: "ghost", size: "icon" })}>
						<EllipsisVerticalIcon />
					</DropdownMenu.Trigger>
					<DropdownMenu.Content>
						<DropdownMenu.Group>
							<DropdownMenu.Item
								onclick={() => {
									if (socket == null) return;
									socket.emit("add_play_next", details as QueueItem);
								}}
							>
								Play next
							</DropdownMenu.Item>
							<DropdownMenu.Item
								onclick={() => {
									if (socket == null) return;
									socket.emit("add_to_queue", details as QueueItem);
								}}
							>
								Add to Queue
							</DropdownMenu.Item>
						</DropdownMenu.Group>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</Command.Item>
		{/snippet}

		<Command.Dialog bind:open={showSearchMenu} shouldFilter={false}>
			<Command.Input placeholder="Search" bind:value={searchString} />
			<Command.List>
				{#if searchString.trim().length == 0}
					<!-- {#if recentSearches.length > 0}
				<Command.Group heading="Recent searches">
					{#each recentSearches.slice(0, MAX_RECENT_SEARCH_ENTRIES) as recentResult}
						{@render resultItem(recentResult)}
					{/each}
				</Command.Group>
			{/if} -->
				{:else if searchResults.state === "pending"}
					<Command.Loading class="py-6 text-center text-sm">{searchResults.message}</Command.Loading
					>
				{:else if searchResults.state === "resolved"}
					{@const results = searchResults.data}
					<Command.Group>
						{#each results.filter((result) => result.resultType === "video" || result.resultType === "song") as result}
							{@render resultItem(result)}
						{/each}
					</Command.Group>
				{:else if searchResults.state === "failed"}
					<Command.Loading class="py-6 text-center text-sm">{searchResults.message}</Command.Loading
					>
				{/if}
			</Command.List>
		</Command.Dialog>

		<div transition:slide class="space-y-4">
			<div
				class="sticky top-0 z-10 flex place-items-center justify-between gap-2 border-t border-b bg-background py-4"
			>
				<div>
					<div
						class={clsx("text-sm text-muted-foreground", {
							"animate-spin": currentRoom.playbackState === "playing"
						})}
					>
						{jamRoomPhrases[Math.floor(Math.random() * jamRoomPhrases.length)]}
					</div>

					<div class="truncate text-3xl font-bold uppercase">{currentRoom.name}</div>
					<div>as <span class="truncate font-medium">{me.name}</span></div>
				</div>

				<div>
					<Button variant="ghost" onclick={() => (showSearchMenu = true)}>
						<SearchIcon />
					</Button>
					<Button variant="ghost" onclick={() => (showMembersMenu = true)}>
						<UsersIcon />
					</Button>

					<Dialog.Root bind:open={showMembersMenu}>
						<Dialog.Content
							class="top-8 flex h-[80vh] max-w-[90vw] translate-y-0 flex-col overflow-hidden rounded-md transition-all duration-150"
						>
							<Dialog.Header>
								<Dialog.Title>Room members ({currentRoom.members.length})</Dialog.Title>
								<Dialog.Description>
									{currentRoom.members.length} members
								</Dialog.Description>
							</Dialog.Header>

							<div class="flex-grow overflow-y-scroll rounded border">
								{#each currentRoom.members as member}
									<div class="border-b px-3 py-2">
										<div class="truncate">{member.name}</div>
										<div class="text-xs text-muted-foreground">
											{[
												...(member.socketId === me.socketId ? ["me"] : []),
												...(member.role !== "member" ? [member.role] : [])
											].join(", ")}
										</div>
									</div>
								{/each}
							</div>

							{#if socket?.id === currentRoom.hostSocket}
								<Dialog.Footer>
									<Select.Root
										type="single"
										value={currentRoom.permission}
										onValueChange={(value) => {
											if (currentRoom == null) return;
											socket?.emit("change_room_permission", value);
										}}
									>
										<Select.Trigger class="w-[180px]">
											{PERMISSION_STRINGS[currentRoom.permission]}
										</Select.Trigger>
										<Select.Content>
											<Select.Item value="creator">Creator</Select.Item>
											<Select.Item value="member">Everyone</Select.Item>
										</Select.Content>
									</Select.Root>
								</Dialog.Footer>
							{/if}
						</Dialog.Content>
					</Dialog.Root>
				</div>
			</div>

			<div class="truncate **:truncate">
				{#each currentRoom.queue as queueItem, i}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="flex place-items-center justify-between gap-2 px-4 py-4"
						onclick={() => {
							audioel?.pause();
							socket?.emit("play_song", i);
						}}
					>
						<div class="flex place-items-center gap-2">
							{#if queueItem.thumbnail}
								<img
									alt="thumbnail"
									loading="lazy"
									decoding="async"
									class="mr-4 aspect-square size-6"
									src={queueItem.thumbnail}
								/>
							{:else}
								<Icon class="mr-2 size-6" />
							{/if}
							<div class="truncate **:truncate">
								<div>{queueItem.title}</div>

								{#if queueItem.artists}
									<div class="flex gap-1 text-xs text-muted-foreground">
										{queueItem.artists}
									</div>
								{/if}
							</div>
						</div>

						<div class="flex place-items-center gap-2">
							{#if currentRoom.focusedItem == i}
								<AudioLinesIcon class="size-6" />
							{/if}

							<Button variant="ghost">
								<EllipsisVerticalIcon />
							</Button>
						</div>
					</div>
				{/each}
			</div>
		</div>

		<div
			class={clsx(
				"fixed bottom-0 left-1/2 z-50 -translate-x-1/2 transform transition-all duration-300 ease-in-out",
				isVisible ? "translate-y-0 scale-100 opacity-100" : "translate-y-16 scale-75 opacity-0"
			)}
		>
			<!-- <Button
			size="lg"
			class="h-14 w-14 rounded-full shadow-lg transition-all duration-200 hover:scale-105 hover:shadow-xl"
		>
			<PlusIcon class="h-6 w-6" />
			<span class="sr-only">Add new item</span>
		</Button> -->

			<div class="w-screen overflow-x-clip border-t bg-background">
				{#if currentRoom.queue[currentRoom.focusedItem] == null}
					<div class="flex place-items-center gap-4 p-6">
						No music is being played right now. Search and add one to get jamming.
					</div>
				{:else}
					{@const item = currentRoom.queue[currentRoom.focusedItem]}
					<!-- <div></div> -->
					<div class="flex place-items-center justify-between gap-4 p-6">
						<div class="flex place-items-center gap-4">
							<img class="aspect-square size-10" alt="thumb" src={item.thumbnail} />
							<div>
								<div class="font-medium">{item.title}</div>
								<div class="text-sm text-muted-foreground">{item.artists}</div>
							</div>
						</div>
						<div class="flex place-items-center gap-2">
							<Button
								variant="ghost"
								disabled={currentRoom.focusedItem <= 0}
								onclick={() => {
									if (currentRoom == null) return;
									if (currentRoom.focusedItem <= 0) return;
									socket?.emit("play_song", currentRoom.focusedItem - 1);
								}}
							>
								<SkipBackIcon />
							</Button>
							<Button
								variant="ghost"
								disabled={currentRoom.playbackState === "finished" ||
									currentRoom.playbackState === "loading"}
								onclick={() => {
									if (currentRoom?.playbackState === "paused")
										socket?.emit("playback_state_change", "playing");
									else if (currentRoom?.playbackState === "playing")
										socket?.emit("playback_state_change", "paused");
								}}
							>
								{#if currentRoom.playbackState === "paused"}
									<PlayIcon />
								{:else if currentRoom.playbackState === "playing"}
									<PauseIcon />
								{:else if currentRoom.playbackState === "loading"}
									<LoaderCircleIcon class="animate-spin" />
								{/if}
							</Button>
							<Button
								variant="ghost"
								disabled={currentRoom.focusedItem >= currentRoom.queue.length - 1}
								onclick={() => {
									if (currentRoom == null) return;
									if (currentRoom.focusedItem >= currentRoom.queue.length - 1) return;
									socket?.emit("play_song", currentRoom.focusedItem + 1);
								}}
							>
								<SkipForwardIcon />
							</Button>
						</div>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>
