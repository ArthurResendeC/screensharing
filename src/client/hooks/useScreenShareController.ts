import { useEffect, useState, useSyncExternalStore } from 'react';
import { ScreenShareController } from '../screenShare';
import { applyTheme } from '../theme';

export function useScreenShareController(roomId: string, credential: string, password: string) {
  const [controller] = useState(() => new ScreenShareController(roomId, credential, password));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);

  useEffect(() => {
    controller.start();
    const dispose = () => controller.dispose();
    window.addEventListener('pagehide', dispose, { once: true });
    return () => {
      window.removeEventListener('pagehide', dispose);
      controller.dispose();
    };
  }, [controller]);

  useEffect(() => applyTheme(state.theme), [state.theme]);
  return { controller, state };
}
