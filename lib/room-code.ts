const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateRoomCode(): string {
  let code = "";

  for (let i = 0; i < 6; i++) {
    const index = Math.floor(Math.random() * CHARS.length);
    code += CHARS[index];
  }

  return code;
}