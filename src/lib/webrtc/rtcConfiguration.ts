// STUN público somente para desenvolvimento. Toda configuração ICE fica aqui.
export const rtcConfiguration: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};
export let MAX_VIDEO_BITRATE: number | undefined = 15_000_000;

export type PublicRtcConfiguration = {
  maxVideoBitrate?: number;
  turn?: RTCIceServer | null;
};

export function configureRtc(config: PublicRtcConfiguration) {
  const bitrate = Number(config.maxVideoBitrate);
  MAX_VIDEO_BITRATE = Number.isFinite(bitrate) && bitrate > 0 ? bitrate : undefined;
  rtcConfiguration.iceServers = [{ urls: 'stun:stun.l.google.com:19302' }, ...(config.turn?.urls ? [config.turn] : [])];
}
