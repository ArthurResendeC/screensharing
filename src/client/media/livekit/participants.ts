import { type Participant as LiveKitParticipant, RemoteParticipant, Track } from 'livekit-client';
import { ALIAS_MAX_LENGTH, type Participant } from '../../../lib/signaling/messages';

// LiveKit é a fonte de presença: um participante "transmite" quando publica uma track
// com source screen_share. O apelido vem de Participant.name (definido no JWT e
// atualizável com setName), normalizado como no servidor de signaling.
export function isSharing(participant: LiveKitParticipant): boolean {
  return participant.getTrackPublications().some(publication => publication.source === Track.Source.ScreenShare);
}

export function toParticipant(participant: LiveKitParticipant): Participant {
  const alias = participant.name?.trim().slice(0, ALIAS_MAX_LENGTH);
  return { peerId: participant.identity, sharing: isSharing(participant), alias: alias || null };
}

// Monta um MediaStream com o vídeo (e o áudio, quando houver) da tela compartilhada,
// pronto para <video srcObject>. MediaVideo consome MediaStream sem alterações.
export function screenShareStream(participant: RemoteParticipant): MediaStream | null {
  const video = participant.getTrackPublication(Track.Source.ScreenShare)?.videoTrack?.mediaStreamTrack;
  if (!video) return null;
  const audio = participant.getTrackPublication(Track.Source.ScreenShareAudio)?.audioTrack?.mediaStreamTrack;
  return new MediaStream(audio ? [video, audio] : [video]);
}

export function screenShareTrackSid(participant: RemoteParticipant): string | null {
  return participant.getTrackPublication(Track.Source.ScreenShare)?.trackSid ?? null;
}
