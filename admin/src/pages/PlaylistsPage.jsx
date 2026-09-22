import { useCallback, useEffect, useState } from 'react';
import { api, mediaUrl } from '../api';
import { useToast } from '../context/ToastContext';
import Modal from '../components/Modal';

export default function PlaylistsPage() {
  const { push } = useToast();
  const [playlists, setPlaylists] = useState([]);
  const [media, setMedia] = useState([]);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState('');
  const [items, setItems] = useState([]);
  const [publishTarget, setPublishTarget] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, m] = await Promise.all([api.playlists(), api.media()]);
      setPlaylists(p.playlists);
      setMedia(m.media);
    } catch (err) {
      push(err.message, 'error');
    }
  }, [push]);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setEditing('new');
    setName('');
    setItems([]);
  }

  function openEdit(pl) {
    setEditing(pl.id);
    setName(pl.name);
    setItems(
      pl.items.map((it) => ({
        mediaId: it.mediaId,
        durationSec: it.durationSec,
        originalName: it.originalName,
        type: it.type,
        url: it.url,
      }))
    );
  }

  function addMedia(m) {
    if (items.some((it) => it.mediaId === m.id)) return;
    setItems((prev) => [
      ...prev,
      {
        mediaId: m.id,
        durationSec: m.type === 'video' ? 30 : 10,
        originalName: m.originalName,
        type: m.type,
        url: m.url,
      },
    ]);
  }

  function moveItem(index, dir) {
    setItems((prev) => {
      const next = [...prev];
      const j = index + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  }

  async function save() {
    if (!name.trim()) {
      push('Name is required', 'error');
      return;
    }
    if (!items.length) {
      push('Add at least one media item', 'error');
      return;
    }
    setBusy(true);
    try {
      const body = {
        name: name.trim(),
        items: items.map((it) => ({
          mediaId: it.mediaId,
          durationSec: Math.max(1, Number(it.durationSec) || 10),
        })),
      };
      if (editing === 'new') {
        await api.createPlaylist(body);
        push('Playlist created');
      } else {
        await api.updatePlaylist(editing, body);
        push('Playlist saved');
      }
      setEditing(null);
      await load();
    } catch (err) {
      push(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function confirmPublish() {
    if (!publishTarget) return;
    try {
      const res = await api.publishPlaylist(publishTarget.id);
      push(`✓ Published successfully — version ${res.version}`);
      setPublishTarget(null);
      await load();
    } catch (err) {
      push(err.message || 'Unable to publish. Please try again.', 'error');
    }
  }

  async function remove(pl) {
    if (!confirm(`Delete playlist “${pl.name}”?`)) return;
    try {
      await api.deletePlaylist(pl.id);
      push('Playlist deleted');
      await load();
    } catch (err) {
      push(err.message, 'error');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-semibold text-hw-dark">Playlists</h2>
          <p className="text-sm text-hw-muted">Rotate multiple signs on the TV automatically</p>
        </div>
        <button type="button" className="btn-primary" onClick={openCreate}>
          Create playlist
        </button>
      </div>

      {playlists.length === 0 ? (
        <div className="card text-sm text-hw-muted">
          No playlists yet. Create one, add media from your library, set durations, then Publish.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {playlists.map((pl) => (
            <article key={pl.id} className="card">
              <div className="mb-2 flex items-start justify-between gap-2">
                <h3 className="font-display text-lg font-semibold text-hw-dark">{pl.name}</h3>
                {pl.isPublished && (
                  <span className="rounded bg-hw-light px-2 py-0.5 text-xs font-semibold text-hw-dark">
                    Published
                  </span>
                )}
              </div>
              <p className="mb-3 text-sm text-hw-muted">{pl.items.length} item(s)</p>
              <ul className="mb-4 space-y-1 text-sm">
                {pl.items.slice(0, 5).map((it) => (
                  <li key={it.id} className="flex justify-between gap-2">
                    <span className="truncate">{it.originalName}</span>
                    <span className="shrink-0 text-hw-muted">{it.durationSec}s</span>
                  </li>
                ))}
                {pl.items.length > 5 && (
                  <li className="text-hw-muted">+{pl.items.length - 5} more</li>
                )}
              </ul>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-secondary text-xs" onClick={() => setPreview(pl)}>
                  Preview
                </button>
                <button type="button" className="btn-secondary text-xs" onClick={() => openEdit(pl)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="btn-primary text-xs"
                  onClick={() => setPublishTarget(pl)}
                  disabled={!pl.items.length}
                >
                  Publish
                </button>
                <button type="button" className="btn-danger text-xs" onClick={() => remove(pl)}>
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <Modal
        open={editing != null}
        title={editing === 'new' ? 'Create playlist' : 'Edit playlist'}
        wide
        onClose={() => !busy && setEditing(null)}
      >
        <div className="max-h-[75vh] space-y-4 overflow-y-auto pr-1">
          <div>
            <label className="label">Name</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Weekly specials rotation"
            />
          </div>

          <div>
            <p className="label">Playlist items</p>
            {items.length === 0 ? (
              <p className="text-sm text-hw-muted">No items yet — add from the library below.</p>
            ) : (
              <ul className="space-y-2">
                {items.map((it, index) => (
                  <li
                    key={`${it.mediaId}-${index}`}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 p-2"
                  >
                    {it.type === 'video' ? (
                      <video src={mediaUrl(it.url)} className="h-12 w-16 rounded bg-black object-contain" />
                    ) : (
                      <img
                        src={mediaUrl(it.url)}
                        alt=""
                        className="h-12 w-16 rounded bg-black object-contain"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{it.originalName}</div>
                      <div className="text-xs uppercase text-hw-muted">{it.type}</div>
                    </div>
                    <label className="flex items-center gap-1 text-xs text-hw-muted">
                      Sec
                      <input
                        type="number"
                        min={1}
                        className="input w-20 py-1"
                        value={it.durationSec}
                        onChange={(e) => {
                          const v = Math.max(1, Number(e.target.value) || 1);
                          setItems((prev) =>
                            prev.map((row, i) => (i === index ? { ...row, durationSec: v } : row))
                          );
                        }}
                      />
                    </label>
                    <button type="button" className="btn-secondary text-xs" onClick={() => moveItem(index, -1)}>
                      ↑
                    </button>
                    <button type="button" className="btn-secondary text-xs" onClick={() => moveItem(index, 1)}>
                      ↓
                    </button>
                    <button
                      type="button"
                      className="btn-danger text-xs"
                      onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p className="label">Add from library</p>
            <div className="grid max-h-48 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
              {media.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="rounded-lg border border-gray-200 p-2 text-left hover:border-hw-green"
                  onClick={() => addMedia(m)}
                >
                  {m.type === 'video' ? (
                    <video src={mediaUrl(m.url)} className="mb-1 h-16 w-full bg-black object-contain" />
                  ) : (
                    <img
                      src={mediaUrl(m.url)}
                      alt=""
                      className="mb-1 h-16 w-full bg-black object-contain"
                    />
                  )}
                  <div className="truncate text-xs font-medium">{m.originalName}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button type="button" className="btn-primary" disabled={busy} onClick={save}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!publishTarget}
        title="Publish this playlist to the TV?"
        onClose={() => setPublishTarget(null)}
      >
        <p className="mb-2 text-sm font-medium">{publishTarget?.name}</p>
        <p className="mb-4 text-sm text-hw-muted">
          {publishTarget?.items?.length || 0} item(s) will rotate on the screen.
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => setPublishTarget(null)}>
            CANCEL
          </button>
          <button type="button" className="btn-primary" onClick={confirmPublish}>
            PUBLISH
          </button>
        </div>
      </Modal>

      <Modal open={!!preview} title={preview?.name} onClose={() => setPreview(null)} wide>
        <ul className="mb-4 space-y-3">
          {preview?.items?.map((it) => (
            <li key={it.id} className="flex items-center gap-3">
              {it.type === 'video' ? (
                <video src={mediaUrl(it.url)} className="h-20 w-32 bg-black object-contain" controls />
              ) : (
                <img src={mediaUrl(it.url)} alt="" className="h-20 w-32 bg-black object-contain" />
              )}
              <div className="min-w-0">
                <div className="truncate font-medium">{it.originalName}</div>
                <div className="text-sm text-hw-muted">
                  {it.type} · {it.durationSec}s
                </div>
              </div>
            </li>
          ))}
        </ul>
        <button type="button" className="btn-secondary w-full" onClick={() => setPreview(null)}>
          Close
        </button>
      </Modal>
    </div>
  );
}
