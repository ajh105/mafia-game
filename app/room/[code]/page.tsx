"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { clearLocalPlayer, loadLocalPlayer, saveLocalPlayer } from "@/lib/storage";
import type { PlayerRow, RoomRow, RoundRow, VoteRow } from "@/lib/types";
import {
  MIN_TOTAL_PLAYERS,
  RECOMMENDED_TOTAL_PLAYERS,
  areAllActivePlayersReady,
  assignRoles,
  canStartGame,
  checkWinCondition,
  countReadyPlayers,
  getAlivePlayers,
  getDeadPlayers,
  getMajorityNeeded,
  getMaxAllowedMafias,
  getModerator,
  getNonModeratorPlayers,
  isModerator,
  resolveNightAction,
  resolveVotes,
  tallyVotes
} from "@/lib/game";

function getInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || "?";
}

function getRoleTitle(role: PlayerRow["role"]) {
  switch (role) {
    case "mafia":
      return "Mafia";
    case "doctor":
      return "Doctor";
    case "angel":
      return "Angel";
    case "citizen":
      return "Citizen";
    case "moderator":
      return "Moderator";
    default:
      return "Unknown";
  }
}

function getRoleDescription(role: PlayerRow["role"]) {
  switch (role) {
    case "mafia":
      return "Work with the other mafia to eliminate players.";
    case "doctor":
      return "Choose one player each night to save, including yourself.";
    case "angel":
      return "Point to one player each night and the moderator will confirm yes or no if they are mafia.";
    case "citizen":
      return "Figure out who the mafia are and vote them out.";
    case "moderator":
      return "Guide the round and manage the night and day phases.";
    default:
      return "";
  }
}

