import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode
} from 'react'
import { IconX } from './icons'

type ButtonVariant = 'primary' | 'ghost' | 'subtle' | 'danger'

const VARIANT_CLS: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-strong',
  ghost: 'bg-transparent text-ink-soft hover:bg-surface-2 hover:text-ink',
  subtle: 'bg-surface-2 text-ink hover:bg-line',
  danger: 'bg-transparent text-rose-600 hover:bg-rose-50'
}

export function Button({
  variant = 'subtle',
  className = '',
  children,
  ...props
}: {
  variant?: ButtonVariant
  className?: string
  children: ReactNode
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${VARIANT_CLS[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export function IconButton({
  title,
  className = '',
  children,
  ...props
}: { title: string; className?: string; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      title={title}
      aria-label={title}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export function Badge({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
      {children}
    </span>
  )
}

export function Modal({
  title,
  onClose,
  children,
  wide = false
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[8vh]"
      onMouseDown={onClose}
    >
      <div
        className={`w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} rounded-2xl bg-surface-0 shadow-xl ring-1 ring-line`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <IconButton title="Close" onClick={onClose}>
            <IconX />
          </IconButton>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-ink-soft">{label}</span>
      {children}
    </label>
  )
}

export const inputCls =
  'w-full rounded-lg border border-line bg-surface-0 px-3 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20'

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-surface-0 px-6 py-10 text-center">
      <p className="text-sm font-medium text-ink-soft">{title}</p>
      {hint && <p className="mt-1 text-xs text-ink-faint">{hint}</p>}
    </div>
  )
}

// ---- Toasts ----
interface Toast {
  id: number
  message: string
  kind: 'ok' | 'error'
}
const ToastCtx = createContext<(message: string, kind?: 'ok' | 'error') => void>(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((message: string, kind: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.floor(Math.random() * 1000)
    setToasts((t) => [...t, { id, message, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`rounded-lg px-4 py-2 text-sm text-white shadow-lg ${
              t.kind === 'ok' ? 'bg-brand-strong' : 'bg-rose-600'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
