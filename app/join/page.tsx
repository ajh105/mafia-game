"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { validateName, validateRoomCode } from "@/lib/validation";
import { generateRoomCode } from "@/lib/room-code";
import { saveLocalPlayer } from "@/lib/storage";

export default function JoinPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const isHost = searchParams.get("host") === "true";

  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);

    const nameError = validateName(name);
    if (nameError) {
      setError(nameError);
      return;
    }

    let finalCode = roomCode.trim().toUpperCase();

    if (isHost) {
      finalCode = generateRoomCode();

      const { error: roomError } = await supabase.from("rooms").insert({
        code: finalCode,
        phase: "lobby",
        mafia_count: 1,
        moderator_player_id: null
      });

      if (roomError) {
        setError("Failed to create room");
        return;
      }
    } else {
      const codeError = validateRoomCode(finalCode);
      if (codeError) {
        setError(codeError);
        return;
      }

      const { data: room, error: roomError } = await supabase
        .from("rooms")
        .select("*")
        .eq("code", finalCode)
        .single();

      if (roomError || !room) {
        setError("Room not found");
        return;
      }
    }

    setIsLoading(true);

    const { data: player, error: playerError } = await supabase
      .from("players")
      .insert({
        room_code: finalCode,
        name: name.trim(),
        is_host: isHost,
        is_ready: false,
        is_alive: true,
        role: null
      })
      .select()
      .single();

    setIsLoading(false);

    if (playerError || !player) {
      setError("Failed to join room");
      return;
    }

    saveLocalPlayer(finalCode, {
      id: player.id,
      name: player.name,
      isHost: player.is_host
    });

    router.push(`/room/${finalCode}`);
  }

  return (
    <main className="page-shell">
      <div className="panel p-6 md:p-10 space-y-6 max-w-5xl w-full">
        <div>
          <Link href="/" className="helper-text hover:underline">
            ← Back
          </Link>
        </div>

        <div className="text-center space-y-2">
          <h1 className="text-3xl md:text-4xl font-bold">
            {isHost ? "Create Room" : "Join Room"}
          </h1>
        </div>

        <div className="card p-6 md:p-8 space-y-6">
          <div>
            <label className="label">Your Name</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your name"
            />
          </div>

          {!isHost && (
            <div>
              <label className="label">Room Code</label>
              <input
                className="input"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                placeholder="Enter code"
                maxLength={6}
              />
            </div>
          )}

          {error ? <p className="error-text">{error}</p> : null}

          <button
            onClick={handleSubmit}
            disabled={isLoading}
            className="button-primary w-full"
          >
            {isLoading
              ? "Loading..."
              : isHost
              ? "Create & Join"
              : "Join Room"}
          </button>
        </div>
      </div>
    </main>
  );
}