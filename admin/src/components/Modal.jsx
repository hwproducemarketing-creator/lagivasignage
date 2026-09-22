export default function Modal({ open, title, children, onClose, wide = false }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        className={`relative z-10 w-full rounded-xl bg-white p-5 shadow-xl ${
          wide ? 'max-w-3xl' : 'max-w-md'
        }`}
      >
        {title && <h3 className="mb-3 font-display text-lg font-semibold text-hw-dark">{title}</h3>}
        {children}
      </div>
    </div>
  );
}