export default function RoomPage() {
  const params = useParams();
  const router = useRouter();

  const roomCode =
    typeof params.code === "string" ? params.code.toUpperCase() : "";

  const [room, setRoom] = useState<RoomRow | null>(null);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [round, setRound] = useState<RoundRow | null>(null);
  const [votes, setVotes] = useState<VoteRow[]>([]);
  const [localPlayer, setLocalPlayer] = useState<PlayerRow | null>(null);

  const [isBusy, setIsBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const [hasRevealedRole, setHasRevealedRole] = useState(false);
  const [selectedVoteTarget, setSelectedVoteTarget] = useState("");
  const [selectedNightTarget, setSelectedNightTarget] = useState("");
  const [selectedDoctorSave, setSelectedDoctorSave] = useState("");

  const fetchRoomState = useCallback(async () => {
    const storedPlayer = loadLocalPlayer(roomCode);

    if (!storedPlayer) {
      router.push("/join");
      return;
    }

    const [
      { data: roomData, error: roomError },
      { data: playerData, error: playerError },
      { data: roundData, error: roundError },
      { data: votesData, error: votesError }
    ] = await Promise.all([
      supabase
        .from("rooms")
        .select("code, phase, mafia_count, moderator_player_id, created_at")
        .eq("code", roomCode)
        .maybeSingle(),
      supabase
        .from("players")
        .select("id, room_code, name, is_host, is_ready, role, is_alive, created_at")
        .eq("room_code", roomCode)
        .order("created_at", { ascending: true }),
      supabase
        .from("rounds")
        .select(
          "room_code, night_target_player_id, doctor_save_player_id, night_result_player_id, night_result_saved, day_eliminated_player_id, winner, created_at"
        )
        .eq("room_code", roomCode)
        .maybeSingle(),
      supabase
        .from("votes")
        .select("id, room_code, voter_player_id, voted_for_player_id, created_at")
        .eq("room_code", roomCode)
    ]);

    if (roomError || playerError || votesError || !roomData || !playerData) {
      clearLocalPlayer(roomCode);
      router.push("/join");
      return;
    }

    if (roundError) {
      console.error(roundError);
    }

    const currentPlayer = playerData.find((player) => player.id === storedPlayer.id);

    if (!currentPlayer) {
      clearLocalPlayer(roomCode);
      router.push("/join");
      return;
    }

    setRoom(roomData as RoomRow);
    setPlayers(playerData as PlayerRow[]);
    setRound((roundData as RoundRow | null) ?? null);
    setVotes((votesData as VoteRow[]) ?? []);
    setLocalPlayer(currentPlayer as PlayerRow);

    saveLocalPlayer(roomCode, {
      id: currentPlayer.id,
      name: currentPlayer.name,
      isHost: currentPlayer.is_host
    });
  }, [roomCode, router]);

  useEffect(() => {
    if (!roomCode) {
      return;
    }

    void fetchRoomState();

    const channel = supabase
      .channel(`mafia-room-${roomCode}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "rooms",
          filter: `code=eq.${roomCode}`
        },
        () => {
          void fetchRoomState();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "players",
          filter: `room_code=eq.${roomCode}`
        },
        () => {
          void fetchRoomState();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "rounds",
          filter: `room_code=eq.${roomCode}`
        },
        () => {
          void fetchRoomState();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "votes",
          filter: `room_code=eq.${roomCode}`
        },
        () => {
          void fetchRoomState();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [roomCode, fetchRoomState]);

  useEffect(() => {
    setHasRevealedRole(false);
    setSelectedNightTarget("");
    setSelectedDoctorSave("");

    if (room?.phase !== "voting") {
      setSelectedVoteTarget("");
    }
  }, [room?.phase]);

  useEffect(() => {
    if (!localPlayer) {
      return;
    }

    const localVote = votes.find((vote) => vote.voter_player_id === localPlayer.id);
    setSelectedVoteTarget(localVote?.voted_for_player_id ?? "");
  }, [votes, localPlayer]);

  const isHost = localPlayer?.is_host ?? false;
  const localPlayerIsModerator =
    !!localPlayer && !!room && isModerator(localPlayer.id, room.moderator_player_id);

  const moderator = useMemo(() => {
    if (!room) {
      return undefined;
    }

    return getModerator(players, room.moderator_player_id);
  }, [players, room]);

  const activePlayers = useMemo(() => {
    if (!room) {
      return [];
    }

    return getNonModeratorPlayers(players, room.moderator_player_id);
  }, [players, room]);

  const alivePlayers = useMemo(() => {
    if (!room) {
      return [];
    }

    return getAlivePlayers(players, room.moderator_player_id);
  }, [players, room]);

  const deadPlayers = useMemo(() => {
    if (!room) {
      return [];
    }

    return getDeadPlayers(players, room.moderator_player_id);
  }, [players, room]);

  const readyCount = room ? countReadyPlayers(players, room.moderator_player_id) : 0;
  const localVote = votes.find((vote) => vote.voter_player_id === localPlayer?.id);
  const maxAllowedMafias = getMaxAllowedMafias(players.length);
  const canStart = room
    ? canStartGame(players, room.moderator_player_id, room.mafia_count)
    : false;

  const voteCountMap = useMemo(() => tallyVotes(votes), [votes]);
  const sortedVoteTallies = useMemo(() => {
    return Array.from(voteCountMap.entries()).sort((a, b) => b[1] - a[1]);
  }, [voteCountMap]);

  const moderatorNightStep = useMemo(() => {
    if (!round) {
      return "mafia";
    }

    if (!round.night_target_player_id) {
      return "mafia";
    }

    if (!round.doctor_save_player_id) {
      return "doctor";
    }

    return "angel";
  }, [round]);

  const mafiaTargetOptions = useMemo(() => {
    return alivePlayers;
  }, [alivePlayers]);

  const doctorSaveOptions = useMemo(() => {
    return alivePlayers;
  }, [alivePlayers]);

  async function handleCopyRoomCode() {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      alert("Could not copy room code.");
    }
  }

  async function handleSetModerator(playerId: string) {
    if (!room || !isHost || room.phase !== "lobby" || isBusy) {
      return;
    }

    try {
      setIsBusy(true);

      const { error } = await supabase
        .from("rooms")
        .update({ moderator_player_id: playerId })
        .eq("code", room.code);

      if (error) {
        throw error;
      }

      await fetchRoomState();
    } catch (error) {
      console.error(error);
      alert("Could not update moderator.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSetMafiaCount(nextCount: number) {
    if (!room || !isHost || room.phase !== "lobby" || isBusy) {
      return;
    }

    const clamped = Math.max(1, Math.min(nextCount, Math.max(1, maxAllowedMafias)));

    try {
      setIsBusy(true);

      const { error } = await supabase
        .from("rooms")
        .update({ mafia_count: clamped })
        .eq("code", room.code);

      if (error) {
        throw error;
      }

      await fetchRoomState();
    } catch (error) {
      console.error(error);
      alert("Could not update mafia count.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleKickPlayer(playerId: string) {
    if (!room || !isHost || room.phase !== "lobby" || isBusy) {
      return;
    }

    if (playerId === localPlayer?.id) {
      return;
    }

    try {
      setIsBusy(true);

      const remainingPlayers = players.filter((player) => player.id !== playerId);

      const kickedPlayerWasModerator = room.moderator_player_id === playerId;

      const { error: deletePlayerError } = await supabase
        .from("players")
        .delete()
        .eq("id", playerId);

      if (deletePlayerError) {
        throw deletePlayerError;
      }

      if (remainingPlayers.length === 0) {
        const { error: deleteRoomError } = await supabase
          .from("rooms")
          .delete()
          .eq("code", room.code);

        if (deleteRoomError) {
          throw deleteRoomError;
        }

        router.push("/");
        return;
      }

      if (kickedPlayerWasModerator) {
        const fallbackModerator =
          remainingPlayers.find((player) => player.is_host) ?? remainingPlayers[0];

        const { error: roomUpdateError } = await supabase
          .from("rooms")
          .update({ moderator_player_id: fallbackModerator?.id ?? null })
          .eq("code", room.code);

        if (roomUpdateError) {
          throw roomUpdateError;
        }
      }

      await fetchRoomState();
    } catch (error) {
      console.error(error);
      alert("Could not kick player.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleStartGame() {
    if (!room || !isHost || !canStart || isBusy) {
      return;
    }

    try {
      setIsBusy(true);

      const assignments = assignRoles(players, room.moderator_player_id, room.mafia_count);

      const roleMap = new Map(assignments.map((entry) => [entry.playerId, entry.role]));

      const { error: deleteVotesError } = await supabase
        .from("votes")
        .delete()
        .eq("room_code", room.code);

      if (deleteVotesError) {
        throw deleteVotesError;
      }

      const playerUpdates = players.map((player) =>
        supabase
          .from("players")
          .update({
            is_ready: false,
            is_alive: true,
            role: roleMap.get(player.id) ?? null
          })
          .eq("id", player.id)
      );

      const playerResults = await Promise.all(playerUpdates);

      for (const result of playerResults) {
        if (result.error) {
          throw result.error;
        }
      }

      const { error: upsertRoundError } = await supabase.from("rounds").upsert({
        room_code: room.code,
        night_target_player_id: null,
        doctor_save_player_id: null,
        night_result_player_id: null,
        night_result_saved: null,
        day_eliminated_player_id: null,
        winner: null
      });

      if (upsertRoundError) {
        throw upsertRoundError;
      }

      const { error: roomUpdateError } = await supabase
        .from("rooms")
        .update({ phase: "reveal" })
        .eq("code", room.code);

      if (roomUpdateError) {
        throw roomUpdateError;
      }

      await fetchRoomState();
    } catch (error) {
      console.error(error);
      alert("Could not start the game.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleReady() {
    if (!room || !localPlayer || room.phase !== "reveal" || isBusy || localPlayerIsModerator) {
      return;
    }

    const thisPlayer = players.find((player) => player.id === localPlayer.id);

    if (!thisPlayer || thisPlayer.is_ready) {
      return;
    }

    try {
      setIsBusy(true);

      const { error: readyError } = await supabase
        .from("players")
        .update({ is_ready: true })
        .eq("id", localPlayer.id);

      if (readyError) {
        throw readyError;
      }

      const { data: updatedPlayers, error: playerError } = await supabase
        .from("players")
        .select("id, room_code, name, is_host, is_ready, role, is_alive, created_at")
        .eq("room_code", room.code);

      if (playerError || !updatedPlayers) {
        throw playerError;
      }

      if (areAllActivePlayersReady(updatedPlayers as PlayerRow[], room.moderator_player_id)) {
        const { error: roomUpdateError } = await supabase
          .from("rooms")
          .update({ phase: "reveal_waiting" })
          .eq("code", room.code);

        if (roomUpdateError) {
          throw roomUpdateError;
        }
      }

      await fetchRoomState();
    } catch (error) {
      console.error(error);
      alert("Could not mark ready.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleReturnToLobby() {
    if (!room || !localPlayerIsModerator || isBusy) {
      return;
    }

    try {
      setIsBusy(true);

      const { error: deleteVotesError } = await supabase
        .from("votes")
        .delete()
        .eq("room_code", room.code);

      if (deleteVotesError) {
        throw deleteVotesError;
      }

      const { error: deleteRoundError } = await supabase
        .from("rounds")
        .delete()
        .eq("room_code", room.code);

      if (deleteRoundError) {
        throw deleteRoundError;
      }

      const playerResets = players.map((player) =>
        supabase
          .from("players")
          .update({
            is_ready: false,
            is_alive: true,
            role: null
          })
          .eq("id", player.id)
      );

      const resetResults = await Promise.all(playerResets);

      for (const result of resetResults) {
        if (result.error) {
          throw result.error;
        }
      }

      const clampedMafiaCount = Math.max(
        1,
        Math.min(room.mafia_count, Math.max(1, getMaxAllowedMafias(players.length)))
      );

      const { error: roomUpdateError } = await supabase
        .from("rooms")
        .update({
          phase: "lobby",
          mafia_count: clampedMafiaCount
        })
        .eq("code", room.code);

      if (roomUpdateError) {
        throw roomUpdateError;
      }

      await fetchRoomState();
    } catch (error) {
      console.error(error);
      alert("Could not return to lobby.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleStartNight() {
    if (!room || !localPlayerIsModerator || room.phase !== "reveal_waiting" || isBusy) {
      return;
    }

    try {
      setIsBusy(true);

      const { error: resetRoundError } = await supabase.from("rounds").upsert({
        room_code: room.code,
        night_target_player_id: null,
        doctor_save_player_id: null,
        night_result_player_id: null,
        night_result_saved: null,
        day_eliminated_player_id: null,
        winner: round?.winner ?? null
      });

      if (resetRoundError) {
        throw resetRoundError;
      }

      const { error: roomUpdateError } = await supabase
        .from("rooms")
        .update({ phase: "night" })
        .eq("code", room.code);

      if (roomUpdateError) {
        throw roomUpdateError;
      }

      await fetchRoomState();
    } catch (error) {
      console.error(error);
      alert("Could not start night phase.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleConfirmNightTarget() {
    if (!room || !round || !localPlayerIsModerator || isBusy || !selectedNightTarget) {
      return;
    }

    try {
      setIsBusy(true);

      const { error } = await supabase
        .from("rounds")
        .update({ night_target_player_id: selectedNightTarget })
        .eq("room_code", room.code);

      if (error) {
        throw error;
      }

      await fetchRoomState();
    } catch (error) {
      console.error(error);
      alert("Could not save mafia target.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleBackToMafiaStep() {
    if (!room || !localPlayerIsModerator || isBusy) {
      return;
    }

    try {
      setIsBusy(true);

      const { error } = await supabase
        .from("rounds")
        .update({
          night_target_player_id: null,
          doctor_save_player_id: null
        })
        .eq("room_code", room.code);

      if (error) {
        throw error;
      }

      await fetchRoomState();
    } catch (error) {
      console.error(error);
      alert("Could not go back.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleConfirmDoctorSave() {
    if (!room || !round || !localPlayerIsModerator || isBusy || !selectedDoctorSave) {
      return;
    }

    try {
      setIsBusy(true);

      const { error } = await supabase
        .from("rounds")
        .update({ doctor_save_player_id: selectedDoctorSave })
        .eq("room_code", room.code);

      if (error) {
        throw error;
      }

      await fetchRoomState();
    } catch (error) {
      console.error(error);
      alert("Could not save doctor choice.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleBackToDoctorStep() {
    if (!room || !localPlayerIsModerator || isBusy) {
      return;
    }

    try {
      setIsBusy(true);

      const { error } = await supabase
        .from("rounds")
        .update({ doctor_save_player_id: null })
        .eq("room_code", room.code);

      if (error) {
        throw error;
      }

      await fetchRoomState();
    } catch (error) {
      console.error(error);
      alert("Could not go back.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleContinueFromAngel() {
    if (!room || !round || !localPlayerIsModerator || isBusy) {
      return;
    }

    try {
      setIsBusy(true);

      const result = resolveNightAction(
        round.night_target_player_id,
        round.doctor_save_player_id
      );

      if (result.eliminatedPlayerId) {
        const { error: eliminateError } = await supabase
          .from("players")
          .update({ is_alive: false })
          .eq("id", result.eliminatedPlayerId);

        if (eliminateError) {
          throw eliminateError;
        }
      }

      const { error: updateRoundError } = await supabase
        .from("rounds")
        .update({
          night_result_player_id: result.nightResultPlayerId,
          night_result_saved: result.nightResultSaved,
          day_eliminated_player_id: null
        })
        .eq("room_code", room.code);

      if (updateRoundError) {
        throw updateRoundError;
      }

      const { error: roomUpdateError } = await supabase
        .from("rooms")
        .update({ phase: "day_announcement" })
        .eq("code", room.code);

      if (roomUpdateError) {
        throw roomUpdateError;
      }

      await fetchRoomState();
    } catch (error) {
      console.error(error);
      alert("Could not continue to daytime.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleStartVoting() {
    if (!room || !localPlayerIsModerator || room.phase !== "day_announcement" || isBusy) {
      return;
    }

    try {
      setIsBusy(true);

      const { error: deleteVotesError } = await supabase
        .from("votes")
        .delete()
        .eq("room_code", room.code);

      if (deleteVotesError) {
        throw deleteVotesError;
      }

      const { error: roomUpdateError } = await supabase
        .from("rooms")
        .update({ phase: "voting" })
        .eq("code", room.code);

      if (roomUpdateError) {
        throw roomUpdateError;
      }

      await fetchRoomState();
    } catch (error) {
      console.error(error);
      alert("Could not start voting.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSubmitVote() {
    if (
      !room ||
      !localPlayer ||
      !selectedVoteTarget ||
      isBusy ||
      localPlayerIsModerator ||
      !alivePlayers.some((player) => player.id === localPlayer.id)
    ) {
      return;
    }

    try {
      setIsBusy(true);

      const { error: deleteOldVoteError } = await supabase
        .from("votes")
        .delete()
        .eq("room_code", room.code)
        .eq("voter_player_id", localPlayer.id);

      if (deleteOldVoteError) {
        throw deleteOldVoteError;
      }

      const { error: insertVoteError } = await supabase.from("votes").insert({
        room_code: room.code,
        voter_player_id: localPlayer.id,
        voted_for_player_id: selectedVoteTarget
      });

      if (insertVoteError) {
        throw insertVoteError;
      }

      const { data: updatedVotes, error: votesError } = await supabase
        .from("votes")
        .select("id, room_code, voter_player_id, voted_for_player_id, created_at")
        .eq("room_code", room.code);

      if (votesError || !updatedVotes) {
        throw votesError;
      }

      if (updatedVotes.length === alivePlayers.length) {
        const { error: roomUpdateError } = await supabase
          .from("rooms")
          .update({ phase: "vote_resolution" })
          .eq("code", room.code);

        if (roomUpdateError) {
          throw roomUpdateError;
        }
      }

      await fetchRoomState();
    } catch (error) {
      console.error(error);
      alert("Could not submit vote.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleContinueAfterVoteResolution() {
    if (!room || !round || !localPlayerIsModerator || room.phase !== "vote_resolution" || isBusy) {
      return;
    }

    try {
      setIsBusy(true);

      const resolution = resolveVotes(votes, alivePlayers.length);

      let nextPlayers = [...players];

      if (resolution.eliminatedPlayerId) {
        const { error: eliminateError } = await supabase
          .from("players")
          .update({ is_alive: false })
          .eq("id", resolution.eliminatedPlayerId);

        if (eliminateError) {
          throw eliminateError;
        }

        nextPlayers = players.map((player) =>
          player.id === resolution.eliminatedPlayerId
            ? { ...player, is_alive: false }
            : player
        );
      }

      const winner = checkWinCondition(nextPlayers, room.moderator_player_id);

      const { error: updateRoundError } = await supabase
        .from("rounds")
        .update({
          day_eliminated_player_id: resolution.eliminatedPlayerId,
          winner
        })
        .eq("room_code", room.code);

      if (updateRoundError) {
        throw updateRoundError;
      }

      if (winner) {
        const { error: roomUpdateError } = await supabase
          .from("rooms")
          .update({ phase: "game_over" })
          .eq("code", room.code);

        if (roomUpdateError) {
          throw roomUpdateError;
        }
      } else {
        const { error: deleteVotesError } = await supabase
          .from("votes")
          .delete()
          .eq("room_code", room.code);

        if (deleteVotesError) {
          throw deleteVotesError;
        }

        const { error: resetRoundError } = await supabase
          .from("rounds")
          .update({
            night_target_player_id: null,
            doctor_save_player_id: null,
            night_result_player_id: null,
            night_result_saved: null,
            day_eliminated_player_id: null,
            winner: null
          })
          .eq("room_code", room.code);

        if (resetRoundError) {
          throw resetRoundError;
        }

        const { error: roomUpdateError } = await supabase
          .from("rooms")
          .update({ phase: "night" })
          .eq("code", room.code);

        if (roomUpdateError) {
          throw roomUpdateError;
        }
      }

      await fetchRoomState();
    } catch (error) {
      console.error(error);
      alert("Could not continue.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleLeaveRoom() {
    if (!room || !localPlayer || isBusy) {
      router.push("/");
      return;
    }

    try {
      setIsBusy(true);

      const leavingPlayerId = localPlayer.id;
      const wasHost = localPlayer.is_host;
      const wasModerator = room.moderator_player_id === leavingPlayerId;
      const leavingDuringActivePhase = room.phase !== "lobby";
      const remainingPlayers = players.filter((player) => player.id !== leavingPlayerId);

      const { error: deleteVoteError } = await supabase
        .from("votes")
        .delete()
        .eq("room_code", room.code)
        .eq("voter_player_id", leavingPlayerId);

      if (deleteVoteError) {
        throw deleteVoteError;
      }

      const { error: deletePlayerError } = await supabase
        .from("players")
        .delete()
        .eq("id", leavingPlayerId);

      if (deletePlayerError) {
        throw deletePlayerError;
      }

      if (remainingPlayers.length === 0) {
        const { error: deleteRoomError } = await supabase
          .from("rooms")
          .delete()
          .eq("code", room.code);

        if (deleteRoomError) {
          throw deleteRoomError;
        }

        clearLocalPlayer(room.code);
        router.push("/");
        return;
      }

      if (wasHost) {
        const nextHost = remainingPlayers[0];

        const { error: promoteError } = await supabase
          .from("players")
          .update({ is_host: true })
          .eq("id", nextHost.id);

        if (promoteError) {
          throw promoteError;
        }
      }

      let nextModeratorId = room.moderator_player_id;

      if (wasModerator) {
        const existingHost =
          remainingPlayers.find((player) => player.is_host && player.id !== leavingPlayerId) ??
          remainingPlayers[0];

        nextModeratorId = existingHost?.id ?? remainingPlayers[0].id;
      }

      const clampedMafiaCount = Math.max(
        1,
        Math.min(room.mafia_count, Math.max(1, getMaxAllowedMafias(remainingPlayers.length)))
      );

      if (leavingDuringActivePhase) {
        const { error: deleteVotesError } = await supabase
          .from("votes")
          .delete()
          .eq("room_code", room.code);

        if (deleteVotesError) {
          throw deleteVotesError;
        }

        const { error: deleteRoundError } = await supabase
          .from("rounds")
          .delete()
          .eq("room_code", room.code);

        if (deleteRoundError) {
          throw deleteRoundError;
        }

        const resetUpdates = remainingPlayers.map((player) =>
          supabase
            .from("players")
            .update({
              is_ready: false,
              is_alive: true,
              role: null
            })
            .eq("id", player.id)
        );

        const resetResults = await Promise.all(resetUpdates);

        for (const result of resetResults) {
          if (result.error) {
            throw result.error;
          }
        }

        const { error: roomUpdateError } = await supabase
          .from("rooms")
          .update({
            phase: "lobby",
            moderator_player_id: nextModeratorId,
            mafia_count: clampedMafiaCount
          })
          .eq("code", room.code);

        if (roomUpdateError) {
          throw roomUpdateError;
        }
      } else {
        const { error: roomUpdateError } = await supabase
          .from("rooms")
          .update({
            moderator_player_id: nextModeratorId,
            mafia_count: clampedMafiaCount
          })
          .eq("code", room.code);

        if (roomUpdateError) {
          throw roomUpdateError;
        }
      }

      clearLocalPlayer(room.code);
      router.push("/");
    } catch (error) {
      console.error(error);
      alert("Could not leave room.");
    } finally {
      setIsBusy(false);
    }
  }

  if (!room || !localPlayer) {
    return null;
  }

  if (room.phase === "reveal") {
    if (localPlayerIsModerator) {
      return (
        <main className="page-shell">
          <div className="panel max-w-2xl p-6 md:p-10">
            <div className="card p-6 md:p-10 text-center space-y-5">
              <h1 className="text-3xl md:text-4xl font-bold">Moderator</h1>
              <p className="helper-text text-lg">
                Waiting for players to reveal their roles and mark ready.
              </p>
              <p className="helper-text">
                {readyCount} of {activePlayers.length} players ready
              </p>

              <button
                onClick={handleReturnToLobby}
                className="button-secondary w-full"
                disabled={isBusy}
              >
                Return to Lobby
              </button>
            </div>
          </div>
        </main>
      );
    }

    const thisPlayer = players.find((player) => player.id === localPlayer.id);
    const alreadyReady = thisPlayer?.is_ready ?? false;

    if (alreadyReady) {
      return (
        <main className="page-shell">
          <div className="panel max-w-2xl p-6 md:p-10">
            <div className="card p-6 md:p-10 text-center space-y-5">
              <h1 className="text-3xl md:text-4xl font-bold">Waiting for everyone...</h1>
              <p className="helper-text text-lg">
                Wait until the moderator starts the night phase.
              </p>
              <p className="helper-text">
                {readyCount} of {activePlayers.length} players ready
              </p>
            </div>
          </div>
        </main>
      );
    }

    if (!hasRevealedRole) {
      return (
        <main className="page-shell">
          <div className="panel max-w-2xl p-6 md:p-10">
            <div className="card p-6 md:p-10 text-center space-y-6">
              <h1 className="text-3xl md:text-4xl font-bold">Role Reveal</h1>
              <p className="helper-text text-lg">
                Make sure nobody can see your phone before revealing your role.
              </p>
              <button
                onClick={() => setHasRevealedRole(true)}
                className="button-primary w-full"
              >
                Reveal Role
              </button>
            </div>
          </div>
        </main>
      );
    }

    return (
      <main className="page-shell">
        <div className="panel max-w-2xl p-6 md:p-10">
          <div className="card p-6 md:p-10 text-center space-y-6">
            <h1 className="text-3xl md:text-4xl font-bold">
              Your Role
            </h1>

            <div className="rounded-3xl border border-blue-500/30 bg-blue-500/10 px-6 py-8">
              <p className="text-4xl md:text-5xl font-extrabold">
                {getRoleTitle(localPlayer.role)}
              </p>
            </div>

            <p className="helper-text text-lg">
              {getRoleDescription(localPlayer.role)}
            </p>

            <button
              onClick={handleReady}
              className="button-primary w-full"
              disabled={isBusy}
            >
              Ready
            </button>

            <p className="helper-text">
              {readyCount} of {activePlayers.length} players ready
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (room.phase === "reveal_waiting") {
    return (
      <main className="page-shell">
        <div className="panel max-w-2xl p-6 md:p-10">
          <div className="card p-6 md:p-10 text-center space-y-6">
            <h1 className="text-3xl md:text-4xl font-bold">Everyone is ready</h1>
            <p className="helper-text text-lg">
              Wait for the moderator to begin the night phase.
            </p>

            {localPlayerIsModerator ? (
              <div className="flex flex-col gap-3">
                <button
                  onClick={handleStartNight}
                  className="button-primary w-full"
                  disabled={isBusy}
                >
                  Start Night Phase
                </button>
                <button
                  onClick={handleReturnToLobby}
                  className="button-secondary w-full"
                  disabled={isBusy}
                >
                  Return to Lobby
                </button>
              </div>
            ) : (
              <p className="helper-text">Only the moderator can continue.</p>
            )}
          </div>
        </div>
      </main>
    );
  }

  if (room.phase === "night") {
    if (!localPlayerIsModerator) {
      return (
        <main className="page-shell">
          <div className="panel max-w-2xl p-6 md:p-10">
            <div className="card p-6 md:p-10 text-center space-y-6">
              <h1 className="text-3xl md:text-4xl font-bold">Nighttime</h1>
              <p className="helper-text text-lg">
                Close your eyes and lower your head.
              </p>
              <p className="helper-text">
                Try not to close or refresh the app during the game.
              </p>
            </div>
          </div>
        </main>
      );
    }

    return (
      <main className="page-shell">
        <div className="panel max-w-3xl p-6 md:p-10">
          <div className="card p-6 md:p-10 space-y-6">
            {moderatorNightStep === "mafia" && (
              <>
                <div className="space-y-2 text-center">
                  <h1 className="text-3xl md:text-4xl font-bold">Mafia Step</h1>
                  <p className="helper-text">
                    Ask the mafia who they want to eliminate, then confirm their target.
                  </p>
                </div>

                <div className="space-y-3">
                  {mafiaTargetOptions.map((player) => {
                    const disabled = player.role === "mafia";
                    const selected = selectedNightTarget === player.id;

                    return (
                      <button
                        key={player.id}
                        type="button"
                        onClick={() => {
                          if (!disabled) {
                            setSelectedNightTarget(player.id);
                          }
                        }}
                        className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                          disabled
                            ? "border-slate-800 bg-slate-900/40 opacity-50 cursor-not-allowed"
                            : selected
                            ? "border-blue-500 bg-blue-500/10"
                            : "border-slate-700 bg-slate-900/40"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-600 text-white font-bold">
                            {getInitial(player.name)}
                          </div>
                          <div>
                            <p className="font-semibold">{player.name}</p>
                            <p className="helper-text text-sm">
                              {disabled ? "Mafia cannot be targeted" : "Selectable target"}
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <button
                  onClick={handleConfirmNightTarget}
                  className="button-primary w-full"
                  disabled={!selectedNightTarget || isBusy}
                >
                  Confirm Elimination Target
                </button>
              </>
            )}

            {moderatorNightStep === "doctor" && (
              <>
                <div className="space-y-2 text-center">
                  <h1 className="text-3xl md:text-4xl font-bold">Doctor Step</h1>
                  <p className="helper-text">
                    Ask the doctor who they want to save. They may choose anyone, including themselves.
                  </p>
                </div>

                <div className="space-y-3">
                  {doctorSaveOptions.map((player) => {
                    const selected = selectedDoctorSave === player.id;

                    return (
                      <button
                        key={player.id}
                        type="button"
                        onClick={() => setSelectedDoctorSave(player.id)}
                        className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                          selected
                            ? "border-blue-500 bg-blue-500/10"
                            : "border-slate-700 bg-slate-900/40"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-600 text-white font-bold">
                            {getInitial(player.name)}
                          </div>
                          <div>
                            <p className="font-semibold">{player.name}</p>
                            <p className="helper-text text-sm">Selectable save</p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    onClick={handleBackToMafiaStep}
                    className="button-secondary w-full"
                    disabled={isBusy}
                  >
                    Back
                  </button>
                  <button
                    onClick={handleConfirmDoctorSave}
                    className="button-primary w-full"
                    disabled={!selectedDoctorSave || isBusy}
                  >
                    Confirm Save
                  </button>
                </div>
              </>
            )}

            {moderatorNightStep === "angel" && (
              <>
                <div className="space-y-2 text-center">
                  <h1 className="text-3xl md:text-4xl font-bold">Angel Step</h1>
                  <p className="helper-text">
                    Ask the angel who they want to investigate. Confirm yes or no in person.
                  </p>
                </div>

                <div className="card p-5 space-y-3 text-center">
                  <p className="helper-text">
                    Once the angel has pointed at a player and you have responded, continue to daytime.
                  </p>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    onClick={handleBackToDoctorStep}
                    className="button-secondary w-full"
                    disabled={isBusy}
                  >
                    Back
                  </button>
                  <button
                    onClick={handleContinueFromAngel}
                    className="button-primary w-full"
                    disabled={isBusy}
                  >
                    Start Daytime
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </main>
    );
  }

  if (room.phase === "day_announcement") {
    const targetedPlayer = players.find(
      (player) => player.id === round?.night_result_player_id
    );

    if (localPlayerIsModerator) {
      return (
        <main className="page-shell">
          <div className="panel max-w-5xl p-6 md:p-10 space-y-6">
            <div className="card p-6 md:p-8 space-y-4 text-center">
              <h1 className="text-3xl md:text-4xl font-bold">Day Announcement</h1>

              {round?.night_result_player_id ? (
                round?.night_result_saved ? (
                  <>
                    <p className="text-xl font-semibold text-emerald-400">
                      {targetedPlayer?.name ?? "The targeted player"} was saved.
                    </p>
                    <p className="helper-text">No one was eliminated during the night.</p>
                  </>
                ) : (
                  <>
                    <p className="text-xl font-semibold text-rose-400">
                      {targetedPlayer?.name ?? "A player"} was eliminated.
                    </p>
                    <p className="helper-text">
                      Announce the result to the group, then begin voting.
                    </p>
                  </>
                )
              ) : (
                <p className="helper-text">No night result was recorded.</p>
              )}

              <div className="flex flex-col gap-3">
                <button
                  onClick={handleStartVoting}
                  className="button-primary w-full"
                  disabled={isBusy}
                >
                  Start Voting
                </button>

                <button
                  onClick={handleReturnToLobby}
                  className="button-secondary w-full"
                  disabled={isBusy}
                >
                  Return to Lobby
                </button>
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <section className="card p-6 space-y-4">
                <h2 className="text-2xl font-bold">Alive Players</h2>
                <div className="space-y-3">
                  {alivePlayers.map((player) => (
                    <div
                      key={player.id}
                      className="flex items-center justify-between rounded-2xl border border-slate-700 bg-slate-900/40 px-4 py-3"
                    >
                      <div>
                        <p className="font-semibold">{player.name}</p>
                        <p className="helper-text text-sm">{getRoleTitle(player.role)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="card p-6 space-y-4">
                <h2 className="text-2xl font-bold">Dead Players</h2>
                <div className="space-y-3">
                  {deadPlayers.length === 0 ? (
                    <p className="helper-text">No dead players yet.</p>
                  ) : (
                    deadPlayers.map((player) => (
                      <div
                        key={player.id}
                        className="flex items-center justify-between rounded-2xl border border-slate-700 bg-slate-900/40 px-4 py-3"
                      >
                        <div>
                          <p className="font-semibold">{player.name}</p>
                          <p className="helper-text text-sm">{getRoleTitle(player.role)}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </div>
          </div>
        </main>
      );
    }

    if (!localPlayer.is_alive) {
      return (
        <main className="page-shell">
          <div className="panel max-w-3xl p-6 md:p-10">
            <div className="card p-6 md:p-10 text-center space-y-5">
              <h1 className="text-3xl md:text-4xl font-bold">You are eliminated</h1>
              <p className="helper-text text-lg">
                Wait for the moderator to begin the voting phase.
              </p>

              <div className="grid gap-4 sm:grid-cols-2 text-left">
                <div className="card p-4 space-y-3">
                  <h2 className="text-xl font-bold">Alive</h2>
                  {alivePlayers.map((player) => (
                    <p key={player.id} className="helper-text">
                      {player.name}
                    </p>
                  ))}
                </div>
                <div className="card p-4 space-y-3">
                  <h2 className="text-xl font-bold">Dead</h2>
                  {deadPlayers.map((player) => (
                    <p key={player.id} className="helper-text">
                      {player.name}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </main>
      );
    }

    return (
      <main className="page-shell">
        <div className="panel max-w-2xl p-6 md:p-10">
          <div className="card p-6 md:p-10 text-center space-y-5">
            <h1 className="text-3xl md:text-4xl font-bold">Daytime</h1>
            <p className="helper-text text-lg">
              Wait for the moderator to announce the result and begin voting.
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (room.phase === "voting") {
    if (localPlayerIsModerator) {
      return (
        <main className="page-shell">
          <div className="panel max-w-2xl p-6 md:p-10">
            <div className="card p-6 md:p-10 text-center space-y-5">
              <h1 className="text-3xl md:text-4xl font-bold">Voting In Progress</h1>
              <p className="helper-text text-lg">Waiting for votes...</p>

              <p className="text-2xl font-bold">
                {votes.length} / {alivePlayers.length} votes submitted
              </p>

              <button
                onClick={handleReturnToLobby}
                className="button-secondary w-full"
                disabled={isBusy}
              >
                Return to Lobby
              </button>
            </div>
          </div>
        </main>
      );
    }

    if (!localPlayer.is_alive) {
      return (
        <main className="page-shell">
          <div className="panel max-w-2xl p-6 md:p-10">
            <div className="card p-6 md:p-10 text-center space-y-5">
              <h1 className="text-3xl md:text-4xl font-bold">You are eliminated</h1>
              <p className="helper-text text-lg">
                The remaining players are voting. Please wait.
              </p>
              <div className="grid gap-4 sm:grid-cols-2 text-left">
                <div className="card p-4 space-y-3">
                  <h2 className="text-xl font-bold">Alive</h2>
                  {alivePlayers.map((player) => (
                    <p key={player.id} className="helper-text">
                      {player.name}
                    </p>
                  ))}
                </div>
                <div className="card p-4 space-y-3">
                  <h2 className="text-xl font-bold">Dead</h2>
                  {deadPlayers.map((player) => (
                    <p key={player.id} className="helper-text">
                      {player.name}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </main>
      );
    }

    return (
      <main className="page-shell">
        <div className="panel max-w-3xl p-6 md:p-10">
          <div className="card p-6 md:p-10 space-y-6">
            <div className="text-center space-y-2">
              <h1 className="text-3xl md:text-4xl font-bold">Vote</h1>
              <p className="helper-text">
                Select one player to vote out. You can change your vote until everyone has submitted.
              </p>
            </div>

            <div className="space-y-3">
              {alivePlayers.map((player) => {
                const selected = selectedVoteTarget === player.id;

                return (
                  <button
                    key={player.id}
                    type="button"
                    onClick={() => setSelectedVoteTarget(player.id)}
                    className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                      selected
                        ? "border-blue-500 bg-blue-500/10"
                        : "border-slate-700 bg-slate-900/40"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-600 text-white font-bold">
                        {getInitial(player.name)}
                      </div>

                      <div>
                        <p className="font-semibold">{player.name}</p>
                        <p className="helper-text text-sm">
                          {player.id === localPlayer.id ? "You" : ""}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            <button
              onClick={handleSubmitVote}
              className="button-primary w-full"
              disabled={!selectedVoteTarget || isBusy}
            >
              {localVote ? "Update Vote" : "Submit Vote"}
            </button>

            <p className="helper-text text-center">
              Waiting for votes... {votes.length} / {alivePlayers.length} votes submitted
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (room.phase === "vote_resolution") {
    const resolution = resolveVotes(votes, alivePlayers.length);
    const eliminatedPlayer = players.find(
      (player) => player.id === resolution.eliminatedPlayerId
    );

    if (localPlayerIsModerator) {
      return (
        <main className="page-shell">
          <div className="panel max-w-4xl p-6 md:p-10 space-y-6">
            <div className="card p-6 md:p-10 text-center space-y-4">
              <h1 className="text-3xl md:text-4xl font-bold">Vote Resolution</h1>
              <p className="helper-text">
                Majority needed: {getMajorityNeeded(alivePlayers.length)}
              </p>

              {resolution.eliminatedPlayerId ? (
                <p className="text-xl font-semibold text-rose-400">
                  {eliminatedPlayer?.name ?? "A player"} was voted out.
                </p>
              ) : (
                <p className="text-xl font-semibold text-amber-300">
                  No one was eliminated.
                </p>
              )}

              <button
                onClick={handleContinueAfterVoteResolution}
                className="button-primary w-full"
                disabled={isBusy}
              >
                Continue
              </button>
            </div>

            <div className="card p-6 space-y-4">
              <h2 className="text-2xl font-bold">Vote Totals</h2>
              <div className="space-y-3">
                {sortedVoteTallies.length === 0 ? (
                  <p className="helper-text">No votes found.</p>
                ) : (
                  sortedVoteTallies.map(([playerId, count]) => {
                    const player = players.find((entry) => entry.id === playerId);

                    return (
                      <div
                        key={playerId}
                        className="flex items-center justify-between rounded-2xl border border-slate-700 bg-slate-900/40 px-4 py-3"
                      >
                        <p className="font-semibold">{player?.name ?? "Unknown Player"}</p>
                        <p className="helper-text">
                          {count} vote{count === 1 ? "" : "s"}
                        </p>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </main>
      );
    }

    return (
      <main className="page-shell">
        <div className="panel max-w-2xl p-6 md:p-10">
          <div className="card p-6 md:p-10 text-center space-y-5">
            <h1 className="text-3xl md:text-4xl font-bold">Resolving Votes</h1>
            <p className="helper-text text-lg">
              Waiting for the moderator to continue.
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (room.phase === "game_over") {
    return (
      <main className="page-shell">
        <div className="panel max-w-4xl p-6 md:p-10 space-y-6">
          <div className="card p-6 md:p-10 text-center space-y-4">
            <h1 className="text-3xl md:text-4xl font-bold">Game Over</h1>
            <p
              className={`text-2xl font-bold ${
                round?.winner === "mafia" ? "text-rose-400" : "text-emerald-400"
              }`}
            >
              {round?.winner === "mafia" ? "Mafia Wins" : "Innocents Win"}
            </p>

            {localPlayerIsModerator ? (
              <button
                onClick={handleReturnToLobby}
                className="button-primary w-full"
                disabled={isBusy}
              >
                Return to Lobby
              </button>
            ) : (
              <p className="helper-text">Waiting for the moderator to return to the lobby.</p>
            )}
          </div>

          <div className="card p-6 space-y-4">
            <h2 className="text-2xl font-bold">Final Roles</h2>
            <div className="space-y-3">
              {players.map((player) => {
                const moderatorBadge =
                  room.moderator_player_id === player.id ? "Moderator" : null;

                return (
                  <div
                    key={player.id}
                    className="flex items-center justify-between rounded-2xl border border-slate-700 bg-slate-900/40 px-4 py-3"
                  >
                    <div>
                      <p className="font-semibold">{player.name}</p>
                      <p className="helper-text text-sm">
                        {getRoleTitle(player.role)} • {player.is_alive ? "Alive" : "Dead"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {player.is_host ? (
                        <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold">
                          Host
                        </span>
                      ) : null}
                      {moderatorBadge ? (
                        <span className="rounded-full bg-blue-600/20 px-3 py-1 text-xs font-semibold text-blue-200">
                          Moderator
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="page-shell">
      <div className="panel max-w-5xl p-6 md:p-10 space-y-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button onClick={handleLeaveRoom} className="helper-text hover:underline">
            ← Leave Room
          </button>

          <div className="flex items-center gap-3 self-start sm:self-auto">
            <div className="card px-4 py-2">
              <span className="helper-text">Room Code: </span>
              <span className="font-bold tracking-widest">{room.code}</span>
            </div>

            <button onClick={handleCopyRoomCode} className="button-secondary">
              {copied ? "Copied!" : "Copy Code"}
            </button>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="card p-6 md:p-8 space-y-6">
            <div className="space-y-2">
              <h1 className="text-3xl md:text-4xl font-bold">Lobby</h1>
              <p className="helper-text">
                Share the room code with friends.
              </p>
            </div>

            <div className="card p-5 space-y-4">
              <div>
                <p className="text-sm uppercase tracking-[0.2em] text-slate-400">
                  Moderator
                </p>
              </div>

              <select
                className="input"
                value={room.moderator_player_id ?? ""}
                onChange={(e) => void handleSetModerator(e.target.value)}
                disabled={!isHost || isBusy}
              >
                <option value="" disabled>
                  Select moderator
                </option>
                {players.map((player) => (
                  <option key={player.id} value={player.id}>
                    {player.name}
                    {player.is_host ? " (Host)" : ""}
                  </option>
                ))}
              </select>

              <p className="helper-text">
                {isHost
                  ? "They will facilitate the round."
                  : `Moderator: ${moderator?.name ?? "Not selected"}`}
              </p>
            </div>

            <div className="card p-5 space-y-4">
              <div>
                <p className="text-sm uppercase tracking-[0.2em] text-slate-400">
                  Mafia Count
                </p>
              </div>

              <select
                className="input"
                value={room.mafia_count}
                onChange={(e) => void handleSetMafiaCount(Number(e.target.value))}
                disabled={!isHost || isBusy}
              >
                {Array.from({
                  length: Math.max(1, maxAllowedMafias)
                }).map((_, index) => {
                  const value = index + 1;
                  return (
                    <option key={value} value={value}>
                      {value} Mafia
                    </option>
                  );
                })}
              </select>

              <p className="helper-text">
                Max allowed right now: {Math.max(1, maxAllowedMafias)}
              </p>
            </div>

            {isHost ? (
              <button
                onClick={handleStartGame}
                className="button-primary w-full"
                disabled={!canStart || isBusy}
              >
                Start Game
              </button>
            ) : (
              <button className="button-secondary w-full" disabled>
                Waiting for Host
              </button>
            )}

            {!room.moderator_player_id ? (
              <p className="helper-text">Select a moderator before starting.</p>
            ) : players.length < MIN_TOTAL_PLAYERS ? (
              <p className="helper-text">
                Need {MIN_TOTAL_PLAYERS - players.length} more player
                {MIN_TOTAL_PLAYERS - players.length === 1 ? "" : "s"} to start.
              </p>
            ) : room.mafia_count > Math.max(1, maxAllowedMafias) ? (
              <p className="helper-text">The mafia count is too high for this group size.</p>
            ) : (
              <p className="helper-text">
                {isHost
                  ? "You can start when everyone is ready."
                  : "Waiting for the host to start."}
              </p>
            )}
          </section>

          <aside className="card p-6 md:p-8 space-y-5">
            <div>
              <h2 className="text-2xl font-bold">Players</h2>
            </div>

            <div className="space-y-3">
              {players.map((player) => {
                const playerIsModerator = room.moderator_player_id === player.id;

                return (
                  <div
                    key={player.id}
                    className="rounded-2xl border border-slate-700 bg-slate-900/40 px-4 py-3"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white font-bold">
                        {getInitial(player.name)}
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{player.name}</p>

                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {player.is_host ? (
                            <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold">
                              Host
                            </span>
                          ) : null}

                          {playerIsModerator ? (
                            <span className="rounded-full bg-blue-600/20 px-3 py-1 text-xs font-semibold text-blue-200">
                              Moderator
                            </span>
                          ) : null}

                          {isHost && room.phase === "lobby" && player.id !== localPlayer?.id ? (
                            <button
                              onClick={() => void handleKickPlayer(player.id)}
                              className="rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs font-semibold text-red-300 transition hover:bg-red-500/20"
                              disabled={isBusy}
                            >
                              Kick
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}