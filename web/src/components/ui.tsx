import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Shows a spinner beside the label and disables the control while a request is running. */
  busy?: boolean;
}

export function Button({ variant = 'secondary', busy = false, children, disabled, className, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={['btn', `btn-${variant}`, className].filter(Boolean).join(' ')}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? <span className="spinner" aria-hidden="true" /> : null}
      <span>{children}</span>
    </button>
  );
}

export function Card({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section className="card" id={id} aria-labelledby={`${id}-title`}>
      <header className="card-header">
        <h2 id={`${id}-title`}>{title}</h2>
        {description ? <p className="card-description">{description}</p> : null}
      </header>
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, wide }: { label: string; value: ReactNode; hint?: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'stat stat-wide' : 'stat'}>
      <dt className="stat-label">{label}</dt>
      <dd className="stat-value">
        <span className="num">{value}</span>
        {hint ? <span className="stat-hint">{hint}</span> : null}
      </dd>
    </div>
  );
}

export function StatList({ children }: { children: ReactNode }) {
  return <dl className="stats">{children}</dl>;
}

type Tone = 'info' | 'success' | 'warning' | 'danger';

export function Notice({ tone, title, children, role }: { tone: Tone; title?: string; children: ReactNode; role?: 'alert' | 'status' }) {
  return (
    <div className={`notice notice-${tone}`} role={role}>
      <span className="notice-mark" aria-hidden="true">
        {tone === 'success' ? '✓' : tone === 'danger' ? '✕' : tone === 'warning' ? '!' : 'i'}
      </span>
      <div className="notice-body">
        {title ? <p className="notice-title">{title}</p> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}

export function ExternalLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/** Small explanatory text placed beside a disabled control. */
export function Reason({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p className="reason" id={id}>
      {children}
    </p>
  );
}

export function Badge({ tone, children }: { tone: Tone | 'neutral'; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Steps({ children }: { children: ReactNode }) {
  return <ol className="steps">{children}</ol>;
}

export function Step({ title, done, children }: { title: string; done?: boolean; children: ReactNode }) {
  return (
    <li className={done ? 'step step-done' : 'step'}>
      <p className="step-title">
        {title}
        {done ? <Badge tone="success">Done</Badge> : null}
      </p>
      {children}
    </li>
  );
}
