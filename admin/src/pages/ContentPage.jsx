import { useCallback, useEffect, useRef, useState } from 'react';
import { api, formatBytes, formatDateTime, mediaUrl } from '../api';
import { useToast } from '../context/ToastContext';
import Modal from '../components/Modal';

const ACCEPT = 'image/jpeg,image/png,image/webp,video/mp4,.jpg,.jpeg,.png,.webp,.mp4';

export default function ContentPage() {
  const { push } = useToast();
  const [media, setMedia] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [selected, setSelected] = useState(null);
  const [preview, setPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [publishTarget, setPublishTarget] = useState(null);
  const [previewItem, setPreviewItem] = useState(null);
  const [scheduleFor, setScheduleFor] = useState(null);
  const [scheduleForm, setScheduleForm] = useState({ startAt: '', endAt: '' });
  const inputRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const data = await api.media();
      setMedia(data.media);
    } catch (err) {
      push(err.message, 'error');
    }
  }, [push]);

  useEffect(() => {
    load();
  }, [load]);

  function pickFile(file) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const isVideo = file.type.startsWith('video/');
    setSelected({
      file,
      url,
      name: file.name,
      size: file.size,
      type: isVideo ? 'video' : 'image',
      width: null,
      height: null,
    });
    setPreview(url);
    if (!isVideo) {
      const img = new Image();
      img.onload = () => {
        setSelected((s) => (s ? { ...s, width: img.width, height: img.height } : s));
      };
      img.src = url;
    }
  }

  async function upload() {
    if (!selected) return;
    setUploading(true);
    setProgress(20);
    try {
      const fd = new FormData();
      fd.append('file', selected.file);
      if (selected.width) fd.append('width', String(selected.width));
      if (selected.height) fd.append('height', String(selected.height));
      setProgress(60);
      await api.upload(fd);
      setProgress(100);
      push('Upload successful');
      setSelected(null);
      setPreview(null);
      await load();
    } catch (err) {
      push(err.message, 'error');
    } finally {
      setUploading(false);
      setProgress(0);
    }
  }

  async function confirmPublish() {
    if (!publishTarget) return;
    try {
      const res = await api.publish(publishTarget.id);
      push(`✓ Published successfully — version ${res.version}`);
      setPublishTarget(null);
      await load();
    } catch (err) {
      push(err.message || 'Unable to publish. Please try again.', 'error');
    }
  }

  async function onDelete(item) {
    if (!confirm(`Delete ${item.originalName}?`)) return;
    try {
      await api.deleteMedia(item.id);
      push('Deleted');
      await load();
    } catch (err) {
      push(err.message, 'error');
    }
  }

  async function onSetDefault(item) {
    try {
      await api.setDefault(item.id);
      push('Default content updated');
      await load();
    } catch (err) {
      push(err.message, 'error');
    }
  }

  async function saveSchedule() {
    if (!scheduleFor) return;
    try {
      await api.createSchedule({
        mediaId: scheduleFor.id,
        startAt: new Date(scheduleForm.startAt).toISOString(),
        endAt: new Date(scheduleForm.endAt).toISOString(),
      });
      push('Schedule saved');
      setScheduleFor(null);
    } catch (err) {
      push(err.message, 'error');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold text-hw-dark">Content</h2>
        <p className="text-sm text-hw-muted">Upload, preview, and publish signage media</p>
      </div>

      <section className="card">
        <h3 className="mb-3 font-display text-lg font-semibold">Upload Content</h3>
        <div
          className={`rounded-xl border-2 border-dashed p-8 text-center transition ${
            dragOver ? 'border-hw-fresh bg-hw-light' : 'border-gray-300 bg-hw-gray/40'
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            pickFile(e.dataTransfer.files?.[0]);
          }}
        >
          <p className="font-medium text-hw-text">Drag files here</p>
          <p className="my-2 text-sm text-hw-muted">or</p>
          <button type="button" className="btn-secondary" onClick={() => inputRef.current?.click()}>
            SELECT FILE
          </button>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
          <p className="mt-3 text-xs text-hw-muted">Supported: JPG PNG WEBP MP4 (max 100 MB)</p>
        </div>

        {selected && (
          <div className="mt-4 rounded-lg border border-gray-200 p-4">
            {selected.type === 'video' ? (
              <video src={preview} className="mb-3 max-h-56 w-full rounded bg-black object-contain" controls />
            ) : (
              <img src={preview} alt="" className="mb-3 max-h-56 w-full rounded bg-black object-contain" />
            )}
            <p className="text-sm font-medium">{selected.name}</p>
            <p className="text-sm text-hw-muted">
              {formatBytes(selected.size)}
              {selected.width ? ` · ${selected.width}×${selected.height}` : ''}
            </p>
            {uploading && (
              <div className="mt-2 h-2 overflow-hidden rounded bg-gray-200">
                <div className="h-full bg-hw-green transition-all" style={{ width: `${progress}%` }} />
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="btn-primary" disabled={uploading} onClick={upload}>
                {uploading ? 'Uploading…' : 'UPLOAD'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setSelected(null);
                  setPreview(null);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-3 font-display text-lg font-semibold text-hw-dark">Library</h3>
        {media.length === 0 ? (
          <div className="card text-sm text-hw-muted">No media uploaded yet.</div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {media.map((item) => (
              <article key={item.id} className="card flex flex-col p-3">
                <button
                  type="button"
                  className="mb-3 overflow-hidden rounded-lg bg-black"
                  onClick={() => setPreviewItem(item)}
                >
                  {item.type === 'video' ? (
                    <video src={mediaUrl(item.url)} className="h-40 w-full object-contain" />
                  ) : (
                    <img
                      src={mediaUrl(item.url)}
                      alt={item.originalName}
                      className="h-40 w-full object-contain"
                    />
                  )}
                </button>
                <div className="mb-2 min-w-0 flex-1">
                  <div className="truncate font-semibold">{item.originalName}</div>
                  <div className="text-xs text-hw-muted">
                    {item.type.toUpperCase()} · {formatBytes(item.size)} ·{' '}
                    {formatDateTime(item.createdAt)}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {item.isPublished && (
                      <span className="rounded bg-hw-light px-2 py-0.5 text-xs font-semibold text-hw-dark">
                        Published
                      </span>
                    )}
                    {item.isDefault && (
                      <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-semibold text-hw-muted">
                        Default
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-secondary text-xs" onClick={() => setPreviewItem(item)}>
                    Preview
                  </button>
                  <button
                    type="button"
                    className="btn-primary text-xs"
                    onClick={() => setPublishTarget(item)}
                  >
                    Publish
                  </button>
                  <button type="button" className="btn-secondary text-xs" onClick={() => onSetDefault(item)}>
                    Default
                  </button>
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={() => {
                      setScheduleFor(item);
                      setScheduleForm({ startAt: '', endAt: '' });
                    }}
                  >
                    Schedule
                  </button>
                  <button type="button" className="btn-danger text-xs" onClick={() => onDelete(item)}>
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <Modal
        open={!!publishTarget}
        title="Publish this content to the TV?"
        onClose={() => setPublishTarget(null)}
      >
        <p className="mb-4 text-sm text-hw-muted">{publishTarget?.originalName}</p>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => setPublishTarget(null)}>
            CANCEL
          </button>
          <button type="button" className="btn-primary" onClick={confirmPublish}>
            PUBLISH
          </button>
        </div>
      </Modal>

      <Modal open={!!previewItem} title={previewItem?.originalName} onClose={() => setPreviewItem(null)}>
        {previewItem?.type === 'video' ? (
          <video src={mediaUrl(previewItem.url)} className="mb-4 max-h-80 w-full bg-black" controls autoPlay />
        ) : (
          <img src={mediaUrl(previewItem?.url)} alt="" className="mb-4 max-h-80 w-full object-contain" />
        )}
        <button type="button" className="btn-secondary w-full" onClick={() => setPreviewItem(null)}>
          Close
        </button>
      </Modal>

      <Modal open={!!scheduleFor} title="Schedule content" onClose={() => setScheduleFor(null)}>
        <p className="mb-3 text-sm text-hw-muted">{scheduleFor?.originalName}</p>
        <label className="label">Start</label>
        <input
          type="datetime-local"
          className="input mb-3"
          value={scheduleForm.startAt}
          onChange={(e) => setScheduleForm((f) => ({ ...f, startAt: e.target.value }))}
        />
        <label className="label">End</label>
        <input
          type="datetime-local"
          className="input mb-4"
          value={scheduleForm.endAt}
          onChange={(e) => setScheduleForm((f) => ({ ...f, endAt: e.target.value }))}
        />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => setScheduleFor(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!scheduleForm.startAt || !scheduleForm.endAt}
            onClick={saveSchedule}
          >
            Save schedule
          </button>
        </div>
      </Modal>
    </div>
  );
}
