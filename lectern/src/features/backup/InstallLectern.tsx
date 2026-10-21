import { AppWindow, CircleCheck, MonitorDown } from 'lucide-react';
import { useState } from 'react';
import { type InstallWay, promptInstall } from '../../app/pwa';
import { useToast } from '../../ui/Toast';

const SAFER = 'Installing keeps your data safer: browsers don’t clear an installed app’s storage to make space.';
const SAFARI_SAFER = 'Installing keeps your data safer: an installed app’s data isn’t cleared after weeks away.';

/** The steps for browsers without an install dialog. */
function steps(way: InstallWay) {
  if (way === 'dock') return <>In Safari, choose <strong>Share → Add to Dock</strong>.</>;
  if (way === 'home-screen') return <>Tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.</>;
  return <>In the browser menu, choose <strong>Install</strong> or <strong>Add to Home screen</strong>.</>;
}

/** "Install Lectern" with the browser's own dialog where there is one, and short steps where there isn't. */
export function InstallLectern({ way, onInstalled }: { way: InstallWay; onInstalled(): void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (way === 'none') return null;

  if (way === 'installed') {
    return (
      <div className="backup-install">
        <p className="backup-persist"><CircleCheck size={16} aria-hidden /><span>Installed as an app, the safest place for your data.</span></p>
      </div>
    );
  }

  const install = async () => {
    setBusy(true);
    const outcome = await promptInstall();
    setBusy(false);
    if (outcome === 'accepted') {
      toast.show('Lectern is installed. Open it from your apps; it has the same decks.', { duration: 6000 });
      onInstalled();
    }
  };

  const safari = way === 'dock' || way === 'home-screen';
  return (
    <div className="backup-install">
      <div className="backup-install-head">
        <h4><AppWindow size={16} aria-hidden /> Install Lectern</h4>
        {way === 'prompt' && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={install} disabled={busy}><MonitorDown size={15} /> Install</button>
        )}
      </div>
      <p>{way !== 'prompt' && <>{steps(way)} </>}{safari ? SAFARI_SAFER : SAFER}</p>
      {safari && (
        <p className="faint">The app keeps its own copy of your data, separate from this browser’s. Download a backup here first, then restore it in the app.</p>
      )}
    </div>
  );
}
