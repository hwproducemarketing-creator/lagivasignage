import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatDateTime, formatRelative, mediaUrl } from '../api';
import { useToast } from '../context/ToastContext';

export default function DashboardPage() {
  const { push } = useToast();
  const [data, setData] = useState(null);

  async function load() {
    try {
      const status = await api.status();
      setData(status);
    } catch (err) {
      push(err.message, 'error');
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, []);

  if (!data) {
    return <div className="text-hw-muted">Loading dashboard…</div>;
  }

  const { screens, content, current, devices, activity } = data;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold text-hw-dark">Dashboard</h2>
        <p className="text-sm text-hw-muted">Overview of screens and published signage</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total Screens" value={screens.total} />
        <Stat label="Online" value={screens.online} accent="text-hw-fresh" />
        <Stat label="Offline" value={screens.offline} accent="text-red-600" />
        <Stat label="Total Media" value={content.totalMedia} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card">
          <h3 className="mb-3 font-display text-lg font-semibold text-hw-dark">Current Signage</h3>
          {current?.url ? (
            <div>
              {current.type === 'video' ? (
                <video
                  src={mediaUrl(current.url)}
                  className="mb-3 max-h-72 w-full rounded-lg bg-black object-contain"
                  controls
                />
              ) : (
                <img
                  src={mediaUrl(current.url)}
                  alt="Current signage"
                  className="mb-3 max-h-72 w-full rounded-lg bg-black object-contain"
                />
              )}
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-hw-muted">Version</dt>
                  <dd className="font-semibold">{current.version}</dd>
                </div>
                <div>
                  <dt className="text-hw-muted">Published</dt>
                  <dd className="font-semibold">{formatDateTime(current.updatedAt)}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-hw-muted">File</dt>
                  <dd className="font-semibold">{current.filename || '—'}</dd>
                </div>
              </dl>
            </div>
          ) : (
            <p className="text-sm text-hw-muted">
              No content published yet.{' '}
              <Link className="text-hw-dark underline" to="/content">
                Upload content
              </Link>
            </p>
          )}
        </section>

        <section className="card">
          <h3 className="mb-3 font-display text-lg font-semibold text-hw-dark">Device Status</h3>
          {devices.length === 0 ? (
            <p className="text-sm text-hw-muted">
              No screens registered.{' '}
              <Link className="text-hw-dark underline" to="/screens">
                Add a screen
              </Link>
            </p>
          ) : (
            <ul className="space-y-3">
              {devices.map((d) => (
                <li key={d.id} className="rounded-lg border border-gray-100 bg-hw-gray/50 p-3">
                  <div className="flex items-center gap-2 font-semibold">
                    <span>{d.status === 'online' ? '🟢' : '🔴'}</span>
                    <span>{d.name}</span>
                    <span className="text-sm font-medium capitalize text-hw-muted">{d.status}</span>
                  </div>
                  <p className="mt-1 text-sm text-hw-muted">
                    Last seen {formatRelative(d.lastSeen)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card">
        <h3 className="mb-3 font-display text-lg font-semibold text-hw-dark">Recent Activity</h3>
        {activity?.length ? (
          <ul className="divide-y divide-gray-100">
            {activity.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-4 py-2.5 text-sm">
                <span>{a.message}</span>
                <span className="shrink-0 text-hw-muted">{formatRelative(a.created_at)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-hw-muted">No activity yet.</p>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div className="card">
      <div className="text-sm text-hw-muted">{label}</div>
      <div className={`mt-1 font-display text-3xl font-bold ${accent || 'text-hw-dark'}`}>
        {value}
      </div>
    </div>
  );
}
