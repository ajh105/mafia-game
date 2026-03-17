import type { PlayerRole, PlayerRow, VoteRow, Winner } from "./types";

export const MIN_TOTAL_PLAYERS = 5;
export const RECOMMENDED_TOTAL_PLAYERS = 7;
export const DOCTOR_COUNT = 1;
export const ANGEL_COUNT = 1;
export const MAX_MAFIA = 3;

export function getRandomItem<T>(items: T[]): T {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  const index = array[0] % items.length;
  return items[index];
}

export function shuffleArray<T>(items: T[]): T[] {
  const copy = [...items];

  for (let i = copy.length - 1; i > 0; i--) {
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    const j = array[0] % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

export function getPlayerById(players: PlayerRow[], playerId: string): PlayerRow | undefined {
  return players.find((player) => player.id === playerId);
}

export function getModerator(players: PlayerRow[], moderatorPlayerId: string | null): PlayerRow | undefined {
  if (!moderatorPlayerId) {
    return undefined;
  }

  return players.find((player) => player.id === moderatorPlayerId);
}

export function isModerator(playerId: string, moderatorPlayerId: string | null): boolean {
  return !!moderatorPlayerId && playerId === moderatorPlayerId;
}

export function getNonModeratorPlayers(players: PlayerRow[], moderatorPlayerId: string | null): PlayerRow[] {
  return players.filter((player) => player.id !== moderatorPlayerId);
}

export function getAlivePlayers(players: PlayerRow[], moderatorPlayerId: string | null): PlayerRow[] {
  return getNonModeratorPlayers(players, moderatorPlayerId).filter((player) => player.is_alive);
}

export function getDeadPlayers(players: PlayerRow[], moderatorPlayerId: string | null): PlayerRow[] {
  return getNonModeratorPlayers(players, moderatorPlayerId).filter((player) => !player.is_alive);
}

export function getAliveMafiaPlayers(players: PlayerRow[], moderatorPlayerId: string | null): PlayerRow[] {
  return getAlivePlayers(players, moderatorPlayerId).filter((player) => player.role === "mafia");
}

export function getAliveInnocentPlayers(players: PlayerRow[], moderatorPlayerId: string | null): PlayerRow[] {
  return getAlivePlayers(players, moderatorPlayerId).filter((player) => player.role !== "mafia");
}

export function getMaxAllowedMafias(totalPlayers: number): number {
  const activePlayers = totalPlayers - 1;
  return Math.max(0, Math.min(MAX_MAFIA, activePlayers - 3));
}

export function isValidMafiaCount(totalPlayers: number, mafiaCount: number): boolean {
  const maxAllowed = getMaxAllowedMafias(totalPlayers);
  return mafiaCount >= 1 && mafiaCount <= maxAllowed;
}

export function canStartGame(
  players: PlayerRow[],
  moderatorPlayerId: string | null,
  mafiaCount: number
): boolean {
  if (players.length < MIN_TOTAL_PLAYERS) {
    return false;
  }

  if (!moderatorPlayerId) {
    return false;
  }

  const moderatorExists = players.some((player) => player.id === moderatorPlayerId);

  if (!moderatorExists) {
    return false;
  }

  return isValidMafiaCount(players.length, mafiaCount);
}

export function countReadyPlayers(players: PlayerRow[], moderatorPlayerId: string | null): number {
  return getNonModeratorPlayers(players, moderatorPlayerId).filter((player) => player.is_ready).length;
}

export function areAllActivePlayersReady(players: PlayerRow[], moderatorPlayerId: string | null): boolean {
  const activePlayers = getNonModeratorPlayers(players, moderatorPlayerId);

  if (activePlayers.length === 0) {
    return false;
  }

  return activePlayers.every((player) => player.is_ready);
}

export function assignRoles(
  players: PlayerRow[],
  moderatorPlayerId: string | null,
  mafiaCount: number
): Array<{ playerId: string; role: PlayerRole }> {
  const activePlayers = shuffleArray(getNonModeratorPlayers(players, moderatorPlayerId));

  if (activePlayers.length < 4) {
    throw new Error("Not enough active players to assign roles");
  }

  if (mafiaCount < 1) {
    throw new Error("Mafia count must be at least 1");
  }

  const neededPlayers = mafiaCount + DOCTOR_COUNT + ANGEL_COUNT + 1;

  if (activePlayers.length < neededPlayers) {
    throw new Error("Not enough players for selected mafia count");
  }

  const assignments: Array<{ playerId: string; role: PlayerRole }> = [];
  let index = 0;

  for (let i = 0; i < mafiaCount; i++) {
    assignments.push({ playerId: activePlayers[index].id, role: "mafia" });
    index++;
  }

  assignments.push({ playerId: activePlayers[index].id, role: "doctor" });
  index++;

  assignments.push({ playerId: activePlayers[index].id, role: "angel" });
  index++;

  while (index < activePlayers.length) {
    assignments.push({ playerId: activePlayers[index].id, role: "citizen" });
    index++;
  }

  if (moderatorPlayerId) {
    assignments.push({ playerId: moderatorPlayerId, role: "moderator" });
  }

  return assignments;
}

export function getMajorityNeeded(alivePlayerCount: number): number {
  return Math.ceil(alivePlayerCount / 2);
}

export function resolveNightAction(
  nightTargetPlayerId: string | null,
  doctorSavePlayerId: string | null
): {
  nightResultPlayerId: string | null;
  nightResultSaved: boolean | null;
  eliminatedPlayerId: string | null;
} {
  if (!nightTargetPlayerId) {
    return {
      nightResultPlayerId: null,
      nightResultSaved: null,
      eliminatedPlayerId: null
    };
  }

  const saved = nightTargetPlayerId === doctorSavePlayerId;

  return {
    nightResultPlayerId: nightTargetPlayerId,
    nightResultSaved: saved,
    eliminatedPlayerId: saved ? null : nightTargetPlayerId
  };
}

export function tallyVotes(votes: VoteRow[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const vote of votes) {
    counts.set(vote.voted_for_player_id, (counts.get(vote.voted_for_player_id) ?? 0) + 1);
  }

  return counts;
}

export function resolveVotes(
  votes: VoteRow[],
  alivePlayerCount: number
): {
  eliminatedPlayerId: string | null;
  highestVoteCount: number;
  majorityNeeded: number;
  isTie: boolean;
} {
  const counts = tallyVotes(votes);
  const majorityNeeded = getMajorityNeeded(alivePlayerCount);

  let highestVoteCount = 0;
  let eliminatedPlayerId: string | null = null;
  let isTie = false;

  for (const [playerId, count] of counts.entries()) {
    if (count > highestVoteCount) {
      highestVoteCount = count;
      eliminatedPlayerId = playerId;
      isTie = false;
    } else if (count === highestVoteCount) {
      isTie = true;
    }
  }

  if (isTie || highestVoteCount < majorityNeeded) {
    return {
      eliminatedPlayerId: null,
      highestVoteCount,
      majorityNeeded,
      isTie
    };
  }

  return {
    eliminatedPlayerId,
    highestVoteCount,
    majorityNeeded,
    isTie
  };
}

export function checkWinCondition(
  players: PlayerRow[],
  moderatorPlayerId: string | null
): Winner {
  const aliveMafiaCount = getAliveMafiaPlayers(players, moderatorPlayerId).length;
  const aliveInnocentCount = getAliveInnocentPlayers(players, moderatorPlayerId).length;

  if (aliveMafiaCount === 0) {
    return "innocents";
  }

  if (aliveMafiaCount >= aliveInnocentCount) {
    return "mafia";
  }

  return null;
}