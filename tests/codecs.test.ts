import { expect, test } from 'bun:test';
import {
  isVideoCodecSupported,
  preferVideoCodec,
  setVideoCodecPreference,
} from '../src/lib/webrtc/codecs';

const codec = (mimeType: string, sdpFmtpLine?: string): RTCRtpCodec => ({
  mimeType,
  clockRate: 90_000,
  sdpFmtpLine,
});

const capabilities = [
  codec('video/VP8'),
  codec('video/rtx', 'apt=96'),
  codec('video/H264', 'profile-level-id=42001f'),
  codec('video/H264', 'profile-level-id=42e01f'),
  codec('video/VP9', 'profile-id=0'),
  codec('video/red'),
  codec('video/ulpfec'),
];

test('promotes every profile of the selected codec and preserves fallbacks and recovery codecs', () => {
  const preferred = preferVideoCodec(capabilities, 'h264');

  expect(preferred.map(entry => entry.mimeType)).toEqual([
    'video/H264',
    'video/H264',
    'video/VP8',
    'video/rtx',
    'video/VP9',
    'video/red',
    'video/ulpfec',
  ]);
  expect(preferred).toHaveLength(capabilities.length);
  expect(preferred[0]).toBe(capabilities[2]);
  expect(preferred[1]).toBe(capabilities[3]);
});

test('detects codec families case-insensitively', () => {
  expect(isVideoCodecSupported('auto', [])).toBeTrue();
  expect(isVideoCodecSupported('vp9', capabilities)).toBeTrue();
  expect(isVideoCodecSupported('av1', capabilities)).toBeFalse();
});

test('applies a preference when supported and safely keeps automatic negotiation otherwise', () => {
  const original = globalThis.RTCRtpSender;
  const applied: RTCRtpCodec[][] = [];
  globalThis.RTCRtpSender = {
    getCapabilities: () => ({ codecs: capabilities, headerExtensions: [] }),
  } as unknown as typeof RTCRtpSender;
  const transceiver = {
    setCodecPreferences: (codecs: RTCRtpCodec[]) => applied.push(codecs),
  } as unknown as RTCRtpTransceiver;

  try {
    expect(setVideoCodecPreference(transceiver, 'vp9')).toBeTrue();
    expect(applied[0]![0]!.mimeType).toBe('video/VP9');
    expect(setVideoCodecPreference(transceiver, 'av1')).toBeFalse();
    expect(setVideoCodecPreference(transceiver, 'auto')).toBeTrue();
    expect(applied).toHaveLength(1);
  } finally {
    globalThis.RTCRtpSender = original;
  }
});
