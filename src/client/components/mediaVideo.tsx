import { useEffect, useRef, useState } from 'react';

type Props = { stream: MediaStream | null; local?: boolean; label: string };

export function MediaVideo({ stream, local = false, label }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [blocked, setBlocked] = useState(false);

  const play = async () => {
    try {
      await video.current?.play();
      setBlocked(false);
    } catch {
      if (stream) setBlocked(true);
    }
  };

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.pause();
    element.srcObject = stream;
    setBlocked(false);
    if (stream) void play();
    return () => {
      element.pause();
      element.srcObject = null;
    };
  }, [stream]);

  return (
    <>
      <video ref={video} autoPlay playsInline muted={local} controls={!local} aria-label={label} hidden={!stream} />
      {blocked && (
        <button type="button" className="btn btn-outline" onClick={() => void play()}>
          {local ? 'Reproduzir preview' : 'Reproduzir vídeo e áudio'}
        </button>
      )}
    </>
  );
}
