import { test, expect } from 'bun:test';
import { tuneOpus } from '../src/lib/webrtc/audio';

const sdp = [
  'v=0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 63',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  'a=rtpmap:63 red/48000/2',
  'a=fmtp:63 111/111',
  'm=video 9 UDP/TLS/RTP/SAVPF 96',
  'a=rtpmap:96 VP8/90000',
  'a=fmtp:96 x-google-max-bitrate=15000',
  '',
].join('\r\n');

test('asks for stereo at the music bitrate without touching other codecs', () => {
  const tuned = tuneOpus(sdp, 'music');
  expect(tuned).toContain(
    'a=fmtp:111 minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;maxaveragebitrate=192000;usedtx=0\r\n',
  );
  expect(tuned).toContain('a=fmtp:63 111/111\r\n');
  expect(tuned).toContain('a=fmtp:96 x-google-max-bitrate=15000');
});

test('keeps voice mono with DTX on', () => {
  const tuned = tuneOpus(sdp, 'voice');
  expect(tuned).toContain('stereo=0;sprop-stereo=0;maxaveragebitrate=40000');
  expect(tuned).toContain('usedtx=1');
});

test('is idempotent and never duplicates a parameter', () => {
  const once = tuneOpus(sdp, 'music');
  expect(tuneOpus(once, 'music')).toBe(once);
  expect(once.match(/maxaveragebitrate/g)).toHaveLength(1);
});

test('switching profiles rewrites in place instead of appending', () => {
  const tuned = tuneOpus(tuneOpus(sdp, 'music'), 'voice');
  expect(tuned.match(/stereo=/g)).toHaveLength(2);
  expect(tuned).toContain('stereo=0;sprop-stereo=0;maxaveragebitrate=40000');
});

test('adds an fmtp line to an opus codec that has none', () => {
  const bare = [
    'm=audio 9 UDP/TLS/RTP/SAVPF 111',
    'a=rtpmap:111 opus/48000/2',
    '',
  ].join('\r\n');
  expect(tuneOpus(bare, 'music')).toContain(
    'a=rtpmap:111 opus/48000/2\r\na=fmtp:111 stereo=1;sprop-stereo=1;maxaveragebitrate=192000;usedtx=0;useinbandfec=1',
  );
});

test('leaves an sdp with no audio section alone', () => {
  const videoOnly = 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n';
  expect(tuneOpus(videoOnly, 'music')).toBe(videoOnly);
});
