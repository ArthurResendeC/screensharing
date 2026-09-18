// Opus defaults are tuned for speech: mono, ~32 kbps, DTX on. That is the right
// trade for a talking head and the wrong one for a game or a music player, so the
// profile is a sharer choice and every knob below follows from it.
export const AUDIO_PROFILES = ['voice', 'music'] as const;
export type AudioProfile = (typeof AUDIO_PROFILES)[number];

type OpusProfile = {
  stereo: boolean;
  maxAverageBitrate: number;
  dtx: boolean;
  contentHint: 'speech' | 'music';
};

export const AUDIO_PROFILE_SETTINGS: Record<AudioProfile, OpusProfile> = {
  voice: {
    stereo: false,
    maxAverageBitrate: 40_000,
    dtx: true,
    contentHint: 'speech',
  },
  music: {
    stereo: true,
    maxAverageBitrate: 192_000,
    dtx: false,
    contentHint: 'music',
  },
};

// Mirrors setVideoDegradation: the transport layer reads the active choice from
// here so Peers never has to reach into client state.
export let AUDIO_PROFILE: AudioProfile = 'music';
export function setAudioProfile(value: AudioProfile) {
  AUDIO_PROFILE = value;
}

// False whenever the sharer has no audio source, or muted the one they have. The
// encoding is deactivated instead of the track being removed so switching sources
// mid-share never renegotiates.
export let AUDIO_SENDING = true;
export function setAudioSending(value: boolean) {
  AUDIO_SENDING = value;
}

function mergeFmtp(params: string, overrides: Record<string, string>): string {
  const pending = new Map(Object.entries(overrides));
  const merged = params
    .split(';')
    .filter(Boolean)
    .map(entry => {
      const key = entry.split('=')[0];
      if (!pending.has(key)) return entry;
      const value = pending.get(key)!;
      pending.delete(key);
      return `${key}=${value}`;
    });
  for (const [key, value] of pending) merged.push(`${key}=${value}`);
  return merged.join(';');
}

// Rewrites the Opus fmtp lines of every audio section. Chrome's encoder only sends
// stereo above the speech bitrate when the answer it receives asks for it, so this
// runs on the local offer (sprop-stereo, what we send) and on the remote answer
// (stereo/maxaveragebitrate, what the peer accepts). Applying it twice is a no-op.
export function tuneOpus(sdp: string, profile: AudioProfile): string {
  const settings = AUDIO_PROFILE_SETTINGS[profile];
  const overrides = {
    stereo: settings.stereo ? '1' : '0',
    'sprop-stereo': settings.stereo ? '1' : '0',
    maxaveragebitrate: String(settings.maxAverageBitrate),
    usedtx: settings.dtx ? '1' : '0',
    useinbandfec: '1',
  };
  const eol = sdp.includes('\r\n') ? '\r\n' : '\n';
  return sdp
    .split(/(?=^m=)/m)
    .map(section => {
      if (!section.startsWith('m=audio')) return section;
      const lines = section.split(/\r?\n/);
      const opus = new Set<string>();
      const described = new Set<string>();
      for (const line of lines) {
        const rtpmap = line.match(/^a=rtpmap:(\d+) opus\//i);
        if (rtpmap) opus.add(rtpmap[1]);
        const fmtp = line.match(/^a=fmtp:(\d+) /);
        if (fmtp) described.add(fmtp[1]);
      }
      if (!opus.size) return section;
      const tuned: string[] = [];
      for (const line of lines) {
        const fmtp = line.match(/^a=fmtp:(\d+) (.*)$/);
        if (fmtp && opus.has(fmtp[1])) {
          tuned.push(`a=fmtp:${fmtp[1]} ${mergeFmtp(fmtp[2], overrides)}`);
          continue;
        }
        tuned.push(line);
        // A codec with no fmtp line yet still needs one to carry the profile.
        const rtpmap = line.match(/^a=rtpmap:(\d+) opus\//i);
        if (rtpmap && !described.has(rtpmap[1]))
          tuned.push(`a=fmtp:${rtpmap[1]} ${mergeFmtp('', overrides)}`);
      }
      return tuned.join(eol);
    })
    .join('');
}
