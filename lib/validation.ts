export function validateName(name: string): string | null {
  const trimmed = name.trim();

  if (trimmed.length < 2) {
    return "Name must be at least 2 characters";
  }

  if (trimmed.length > 14) {
    return "Name must be under 14 characters";
  }

  const valid = /^[a-zA-Z0-9 _]+$/;

  if (!valid.test(trimmed)) {
    return "Only letters, numbers, spaces, and _ allowed";
  }

  return null;
}

export function validateRoomCode(code: string): string | null {
  const trimmed = code.trim().toUpperCase();

  if (trimmed.length !== 6) {
    return "Room code must be 6 characters";
  }

  const valid = /^[A-Z0-9]+$/;

  if (!valid.test(trimmed)) {
    return "Invalid room code";
  }

  return null;
}