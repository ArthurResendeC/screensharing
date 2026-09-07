import { MAX_VIDEO_BITRATE, MIN_VIDEO_BITRATE, START_VIDEO_BITRATE } from './rtcConfiguration';

const kbps = (bps: number) => Math.max(1, Math.round(bps / 1000));

// Pin the encoder's bitrate window so it does not crawl up from Chrome's ~300 kbps
// default estimate every time the shared content starts moving again. Chrome/Edge
// read x-google-*-bitrate from the video fmtp lines; other browsers ignore them.
export function tuneVideoBitrate(sdp: string): string {
  const extras: string[] = [];
  if (MIN_VIDEO_BITRATE) extras.push(`x-google-min-bitrate=${kbps(MIN_VIDEO_BITRATE)}`);
  if (START_VIDEO_BITRATE) extras.push(`x-google-start-bitrate=${kbps(START_VIDEO_BITRATE)}`);
  if (MAX_VIDEO_BITRATE) extras.push(`x-google-max-bitrate=${kbps(MAX_VIDEO_BITRATE)}`);
  if (!extras.length) return sdp;
  const suffix = extras.join(';');
  const eol = sdp.includes('\r\n') ? '\r\n' : '\n';
  return sdp
    .split(/(?=^m=)/m)
    .map(section => {
      if (!section.startsWith('m=video')) return section;
      return section
        .split(/\r?\n/)
        .map(line => {
          const match = line.match(/^a=fmtp:(\d+) (.+)$/);
          if (!match || match[2].includes('x-google-max-bitrate')) return line;
          return `a=fmtp:${match[1]} ${match[2]};${suffix}`;
        })
        .join(eol);
    })
    .join('');
}
