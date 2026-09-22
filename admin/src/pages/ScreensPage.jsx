import { useEffect, useState } from 'react';
import { api, formatRelative } from '../api';
import { useToast } from '../context/ToastContext';
import Modal from '../components/Modal';

export default function ScreensPage() {
  const { push } = useToast();
  const [devices, setDevices] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [pairingCode, setPairingCode] = useState('');
  const [name, setName] = useState('Main Store TV');
  const [renameId, setRenameId] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  async function load() {
    try {
      const data = await api.devices();
      setDevices(data.devices);
    } catch (err) {
      push(err.message, 'error');
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, []);

  async function register() {
    try {
      await api.registerDevice(pairingCode, name);
      push('Device registered');
      setShowAdd(false);
      setPairingCode('');
      setName('Main Store TV');
      await load();
    } catch (err) {
      push(err.message, 'error');
    }
  }

  async function saveRename() {
    try {
      await api.renameDevice(renameId, renameValue);
      push('Screen renamed');
      setRenameId(null);
      await load();
    } catch (err) {
      push(err.message, 'error');
    }
  }

  async function remove(id) {
    if (!confirm('Remove this screen?')) return;
    try {
      await api.deleteDevice(id);
      push('Screen removed');
      await load();
    } catch (err) {
      push(err.message, 'error');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-semibold text-hw-dark">Screens</h2>
          <p className="text-sm text-hw-muted">Register and monitor Fire TV devices</p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setShowAdd(true)}>
          Add Screen
        </button>
      </div>

      {devices.length === 0 ? (
        <div className="card text-sm text-hw-muted">
          No screens yet. Open the Fire TV app to get a device code, then click Add Screen.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {devices.map((d) => (
            <article key={d.id} className="card">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="font-display text-xl font-semibold text-hw-dark">{d.name}</h3>
                <span className="text-sm font-semibold uppercase">
                  {d.status === 'online' ? '🟢 ONLINE' : '🔴 OFFLINE'}
                </span>
              </div>
              <dl className="space-y-1 text-sm">
                <Row label="Device ID" value={d.deviceId} />
                <Row label="Current version" value={d.currentVersion ?? 0} />
                <Row label="Last seen" value={formatRelative(d.lastSeen)} />
                <Row label="Current content" value={d.currentContent || '—'} />
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={() => {
                    setRenameId(d.id);
                    setRenameValue(d.name);
                  }}
                >
                  Rename
                </button>
                <button type="button" className="btn-danger text-xs" onClick={() => remove(d.id)}>
                  Remove
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <Modal open={showAdd} title="Register Device" onClose={() => setShowAdd(false)}>
        <label className="label">Device code</label>
        <input
          className="input mb-3 uppercase tracking-widest"
          placeholder="XXXX-XXXX"
          value={pairingCode}
          onChange={(e) => setPairingCode(e.target.value.toUpperCase())}
        />
        <label className="label">Screen name</label>
        <input
          className="input mb-4"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Main Store TV"
        />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => setShowAdd(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!pairingCode || !name.trim()}
            onClick={register}
          >
            Register Device
          </button>
        </div>
      </Modal>

      <Modal open={renameId != null} title="Rename screen" onClose={() => setRenameId(null)}>
        <input
          className="input mb-4"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => setRenameId(null)}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={saveRename}>
            Save
          </button>
        </div>
      </Modal>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-hw-muted">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
