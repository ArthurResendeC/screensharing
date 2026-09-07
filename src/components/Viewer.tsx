'use client';
import { useEffect, useRef, useState } from 'react';
export function Viewer({ stream, local = false }: { stream: MediaStream | null; local?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let active = true;
    video.srcObject = stream;
    if (stream) void video.play().then(() => { if (active) setBlocked(false); }, () => { if (active) setBlocked(true); });
    return () => { active = false; video.pause(); video.srcObject = null; };
  }, [stream]);
  return <div>
    <video ref={ref} autoPlay playsInline muted={local} controls={!local} aria-label={local ? 'Preview local' : 'Transmissão selecionada'} />
    {stream && blocked && <button onClick={() => { void ref.current?.play().then(() => setBlocked(false)).catch(() => setBlocked(true)); }}>Reproduzir vídeo e áudio</button>}
    {!stream && <p>Selecione uma transmissão disponível para assistir.</p>}
  </div>;
}
