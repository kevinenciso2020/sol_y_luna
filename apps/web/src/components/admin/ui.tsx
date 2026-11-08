/**
 * Small UI kit for the admin islands. Mobile-first: every control has a >= 44px touch target,
 * lists become cards on narrow screens, and dialogs use the native <dialog> element.
 */
import { Fragment, type ComponentChildren, type JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { ApiError } from '../../lib/auth-client';

export type FieldErrors = Record<string, string>;

/** Maps API validation details (path ['variants', 0, 'sku']) to "variants.0.sku". */
export function toFieldErrors(error: unknown): { message: string; fields: FieldErrors } {
  if (error instanceof ApiError) {
    const fields: FieldErrors = {};
    for (const d of error.details) {
      const key = d.path.join('.');
      if (!fields[key]) fields[key] = d.message;
    }
    return {
      message: error.details.length ? 'Revisa los campos marcados.' : error.message,
      fields,
    };
  }
  return { message: 'No pudimos conectar. Revisa tu conexión e intenta de nuevo.', fields: {} };
}

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button(
  props: Omit<JSX.IntrinsicElements['button'], 'type'> & {
    variant?: ButtonVariant | undefined;
    busy?: boolean | undefined;
    type?: 'button' | 'submit' | undefined;
    disabled?: boolean | undefined;
  },
) {
  const {
    variant = 'primary',
    busy,
    class: className,
    children,
    type = 'button',
    disabled,
    ...rest
  } = props;
  const styles: string = (
    {
      primary: 'bg-luna text-crema hover:bg-luna-700',
      secondary: 'border-2 border-luna text-luna hover:bg-luna-50',
      danger: 'bg-sol-700 text-white hover:bg-sol-800',
      ghost: 'text-luna hover:bg-luna-50',
    } satisfies Record<ButtonVariant, string>
  )[variant];
  return (
    <button
      type={type}
      disabled={disabled || busy}
      aria-busy={busy ? 'true' : undefined}
      class={cx(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        styles,
        typeof className === 'string' && className,
      )}
      {...rest}
    >
      {busy ? 'Guardando…' : children}
    </button>
  );
}

interface FieldShellProps {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  children: ComponentChildren;
  class?: string | undefined;
}

export function FieldShell({
  id,
  label,
  error,
  hint,
  children,
  class: className,
}: FieldShellProps) {
  return (
    <div class={cx('min-w-0 space-y-1.5', className)}>
      <label for={id} class="block text-sm font-semibold text-noche">
        {label}
      </label>
      {children}
      {hint && !error && <p class="text-xs text-noche/70">{hint}</p>}
      {error && (
        <p id={`${id}-error`} class="text-sm font-medium text-sol-700">
          {error}
        </p>
      )}
    </div>
  );
}

const inputClass =
  'block w-full min-h-11 rounded-xl border-2 border-luna/20 bg-white px-3 py-2 text-base text-noche outline-none focus:border-luna aria-[invalid=true]:border-sol-600';

export function TextInput(props: {
  id: string;
  label: string;
  value: string;
  onInput: (value: string) => void;
  error?: string | undefined;
  hint?: string | undefined;
  type?: 'text' | 'email' | 'tel' | 'password' | 'url' | 'date' | 'datetime-local' | undefined;
  required?: boolean | undefined;
  inputMode?: 'numeric' | 'text' | 'email' | 'tel' | 'url' | undefined;
  placeholder?: string | undefined;
  class?: string | undefined;
}) {
  return (
    <FieldShell
      id={props.id}
      label={props.label}
      error={props.error}
      hint={props.hint}
      class={props.class}
    >
      <input
        id={props.id}
        // Preact 11 types input attributes per type; the union is safe here.
        type={(props.type ?? 'text') as 'text'}
        value={props.value}
        required={props.required}
        inputMode={props.inputMode}
        placeholder={props.placeholder}
        aria-invalid={props.error ? 'true' : undefined}
        aria-describedby={props.error ? `${props.id}-error` : undefined}
        onInput={(e) => props.onInput((e.target as HTMLInputElement).value)}
        class={inputClass}
      />
    </FieldShell>
  );
}

export function TextArea(props: {
  id: string;
  label: string;
  value: string;
  onInput: (value: string) => void;
  error?: string | undefined;
  hint?: string | undefined;
  rows?: number | undefined;
  class?: string | undefined;
}) {
  return (
    <FieldShell
      id={props.id}
      label={props.label}
      error={props.error}
      hint={props.hint}
      class={props.class}
    >
      <textarea
        id={props.id}
        rows={props.rows ?? 4}
        value={props.value}
        aria-invalid={props.error ? 'true' : undefined}
        onInput={(e) => props.onInput((e.target as HTMLTextAreaElement).value)}
        class={cx(inputClass, 'min-h-24')}
      />
    </FieldShell>
  );
}

export function Select(props: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  error?: string | undefined;
  hint?: string | undefined;
  class?: string | undefined;
}) {
  return (
    <FieldShell
      id={props.id}
      label={props.label}
      error={props.error}
      hint={props.hint}
      class={props.class}
    >
      <select
        id={props.id}
        value={props.value}
        aria-invalid={props.error ? 'true' : undefined}
        onChange={(e) => props.onChange((e.target as HTMLSelectElement).value)}
        class={inputClass}
      >
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export function Toggle(props: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string | undefined;
}) {
  return (
    <label for={props.id} class="flex min-h-11 cursor-pointer items-start gap-3">
      <input
        id={props.id}
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange((e.target as HTMLInputElement).checked)}
        class="mt-1 size-5 shrink-0 accent-luna"
      />
      <span>
        <span class="block text-sm font-semibold">{props.label}</span>
        {props.hint && <span class="block text-xs text-noche/70">{props.hint}</span>}
      </span>
    </label>
  );
}

