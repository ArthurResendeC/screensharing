import { test, expect } from 'bun:test';
import { configureRtc } from '../src/lib/webrtc/rtcConfiguration';
import { tuneVideoBitrate } from '../src/lib/webrtc/sdp';

const sdp = [
  'v=0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  'm=video 9 UDP/TLS/RTP/SAVPF 96 97',
  'a=fmtp:96 level-asymmetry-allowed=1',
  'a=fmtp:97 apt=96',
  '',
].join('\r\n');

test('pins the video bitrate window without touching audio or duplicating params', () => {
  configureRtc({
    maxVideoBitrate: 15_000_000,
    minVideoBitrate: 2_500_000,
    startVideoBitrate: 8_000_000,
    turn: null,
  });
  const tuned = tuneVideoBitrate(tuneVideoBitrate(sdp));
  expect(tuned).toContain('a=fmtp:111 minptime=10;useinbandfec=1\r\n');
  expect(tuned).toContain(
    'a=fmtp:97 apt=96;x-google-min-bitrate=2500;x-google-start-bitrate=8000;x-google-max-bitrate=15000',
  );
  expect(tuned).toContain(
    'a=fmtp:96 level-asymmetry-allowed=1;x-google-min-bitrate=2500;x-google-start-bitrate=8000;x-google-max-bitrate=15000',
  );
  expect(tuned.match(/x-google-start-bitrate/g)).toHaveLength(2);
});

test('is a no-op when no bitrate hints are configured', () => {
  configureRtc({
    maxVideoBitrate: 0,
    minVideoBitrate: 0,
    startVideoBitrate: 0,
    turn: null,
  });
  expect(tuneVideoBitrate(sdp)).toBe(sdp);
  configureRtc({
    maxVideoBitrate: 15_000_000,
    minVideoBitrate: 2_500_000,
    startVideoBitrate: 8_000_000,
    turn: null,
  });
});
