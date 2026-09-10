export const VIDEO_CODEC_PREFERENCES = ['auto', 'vp8', 'vp9', 'h264', 'av1'] as const;

export type VideoCodecPreference = (typeof VIDEO_CODEC_PREFERENCES)[number];

const MIME_TYPES: Record<Exclude<VideoCodecPreference, 'auto'>, string> = {
  vp8: 'video/vp8',
  vp9: 'video/vp9',
  h264: 'video/h264',
  av1: 'video/av1',
};

function getVideoCodecCapabilities(): RTCRtpCodec[] {
  if (typeof RTCRtpSender === 'undefined') return [];
  return RTCRtpSender.getCapabilities?.('video')?.codecs ?? [];
}

export function isVideoCodecSupported(preference: VideoCodecPreference, codecs = getVideoCodecCapabilities()): boolean {
  if (preference === 'auto') return true;
  const mimeType = MIME_TYPES[preference];
  return codecs.some(codec => codec.mimeType.toLowerCase() === mimeType);
}

export function normalizeVideoCodecPreference(preference: VideoCodecPreference): VideoCodecPreference {
  return isVideoCodecSupported(preference) ? preference : 'auto';
}

export function preferVideoCodec(
  codecs: readonly RTCRtpCodec[],
  preference: Exclude<VideoCodecPreference, 'auto'>,
): RTCRtpCodec[] {
  const mimeType = MIME_TYPES[preference];
  const preferred: RTCRtpCodec[] = [];
  const fallback: RTCRtpCodec[] = [];
  for (const codec of codecs) {
    (codec.mimeType.toLowerCase() === mimeType ? preferred : fallback).push(codec);
  }
  return [...preferred, ...fallback];
}

export function setVideoCodecPreference(transceiver: RTCRtpTransceiver, preference: VideoCodecPreference): boolean {
  if (preference === 'auto' || typeof transceiver.setCodecPreferences !== 'function') return true;
  const codecs = getVideoCodecCapabilities();
  if (!isVideoCodecSupported(preference, codecs)) return false;
  try {
    transceiver.setCodecPreferences(preferVideoCodec(codecs, preference));
    return true;
  } catch {
    return false;
  }
}