export function Notice({
  tone,
  children,
}: {
  tone: 'ok' | 'error' | 'info';
  children: ComponentChildren;
}) {
  const styles = {
    ok: 'bg-luna-50 text-luna-800',
    error: 'bg-sol-50 text-sol-800',
    info: 'bg-crema-200 text-noche',
  }[tone];
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      class={cx('rounded-2xl px-4 py-3 text-sm font-medium', styles)}
    >
      {children}
    </p>
  );
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'ok' | 'warn' | 'neutral' | 'danger' | undefined;
  children: ComponentChildren;
}) {
  const styles = {
    ok: 'bg-luna-100 text-luna-800',
    warn: 'bg-crema-300 text-noche',
    neutral: 'bg-noche-50 text-noche-700',
    danger: 'bg-sol-100 text-sol-800',
  }[tone];
  return (
    <span class={cx('inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold', styles)}>
      {children}
    </span>
  );
}

/** Accessible confirmation dialog (native <dialog>: focus trap and Esc handled by the browser). */
export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  body: ComponentChildren;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
  danger?: boolean | undefined;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (props.open && !dialog.open) dialog.showModal();
    if (!props.open && dialog.open) dialog.close();
  }, [props.open]);
  return (
    <dialog
      ref={ref}
      onClose={props.onClose}
      class="m-auto w-[min(92vw,28rem)] rounded-3xl p-0 text-noche backdrop:bg-noche/50"
    >
      <div class="space-y-4 p-6">
        <h2 class="font-display text-2xl text-luna">{props.title}</h2>
        <div class="text-sm">{props.body}</div>
        <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={props.onClose}>
            Cancelar
          </Button>
          <Button
            variant={props.danger ? 'danger' : 'primary'}
            busy={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await props.onConfirm();
              } finally {
                setBusy(false);
              }
            }}
          >
            {props.confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

/** Modal container for create/edit forms. Full screen on phones, centered card on larger screens. */
export function FormDialog(props: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ComponentChildren;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (props.open && !dialog.open) dialog.showModal();
    if (!props.open && dialog.open) dialog.close();
  }, [props.open]);
  return (
    <dialog
      ref={ref}
      onClose={props.onClose}
      class="m-0 h-dvh max-h-dvh w-screen max-w-none bg-crema-50 p-0 text-noche backdrop:bg-noche/50 sm:m-auto sm:h-auto sm:max-h-[90dvh] sm:w-[min(92vw,40rem)] sm:rounded-3xl"
    >
      <div class="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-luna/10 bg-crema-50 px-5 py-3">
        <h2 class="font-display text-xl text-luna">{props.title}</h2>
        <button
          type="button"
          onClick={props.onClose}
          class="grid size-11 place-items-center rounded-full text-2xl text-luna hover:bg-luna-50"
          aria-label="Cerrar"
        >
          ×
        </button>
      </div>
      <div class="p-5">{props.children}</div>
    </dialog>
  );
}

