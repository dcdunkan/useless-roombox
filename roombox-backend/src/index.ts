import { default as express } from "express";
import { default as cors } from "cors";
import { Server } from "socket.io";
import { createServer } from "http";
import {
    adjectives,
    animals,
    colors,
    uniqueNamesGenerator,
} from "unique-names-generator";

const PORT = 3000;
const app = express();
app.use(cors());

const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
    },
});

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
    queue: QueueItem[];
    focusedItem: number;
    playbackState: "loading" | "playing" | "paused" | "finished";
}

interface RoomMember {
    socketId: string;
    name: string;
    role: "creator" | "member";
}

function generateRandomRoomName(): string {
    return uniqueNamesGenerator({
        dictionaries: [colors],
        separator: "-",
        style: "lowerCase",
    });
}

function generateRandomUserName(): string {
    return uniqueNamesGenerator({
        dictionaries: [adjectives, colors, animals],
        length: 3,
        separator: "-",
        style: "lowerCase",
    });
}

const ROOM_CODE_LENGTH = 6;

const DIGITS = "1234567890";

function generateRoomCode() {
    let code = "";
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        const randomDigit = Math.floor(Math.random() * DIGITS.length);
        code += randomDigit;
    }
    return code;
}

const PERMISSION_LEVEL: Record<Room["permission"], number> = {
    creator: 2,
    member: 1,
};

const rooms = new Map<string, Room>();

