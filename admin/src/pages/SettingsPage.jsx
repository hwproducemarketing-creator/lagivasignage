import { useEffect, useState } from 'react';
import { api } from '../api';
import { useToast } from '../context/ToastContext';

export default function SettingsPage() {
  const { push } = useToast();
  const [businessName, setBusinessName] = useState('H&W Produce');
  const [imageDuration, setImageDuration] = useState(10);
  const [defaultMediaId, setDefaultMediaId] = useState('');
  const [media, setMedia] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [username, setUsername] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [settings, mediaData, scheduleData] = await Promise.all([
        api.settings(),
        api.media(),
        api.schedules(),
      ]);
      setBusinessName(settings.settings.businessName);
      setImageDuration(settings.settings.imageDurationSeconds);
      setDefaultMediaId(settings.settings.defaultMediaId || '');
      setUsername(settings.admin?.username || '');
      setMedia(mediaData.media);
      setSchedules(scheduleData.schedules);
    } catch (err) {
      push(err.message, 'error');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.updateSettings({
        businessName,
        imageDurationSeconds: imageDuration,
        defaultMediaId: defaultMediaId || undefined,
        currentPassword: currentPassword || undefined,
        newPassword: newPassword || undefined,
      });
      push('Settings saved');
      setCurrentPassword('');
      setNewPassword('');
      await load();
    } catch (err) {
      push(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function removeSchedule(id) {
    try {
      await api.deleteSchedule(id);
      push('Schedule removed');
      await load();
    } catch (err) {
      push(err.message, 'error');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold text-hw-dark">Settings</h2>
        <p className="text-sm text-hw-muted">Business defaults and admin account</p>
      </div>

      <form className="card max-w-xl space-y-4" onSubmit={save}>
        <div>
          <label className="label">Business name</label>
          <input
            className="input"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Server URL (for Fire TV / web player)</label>
          <input
            className="input bg-gray-50"
            value={
              typeof window !== 'undefined' && !window.location.origin.includes('5173')
                ? window.location.origin
                : 'http://YOUR_LAN_IP:4000 or https://lagivasignage-production.up.railway.app'
            }
            readOnly
          />
          <p className="mt-1 text-xs text-hw-muted">
            Web player (Vega OS / browser):{' '}
            <a
              className="text-hw-dark underline"
              href={
                typeof window !== 'undefined' && !window.location.origin.includes('5173')
                  ? `${window.location.origin}/player`
                  : 'https://lagivasignage-production.up.railway.app/player'
              }
              target="_blank"
              rel="noreferrer"
            >
              {typeof window !== 'undefined' && !window.location.origin.includes('5173')
                ? `${window.location.origin}/player`
                : 'https://lagivasignage-production.up.railway.app/player'}
            </a>
          </p>
        </div>
        <div>
          <label className="label">Default media (fallback when schedule ends)</label>
          <select
            className="input"
            value={defaultMediaId}
            onChange={(e) => setDefaultMediaId(e.target.value)}
          >
            <option value="">— None —</option>
            {media.map((m) => (
              <option key={m.id} value={m.id}>
                {m.originalName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Display default / image duration (seconds)</label>
          <input
            type="number"
            min={1}
            className="input"
            value={imageDuration}
            onChange={(e) => setImageDuration(Number(e.target.value))}
          />
        </div>

        <hr className="border-gray-100" />

        <div>
          <label className="label">Admin username</label>
          <input className="input bg-gray-50" value={username} readOnly />
        </div>
        <div>
          <label className="label">Current password (to change)</label>
          <input
            type="password"
            className="input"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        <div>
          <label className="label">New password</label>
          <input
            type="password"
            className="input"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
          />
        </div>

        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save settings'}
        </button>
      </form>

      <section className="card">
        <h3 className="mb-3 font-display text-lg font-semibold text-hw-dark">Active schedules</h3>
        {schedules.length === 0 ? (
          <p className="text-sm text-hw-muted">No schedules. Create one from Content.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {schedules.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <div>
                  <div className="font-medium">{s.originalName}</div>
                  <div className="text-hw-muted">
                    {new Date(s.startAt).toLocaleString()} → {new Date(s.endAt).toLocaleString()}
                    {!s.active ? ' (inactive)' : ''}
                  </div>
                </div>
                <button type="button" className="btn-danger text-xs" onClick={() => removeSchedule(s.id)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