export function Pagination(props: {
  page: number;
  totalPages: number;
  total: number;
  onPage: (page: number) => void;
}) {
  if (props.totalPages <= 1) return <p class="text-sm text-noche/70">{props.total} resultados</p>;
  return (
    <nav aria-label="Paginación" class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-sm text-noche/70">
        Página {props.page} de {props.totalPages} · {props.total} resultados
      </p>
      <div class="flex gap-2">
        <Button
          variant="secondary"
          disabled={props.page <= 1}
          onClick={() => props.onPage(props.page - 1)}
        >
          Anterior
        </Button>
        <Button
          variant="secondary"
          disabled={props.page >= props.totalPages}
          onClick={() => props.onPage(props.page + 1)}
        >
          Siguiente
        </Button>
      </div>
    </nav>
  );
}

export interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => ComponentChildren;
  /** Hidden from the mobile card (shown only in the desktop table). */
  desktopOnly?: boolean | undefined;
  class?: string | undefined;
}

/**
 * Responsive data list: a real <table> from md up, stacked cards below md (no horizontal scroll).
 */
export function DataList<T extends { id: string }>(props: {
  rows: T[];
  columns: Column<T>[];
  actions?: (row: T) => ComponentChildren;
  empty: ComponentChildren;
  caption: string;
}) {
  if (props.rows.length === 0) {
    return (
      <div class="rounded-3xl border-2 border-dashed border-luna/20 p-8 text-center">
        {props.empty}
      </div>
    );
  }
  return (
    <>
      <ul class="space-y-3 md:hidden" aria-label={props.caption}>
        {props.rows.map((row) => (
          <li key={row.id} class="rounded-3xl bg-white p-4 ring-1 ring-luna/10">
            <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              {props.columns
                .filter((c) => !c.desktopOnly)
                .map((c) => (
                  <Fragment key={c.key}>
                    <dt class="font-semibold text-noche/70">{c.label}</dt>
                    <dd class="min-w-0 break-words">{c.render(row)}</dd>
                  </Fragment>
                ))}
            </dl>
            {props.actions && <div class="mt-3 flex flex-wrap gap-2">{props.actions(row)}</div>}
          </li>
        ))}
      </ul>
      <div class="hidden overflow-hidden rounded-3xl bg-white ring-1 ring-luna/10 md:block">
        <table class="w-full text-left text-sm">
          <caption class="sr-only">{props.caption}</caption>
          <thead class="bg-luna-50 text-xs text-luna-800">
            <tr>
              {props.columns.map((c) => (
                <th key={c.key} scope="col" class={cx('px-4 py-3 font-bold', c.class)}>
                  {c.label}
                </th>
              ))}
              {props.actions && (
                <th scope="col" class="px-4 py-3 text-right font-bold">
                  Acciones
                </th>
              )}
            </tr>
          </thead>
          <tbody class="divide-y divide-luna/10">
            {props.rows.map((row) => (
              <tr key={row.id} class="align-middle">
                {props.columns.map((c) => (
                  <td key={c.key} class={cx('px-4 py-3', c.class)}>
                    {c.render(row)}
                  </td>
                ))}
                {props.actions && (
                  <td class="px-4 py-3">
                    <div class="flex flex-wrap justify-end gap-2">{props.actions(row)}</div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function PageHeader(props: {
  title: string;
  description?: string | undefined;
  actions?: ComponentChildren;
}) {
  return (
    <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 class="text-3xl sm:text-4xl">{props.title}</h1>
        {props.description && <p class="mt-1 max-w-[60ch] text-noche/80">{props.description}</p>}
      </div>
      {props.actions && <div class="flex flex-wrap gap-2">{props.actions}</div>}
    </div>
  );
}

export function Loading() {
  return (
    <p role="status" class="py-10 text-center text-noche/70">
      Cargando…
    </p>
  );
}
