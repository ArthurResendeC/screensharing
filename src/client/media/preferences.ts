import { ALIAS_MAX_LENGTH } from '../../lib/signaling/messages';
import {
  normalizeVideoCodecPreference,
  type VideoCodecPreference,
  VIDEO_CODEC_PREFERENCES,
} from '../../lib/webrtc/codecs';
import type { VideoDegradation } from '../../lib/webrtc/rtcConfiguration';
import type { CaptureQuality } from './types';

// Preferências de sessão guardadas no navegador. Compartilhadas pelos dois provedores
// de mídia para que a semântica de persistência seja idêntica em qualquer transporte.
const ALIAS_STORAGE_KEY = 'screen-share:alias';
const DEGRADATION_STORAGE_KEY = 'screen-share:degradation';
const CAPTURE_STORAGE_KEY = 'screen-share:capture';
const CODEC_STORAGE_KEY = 'screen-share:codec';

const DEGRADATION_CHOICES = ['framerate', 'balanced', 'resolution'] as const;
const CAPTURE_CHOICES = ['fluid', 'balanced', 'sharp'] as const;

export const CAPTURE_PRESETS: Record<CaptureQuality, MediaTrackConstraints> = {
  fluid: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } },
  balanced: { width: { ideal: 2560 }, height: { ideal: 1440 }, frameRate: { ideal: 30 } },
  sharp: { width: { ideal: 2560 }, height: { ideal: 1440 }, frameRate: { ideal: 60 } },
};

function storedChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key) as T;
    return allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function storedAlias() {
  try {
    return (localStorage.getItem(ALIAS_STORAGE_KEY) ?? '').trim().slice(0, ALIAS_MAX_LENGTH);
  } catch {
    return '';
  }
}

export function persistAlias(alias: string) {
  try {
    localStorage.setItem(ALIAS_STORAGE_KEY, alias);
  } catch {
    // The name still applies to the current tab.
  }
}

export function storedDegradation(): VideoDegradation {
  return storedChoice(DEGRADATION_STORAGE_KEY, DEGRADATION_CHOICES, 'framerate');
}

export function persistDegradation(value: VideoDegradation) {
  try {
    localStorage.setItem(DEGRADATION_STORAGE_KEY, value);
  } catch {
    // Preference remains valid for this tab.
  }
}

export function storedCaptureQuality(): CaptureQuality {
  return storedChoice(CAPTURE_STORAGE_KEY, CAPTURE_CHOICES, 'fluid');
}

export function persistCaptureQuality(value: CaptureQuality) {
  try {
    localStorage.setItem(CAPTURE_STORAGE_KEY, value);
  } catch {
    // Preference remains valid for this tab.
  }
}

export function storedCodecPreference(): VideoCodecPreference {
  return normalizeVideoCodecPreference(storedChoice(CODEC_STORAGE_KEY, VIDEO_CODEC_PREFERENCES, 'auto'));
}

export function persistCodecPreference(value: VideoCodecPreference) {
  try {
    localStorage.setItem(CODEC_STORAGE_KEY, value);
  } catch {
    // Preference remains valid for this tab.
  }
}
