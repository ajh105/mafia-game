export type RoomPhase =
  | "lobby"
  | "reveal"
  | "reveal_waiting"
  | "night"
  | "day_announcement"
  | "voting"
  | "vote_resolution"
  | "game_over";

export type PlayerRole =
  | "moderator"
  | "mafia"
  | "doctor"
  | "angel"
  | "citizen";

export type Winner = "mafia" | "innocents" | null;

export interface RoomRow {
  code: string;
  phase: RoomPhase;
  mafia_count: number;
  moderator_player_id: string | null;
  created_at?: string;
}

export interface PlayerRow {
  id: string;
  room_code: string;
  name: string;
  is_host: boolean;
  is_ready: boolean;
  role: PlayerRole | null;
  is_alive: boolean;
  created_at?: string;
}

export interface RoundRow {
  room_code: string;
  night_target_player_id: string | null;
  doctor_save_player_id: string | null;
  night_result_player_id: string | null;
  night_result_saved: boolean | null;
  day_eliminated_player_id: string | null;
  winner: Winner;
  created_at?: string;
}

export interface VoteRow {
  id: string;
  room_code: string;
  voter_player_id: string;
  voted_for_player_id: string;
  created_at?: string;
}

export interface LocalPlayerSession {
  id: string;
  name: string;
  isHost: boolean;
}