io.on("connection", (socket) => {
    console.log(socket.handshake.address);

    console.log("connected " + socket.id);

    socket.emit(
        "rooms_list",
        Array
            .from(rooms.entries())
            .map(([_, room]) => room),
    );

    socket.on("create_room", () => {
        for (const [_, room] of rooms) {
            const index = room.members
                .findIndex((member) => member.socketId === socket.id);
            if (index !== -1) {
                socket.emit("error:already_in_room");
                return;
            }
        }

        let roomCode: string;
        do {
            roomCode = generateRoomCode();
        } while (rooms.has(roomCode));
        const room: Room = {
            id: roomCode,
            name: generateRandomRoomName(), // todo: make this differ from user names
            hostSocket: socket.id,
            members: [{
                socketId: socket.id,
                role: "creator",
                name: generateRandomUserName(),
            }],
            permission: "creator",
            focusedItem: 0,
            queue: [],
            playbackState: "finished",
        };
        rooms.set(roomCode, room);
        socket.emit("room_hosted", room);
    });

    socket.on("join_room", (roomId) => {
        const room = rooms.get(roomId);
        if (room == null) {
            socket.emit("error:invalid_room_code");
            return;
        }

        for (const [_, room] of rooms) {
            const index = room.members
                .findIndex((member) => member.socketId === socket.id);
            if (index !== -1) {
                socket.emit("error:already_in_room");
                return;
            }
        }

        const newMember: RoomMember = {
            name: generateRandomUserName(),
            role: "member",
            socketId: socket.id,
        };

        io.to(room.members.map((member) => member.socketId))
            .emit("member_joined", newMember);

        room.members.push(newMember);
        socket.emit("joined_room", room);
    });

    function leaveRoom() {
        for (const [_, room] of rooms) {
            const index = room.members.findIndex((member) =>
                member.socketId === socket.id
            );
            if (index === -1) continue;
            const [removedMember] = room.members.splice(index, 1);
            io.to(room.members.map((member) => member.socketId))
                .emit("member_removed", removedMember);
            if (room.members.length === 0) {
                rooms.delete(room.id);
                socket.emit("deleted_room", room.id);
            }
            socket.emit("left_room");
            return true;
        }
        return false;
    }

    socket.on("leave_room", () => {
        if (leaveRoom()) return;
        socket.emit("error:not_in_a_room");
        return;
    });

    socket.on("change_room_permission", (permission: Room["permission"]) => {
        for (const [_, room] of rooms) {
            if (room.hostSocket !== socket.id) {
                continue;
            }

            if (
                permission !== "member" &&
                permission !== "creator"
            ) {
                socket.emit("error:not_your_floor");
                return;
            }

            room.permission = permission;

            io.to(room.members.map((member) => member.socketId))
                .emit("permission_set_changed", permission);

            return;
        }
        socket.emit("error:not_in_a_room");
    });

    socket.on("add_to_queue", (item: QueueItem) => {
        for (const [_, room] of rooms) {
            const member = room.members.find((member) =>
                member.socketId === socket.id
            );
            if (member == null) continue;

            if (
                PERMISSION_LEVEL[room.permission] >
                    PERMISSION_LEVEL[member.role]
            ) {
                socket.emit("error:no_permission_to_manage");
                return;
            }

            if (item.id == null || item.title == null) {
                socket.emit("error:invalid_addition");
                return;
            }

            room.queue.push({
                id: item.id,
                artists: item.artists,
                duration: item.duration,
                thumbnail: item.thumbnail,
                title: item.title,
                duration_seconds: item.duration_seconds,
            });

            io.to(room.members.map((member) => member.socketId))
                .emit("song_added_to_queue", item);

            return;
        }
        socket.emit("error:not_in_a_room");
    });

    socket.on("add_play_next", (item: QueueItem) => {
        for (const [_, room] of rooms) {
            const member = room.members.find((member) =>
                member.socketId === socket.id
            );
            if (member == null) continue;

            if (
                PERMISSION_LEVEL[room.permission] >
                    PERMISSION_LEVEL[member.role]
            ) {
                socket.emit("error:no_permission_to_manage");
                return;
            }

            if (item.id == null || item.title == null) {
                socket.emit("error:invalid_addition");
                return;
            }

            let pushIndex = Math.min(
                (room.focusedItem + 1) || 0,
                room.queue.length,
            );
            if (pushIndex == -1) pushIndex = 0;

            room.queue.splice(pushIndex, 0, {
                id: item.id,
                artists: item.artists,
                duration: item.duration,
                thumbnail: item.thumbnail,
                title: item.title,
                duration_seconds: item.duration_seconds,
            }); // todo: check for existence

            io.to(room.members.map((member) => member.socketId))
                .emit("song_added_to_next", item, pushIndex);

            return;
        }
        socket.emit("error:not_in_a_room");
    });

    socket.on("add_play_next_and_play", (item: QueueItem) => {
        for (const [_, room] of rooms) {
            const member = room.members.find((member) =>
                member.socketId === socket.id
            );
            if (member == null) continue;

            if (
                PERMISSION_LEVEL[room.permission] >
                    PERMISSION_LEVEL[member.role]
            ) {
                socket.emit("error:no_permission_to_manage");
                return;
            }

            if (item.id == null || item.title == null) {
                socket.emit("error:invalid_addition");
                return;
            }

            let pushIndex = Math.min(
                (room.focusedItem + 1) || 0,
                room.queue.length,
            );
            if (pushIndex == -1) pushIndex = 0;

            room.queue.splice(pushIndex, 0, {
                id: item.id,
                artists: item.artists,
                duration: item.duration,
                thumbnail: item.thumbnail,
                title: item.title,
                duration_seconds: item.duration_seconds,
            }); // todo: check for existence

            io.to(room.members.map((member) => member.socketId))
                .emit("song_added_to_next", item, pushIndex);

            room.focusedItem = pushIndex;
            room.playbackState = "loading";

            io.to(room.members.map((member) => member.socketId))
                .emit("playback_state", pushIndex, room.playbackState);

            return;
        }
        socket.emit("error:not_in_a_room");
    });

    socket.on("play_song", (index: number) => {
        for (const [_, room] of rooms) {
            const member = room.members.find((member) =>
                member.socketId === socket.id
            );
            if (member == null) continue;

            if (
                PERMISSION_LEVEL[room.permission] >
                    PERMISSION_LEVEL[member.role]
            ) {
                socket.emit("error:no_permission_to_manage");
                return;
            }

            const song = room.queue.at(index);
            if (song == null) {
                socket.emit("error:invalid_item");
                return;
            }

            room.focusedItem = index;
            room.playbackState = "loading";

            io.to(room.members.map((member) => member.socketId))
                .emit("playback_state", index, room.playbackState);

            return;
        }
        socket.emit("error:not_in_a_room");
    });

    socket.on("playback_state_change", (state: Room["playbackState"]) => {
        for (const [_, room] of rooms) {
            const member = room.members.find((member) =>
                member.socketId === socket.id
            );
            if (member == null) continue;

            if (
                PERMISSION_LEVEL[room.permission] >
                    PERMISSION_LEVEL[member.role]
            ) {
                socket.emit("error:no_permission_to_manage");
                return;
            }

            room.playbackState = state;
            io.to(room.members.map((member) => member.socketId))
                .emit("playback_state", room.focusedItem, room.playbackState);
            return;
        }
        socket.emit("error:not_in_a_room");
    });

    socket.on("disconnect", () => {
        leaveRoom();
        console.log("disconnected " + socket.id);
    });
});

server.listen(PORT, "0.0.0.0", () => {
    console.log("Servers running on port " + PORT);
});
