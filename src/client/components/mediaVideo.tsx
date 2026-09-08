import { useCallback, useEffect, useRef, useState } from 'react';
import { CloseIcon, FullscreenIcon, PipIcon, VolumeIcon, VolumeMutedIcon } from './icons';

type Props = { stream: MediaStream | null; label: string } & (
  | { local: true; onStopWatching?: never }
  | { local?: false; onStopWatching: () => void }
);

type PictureInPictureMediaSession = {
  setActionHandler(action: 'enterpictureinpicture', handler: (() => void) | null): void;
};

export function MediaVideo({ stream, local = false, label, onStopWatching }: Props) {
  const player = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [blocked, setBlocked] = useState(false);
  const [muted, setMuted] = useState(local);
  const [pipActive, setPipActive] = useState(false);
  const [fullscreenActive, setFullscreenActive] = useState(false);
  const [pipSupported, setPipSupported] = useState(false);
  const [fullscreenSupported, setFullscreenSupported] = useState(false);
  const [controlError, setControlError] = useState('');

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
    <div ref={player} className={`media-player${local ? ' is-local' : ''}`} hidden={!stream}>
      <video ref={video} autoPlay playsInline muted={muted} aria-label={label} />
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
