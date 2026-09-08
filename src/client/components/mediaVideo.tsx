import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { CloseIcon, FullscreenIcon, PipIcon, VolumeIcon, VolumeMutedIcon, ZoomInIcon, ZoomOutIcon } from './icons';

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;

type Props = { stream: MediaStream | null; label: string } & (
  | { local: true; onStopWatching?: never }
  | { local?: false; onStopWatching: () => void }
);

type PictureInPictureMediaSession = {
  setActionHandler(action: 'enterpictureinpicture', handler: (() => void) | null): void;
};

export function MediaVideo({ stream, local = false, label, onStopWatching }: Props) {
  const player = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [muted, setMuted] = useState(local);
  const [pipActive, setPipActive] = useState(false);
  const [fullscreenActive, setFullscreenActive] = useState(false);
  const [pipSupported, setPipSupported] = useState(false);
  const [fullscreenSupported, setFullscreenSupported] = useState(false);
  const [controlError, setControlError] = useState('');
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  const play = useCallback(async () => {
    try {
      await video.current?.play();
      setBlocked(false);
    } catch {
      if (stream) setBlocked(true);
    }
  }, [stream]);

  const leavePresentationModes = useCallback(() => {
    const element = video.current;
    const container = player.current;
    if (element && document.pictureInPictureElement === element)
      void document.exitPictureInPicture().catch(() => undefined);
    if (container && document.fullscreenElement === container) void document.exitFullscreen().catch(() => undefined);
  }, []);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.pause();
    element.srcObject = stream;
    setBlocked(false);
    setControlError('');
    setZoom(MIN_ZOOM);
    setOffset({ x: 0, y: 0 });
    if (stream) void play();
    else leavePresentationModes();
    return () => {
      element.pause();
      element.srcObject = null;
    };
  }, [leavePresentationModes, play, stream]);

  useEffect(() => {
    const element = video.current;
    const container = player.current;
    if (!element || !container) return;

    const syncMuted = () => setMuted(element.muted);
    const enterPip = () => setPipActive(true);
    const leavePip = () => setPipActive(false);
    const syncFullscreen = () => setFullscreenActive(document.fullscreenElement === container);

    setPipSupported(!local && document.pictureInPictureEnabled && 'requestPictureInPicture' in element);
    setFullscreenSupported(!local && document.fullscreenEnabled && 'requestFullscreen' in container);
    element.addEventListener('volumechange', syncMuted);
    element.addEventListener('enterpictureinpicture', enterPip);
    element.addEventListener('leavepictureinpicture', leavePip);
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => {
      element.removeEventListener('volumechange', syncMuted);
      element.removeEventListener('enterpictureinpicture', enterPip);
      element.removeEventListener('leavepictureinpicture', leavePip);
      document.removeEventListener('fullscreenchange', syncFullscreen);
      leavePresentationModes();
    };
  }, [leavePresentationModes, local]);

  useEffect(() => {
    if (local || !stream || !pipSupported || !('mediaSession' in navigator)) return;
    const mediaSession = navigator.mediaSession as unknown as PictureInPictureMediaSession;
    try {
      mediaSession.setActionHandler('enterpictureinpicture', () => {
        const element = video.current;
        if (element && document.pictureInPictureElement !== element)
          void element.requestPictureInPicture().catch(() => undefined);
      });
    } catch {
      return;
    }
    return () => {
      try {
        mediaSession.setActionHandler('enterpictureinpicture', null);
      } catch {
        // The action is optional and may disappear when browser capabilities change.
      }
    };
  }, [local, pipSupported, stream]);

  const toggleMuted = () => {
    const element = video.current;
    if (!element) return;
    element.muted = !element.muted;
  };

  const constrainOffset = useCallback((x: number, y: number, scale: number) => {
    const element = viewport.current;
    if (!element || scale <= MIN_ZOOM) return { x: 0, y: 0 };
    const maxX = (element.clientWidth * (scale - 1)) / 2;
    const maxY = (element.clientHeight * (scale - 1)) / 2;
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    };
  }, []);

  const changeZoom = (change: number) => {
    setZoom(current => {
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, current + change));
      setOffset(currentOffset => constrainOffset(currentOffset.x, currentOffset.y, next));
      return next;
    });
  };

  const resetZoom = () => {
    setZoom(MIN_ZOOM);
    setOffset({ x: 0, y: 0 });
  };

  const startDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (zoom <= MIN_ZOOM || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      offsetX: offset.x,
      offsetY: offset.y,
    };
    setDragging(true);
  };

  const moveDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    setOffset(
      constrainOffset(current.offsetX + event.clientX - current.x, current.offsetY + event.clientY - current.y, zoom),
    );
  };

  const stopDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const togglePip = async () => {
    const element = video.current;
    if (!element) return;
    setControlError('');
    try {
      if (document.pictureInPictureElement === element) await document.exitPictureInPicture();
      else {
        if (document.fullscreenElement) await document.exitFullscreen();
        await element.requestPictureInPicture();
      }
    } catch {
      setControlError('Não foi possível alterar o modo picture-in-picture.');
    }
  };

  const toggleFullscreen = async () => {
    const element = video.current;
    const container = player.current;
    if (!element || !container) return;
    setControlError('');
    try {
      if (document.fullscreenElement === container) await document.exitFullscreen();
      else {
        if (document.pictureInPictureElement === element) await document.exitPictureInPicture();
        await container.requestFullscreen();
      }
    } catch {
      setControlError('Não foi possível alterar o modo de tela cheia.');
    }
  };

  const stopWatching = () => {
    leavePresentationModes();
    onStopWatching?.();
  };

  return (
    <div
      ref={player}
      className={`media-player${local ? ' is-local' : ''}${zoom > MIN_ZOOM ? ' is-zoomed' : ''}${dragging ? ' is-dragging' : ''}`}
      hidden={!stream}
    >
      <div
        ref={viewport}
        className="media-viewport"
        onPointerDown={startDragging}
        onPointerMove={moveDragging}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
        onDoubleClick={resetZoom}
      >
        <video
          ref={video}
          autoPlay
          playsInline
          muted={muted}
          aria-label={label}
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}
        />
      </div>
      {blocked && (
        <button type="button" className="btn btn-outline media-playback-unlock" onClick={() => void play()}>
          {local ? 'Reproduzir preview' : 'Reproduzir vídeo e áudio'}
        </button>
      )}
      {!local && stream && (
        <div className="media-controls">
          <button type="button" className="media-control media-control-leave" onClick={stopWatching}>
            <CloseIcon /> <span>Deixar de assistir</span>
          </button>
          <div className="media-control-group">
            <div className="media-zoom-controls" role="group" aria-label="Zoom do vídeo">
              <button
                type="button"
                className="media-control media-control-icon"
                title="Diminuir zoom"
                aria-label="Diminuir zoom"
                disabled={zoom <= MIN_ZOOM}
                onClick={() => changeZoom(-ZOOM_STEP)}
              >
                <ZoomOutIcon />
              </button>
              <button
                type="button"
                className="media-control media-zoom-value"
                title="Redefinir zoom"
                aria-label={`Redefinir zoom, atualmente ${Math.round(zoom * 100)}%`}
                disabled={zoom <= MIN_ZOOM}
                onClick={resetZoom}
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                className="media-control media-control-icon"
                title="Aumentar zoom"
                aria-label="Aumentar zoom"
                disabled={zoom >= MAX_ZOOM}
                onClick={() => changeZoom(ZOOM_STEP)}
              >
                <ZoomInIcon />
              </button>
            </div>
            <button
              type="button"
              className={`media-control media-control-icon${muted ? ' is-active' : ''}`}
              title={muted ? 'Ligar áudio' : 'Desligar áudio'}
              aria-label={muted ? 'Ligar áudio' : 'Desligar áudio'}
              aria-pressed={muted}
              onClick={toggleMuted}
            >
              {muted ? <VolumeMutedIcon /> : <VolumeIcon />}
            </button>
            {pipSupported && (
              <button
                type="button"
                className={`media-control media-control-icon${pipActive ? ' is-active' : ''}`}
                title={pipActive ? 'Sair do picture-in-picture' : 'Abrir picture-in-picture'}
                aria-label={pipActive ? 'Sair do picture-in-picture' : 'Abrir picture-in-picture'}
                aria-pressed={pipActive}
                onClick={() => void togglePip()}
              >
                <PipIcon />
              </button>
            )}
            {fullscreenSupported && (
              <button
                type="button"
                className={`media-control media-control-icon${fullscreenActive ? ' is-active' : ''}`}
                title={fullscreenActive ? 'Sair da tela cheia' : 'Abrir em tela cheia'}
                aria-label={fullscreenActive ? 'Sair da tela cheia' : 'Abrir em tela cheia'}
                aria-pressed={fullscreenActive}
                onClick={() => void toggleFullscreen()}
              >
                <FullscreenIcon active={fullscreenActive} />
              </button>
            )}
          </div>
        </div>
      )}
      {controlError && (
        <p className="media-control-error" role="status">
          {controlError}
        </p>
      )}
    </div>
  );
}
