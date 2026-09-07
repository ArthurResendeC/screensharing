// STUN público somente para desenvolvimento. Toda configuração ICE fica aqui.
export const rtcConfiguration: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    ...(process.env.NEXT_PUBLIC_TURN_URL ? [{
      urls: process.env.NEXT_PUBLIC_TURN_URL,
      username: process.env.NEXT_PUBLIC_TURN_USERNAME,
      credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
    }] : []),
  ],
};
const configuredBitrate = Number(process.env.NEXT_PUBLIC_MAX_VIDEO_BITRATE ?? 15_000_000);
export const MAX_VIDEO_BITRATE = Number.isFinite(configuredBitrate) && configuredBitrate > 0 ? configuredBitrate : undefined;
