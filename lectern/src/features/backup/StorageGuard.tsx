import { useEffect } from 'react';
import { onStorageFull, reportStorageError } from '../../data/storage';
import { useToast } from '../../ui/Toast';
import { downloadBackup } from './actions';

let warned = false;

/** Shows one warning per visit when a save fails because this browser's storage is full. */
export function StorageGuard() {
  const toast = useToast();

  useEffect(() => onStorageFull(() => {
    if (warned) return;
    warned = true;
    toast.show('Couldn’t save. This browser’s storage for Lectern is full. Download a backup, then delete recordings or decks you no longer need.', {
      tone: 'error',
      duration: 30_000,
      action: {
        label: 'Download a backup',
        run: () => {
          downloadBackup(false).catch((e: Error) => toast.show(`The backup couldn’t be made. ${e.message}`, { tone: 'error', duration: 8000 }));
        },
      },
    });
  }), [toast]);

  // Saves that fail without anyone catching them still count.
  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => reportStorageError(e.reason);
    window.addEventListener('unhandledrejection', onRejection);
    return () => window.removeEventListener('unhandledrejection', onRejection);
  }, []);

  return null;
}
