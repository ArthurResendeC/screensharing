import type { Participant } from '../lib/signaling/messages';

const AVATAR_COLORS = ['#8fb98a', '#b98a9a', '#c8b48a', '#7b8ce8', '#c08a5a'];

export const participantName = (id: string) => `Participante ${id.slice(0, 8)}`;
export const displayName = (participant: Participant) =>
  participant.alias || participantName(participant.peerId);

export function initialsOf(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '??';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

export function avatarColor(name: string) {
  let sum = 0;
  for (let index = 0; index < name.length; index++)
    sum += name.charCodeAt(index);
  return AVATAR_COLORS[sum % AVATAR_COLORS.length];
}
