import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useToast } from '../ui/Toast';
import { type UpdateState, applyUpdate, usePwa } from './pwa';

/** Pages where a reload would interrupt someone in front of an audience. */
const LIVE = /^\/(present|presenter|prompter|join)(\/|$)/;

/** Offers a reload once a new version of Lectern is ready, but not while presenting. */
export function UpdateToast() {
  const { update } = usePwa();
  const toast = useToast();
  const live = LIVE.test(useLocation().pathname);
  const shown = useRef<{ state: UpdateState; id: number } | null>(null);

  useEffect(() => {
    if (update === 'none' || live || shown.current?.state === update) return;
    if (shown.current) toast.dismiss(shown.current.id);
    const id = toast.show(update === 'ready' ? 'A new version of Lectern is ready.' : 'Lectern was updated in another tab.', {
      duration: Infinity,
      action: { label: 'Reload', run: applyUpdate },
    });
    shown.current = { state: update, id };
  }, [update, live, toast]);

  return null;
}
