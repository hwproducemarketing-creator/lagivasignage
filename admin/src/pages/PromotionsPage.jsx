import { useEffect, useRef, useState } from 'react';
import { api, formatDateTime, mediaUrl } from '../api';
import { useToast } from '../context/ToastContext';
import Modal from '../components/Modal';
import { generatePromotionPng } from '../utils/promotionCanvas';

const empty = {
  productName: '',
  price: '',
  unit: 'per package',
  description: '',
  startAt: '',
  endAt: '',
};

export default function PromotionsPage() {
  const { push } = useToast();
  const [promotions, setPromotions] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(empty);
  const [productImage, setProductImage] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [busy, setBusy] = useState(false);
  const [publishTarget, setPublishTarget] = useState(null);
  const canvasRef = useRef(null);

  async function load() {
    try {
      const data = await api.promotions();
      setPromotions(data.promotions);
    } catch (err) {
      push(err.message, 'error');
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!showCreate) return;
    let cancelled = false;
    (async () => {
      try {
        const dataUrl = await generatePromotionPng({
          ...form,
          productImageUrl: productImage?.url || null,
        });
        if (!cancelled) setPreviewUrl(dataUrl);
      } catch {
        /* ignore preview errors while typing */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [form, productImage, showCreate]);

  function onPickImage(file) {
    if (!file) {
      setProductImage(null);
      return;
    }
    setProductImage({ file, url: URL.createObjectURL(file) });
  }

  async function save({ publish, schedule }) {
    setBusy(true);
    try {
      const dataUrl = await generatePromotionPng({
        ...form,
        productImageUrl: productImage?.url || null,
      });
      const fd = new FormData();
      fd.append('productName', form.productName);
      fd.append('price', form.price);
      fd.append('unit', form.unit || '');
      fd.append('description', form.description || '');
      if (form.startAt) fd.append('startAt', new Date(form.startAt).toISOString());
      if (form.endAt) fd.append('endAt', new Date(form.endAt).toISOString());
      fd.append('generatedDataUrl', dataUrl);
      if (publish) fd.append('publish', 'true');
      if (schedule) fd.append('schedule', 'true');
      if (productImage?.file) fd.append('image', productImage.file);

      const res = await api.createPromotion(fd);
      push(
        publish
          ? `✓ Published successfully — version ${res.version}`
          : 'Promotion saved'
      );
      setShowCreate(false);
      setForm(empty);
      setProductImage(null);
      setPreviewUrl(null);
      await load();
    } catch (err) {
      push(err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function confirmPublish() {
    if (!publishTarget?.generatedMediaId) return;
    try {
      const res = await api.publish(publishTarget.generatedMediaId);
      push(`✓ Published successfully — version ${res.version}`);
      setPublishTarget(null);
      await load();
    } catch (err) {
      push(err.message, 'error');
    }
  }

  async function remove(id) {
    if (!confirm('Delete this promotion?')) return;
    try {
      await api.deletePromotion(id);
      push('Promotion deleted');
      await load();
    } catch (err) {
      push(err.message, 'error');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-semibold text-hw-dark">Promotions</h2>
          <p className="text-sm text-hw-muted">Create 16:9 promotional graphics for the TV</p>
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            setForm(empty);
            setProductImage(null);
            setShowCreate(true);
          }}
        >
          CREATE PROMOTION
        </button>
      </div>

      {promotions.length === 0 ? (
        <div className="card text-sm text-hw-muted">No promotions yet.</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {promotions.map((p) => (
            <article key={p.id} className="card">
              {p.generatedUrl && (
                <img
                  src={mediaUrl(p.generatedUrl)}
                  alt={p.productName}
                  className="mb-3 aspect-video w-full rounded-lg bg-black object-contain"
                />
              )}
              <h3 className="font-semibold">{p.productName}</h3>
              <p className="text-sm text-hw-muted">
                ${p.price} {p.unit || ''} · {formatDateTime(p.createdAt)}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-primary text-xs"
                  onClick={() => setPublishTarget(p)}
                >
                  Publish
                </button>
                <button type="button" className="btn-danger text-xs" onClick={() => remove(p.id)}>
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <Modal
        open={showCreate}
        title="Create Promotion"
        wide
        onClose={() => !busy && setShowCreate(false)}
      >
        <div className="max-h-[75vh] space-y-3 overflow-y-auto pr-1">
          <Field label="Product Name" value={form.productName} onChange={(v) => setForm({ ...form, productName: v })} />
          <Field label="Price" value={form.price} onChange={(v) => setForm({ ...form, price: v })} placeholder="2.99" />
          <Field label="Unit" value={form.unit} onChange={(v) => setForm({ ...form, unit: v })} />
          <Field
            label="Description"
            value={form.description}
            onChange={(v) => setForm({ ...form, description: v })}
          />
          <div>
            <label className="label">Product Image (optional)</label>
            <input
              type="file"
              accept="image/*"
              className="text-sm"
              onChange={(e) => onPickImage(e.target.files?.[0])}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Start</label>
              <input
                type="datetime-local"
                className="input"
                value={form.startAt}
                onChange={(e) => setForm({ ...form, startAt: e.target.value })}
              />
            </div>
            <div>
              <label className="label">End</label>
              <input
                type="datetime-local"
                className="input"
                value={form.endAt}
                onChange={(e) => setForm({ ...form, endAt: e.target.value })}
              />
            </div>
          </div>

          {previewUrl && (
            <div>
              <p className="label">Preview (1920×1080)</p>
              <img src={previewUrl} alt="Preview" className="w-full rounded-lg border border-gray-200" />
            </div>
          )}
          <canvas ref={canvasRef} className="hidden" width={1920} height={1080} />

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setShowCreate(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy || !form.productName || !form.price}
              onClick={() => save({ publish: false, schedule: !!(form.startAt && form.endAt) })}
            >
              Save
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={busy || !form.productName || !form.price}
              onClick={() => save({ publish: true, schedule: false })}
            >
              {busy ? 'Working…' : 'Publish to TV'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!publishTarget}
        title="Publish this content to the TV?"
        onClose={() => setPublishTarget(null)}
      >
        <p className="mb-4 text-sm">{publishTarget?.productName}</p>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => setPublishTarget(null)}>
            CANCEL
          </button>
          <button type="button" className="btn-primary" onClick={confirmPublish}>
            PUBLISH
          </button>
        </div>
      </Modal>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        className="input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
