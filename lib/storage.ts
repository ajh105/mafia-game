import type { LocalPlayerSession } from "./types";

const PLAYER_PREFIX = "mafia-player:";

export function getPlayerStorageKey(code: string) {
  return `${PLAYER_PREFIX}${code.toUpperCase()}`;
}

export function saveLocalPlayer(code: string, player: LocalPlayerSession) {
  sessionStorage.setItem(getPlayerStorageKey(code), JSON.stringify(player));
}

export function loadLocalPlayer(code: string): LocalPlayerSession | null {
  const raw = sessionStorage.getItem(getPlayerStorageKey(code));

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as LocalPlayerSession;
  } catch {
    return null;
  }
}

export function clearLocalPlayer(code: string) {
  sessionStorage.removeItem(getPlayerStorageKey(code));
}