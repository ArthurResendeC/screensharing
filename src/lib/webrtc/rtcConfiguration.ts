// STUN público somente para desenvolvimento. Toda configuração ICE fica aqui.
export const rtcConfiguration: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};
export let MAX_VIDEO_BITRATE: number | undefined = 15_000_000;
// Bitrate floor and initial estimate (bps) that keep the send bitrate steady instead
// of collapsing on a static screen and slowly ramping back up when content moves.
export let MIN_VIDEO_BITRATE: number | undefined = 2_500_000;
export let START_VIDEO_BITRATE: number | undefined = 8_000_000;

export type PublicRtcConfiguration = {
  maxVideoBitrate?: number;
  minVideoBitrate?: number;
  startVideoBitrate?: number;
  turn?: RTCIceServer | null;
};

const positiveOrUndefined = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

export function configureRtc(config: PublicRtcConfiguration) {
  MAX_VIDEO_BITRATE = positiveOrUndefined(config.maxVideoBitrate);
  MIN_VIDEO_BITRATE = positiveOrUndefined(config.minVideoBitrate);
  START_VIDEO_BITRATE = positiveOrUndefined(config.startVideoBitrate);
  rtcConfiguration.iceServers = [{ urls: 'stun:stun.l.google.com:19302' }, ...(config.turn?.urls ? [config.turn] : [])];
}
