import { ApiError } from '../lib/auth-client';

/** Reads a form into a plain object; maps Turnstile's hidden field to `turnstileToken`. */
export function readForm(form: HTMLFormElement): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  new FormData(form).forEach((value, key) => {
    if (typeof value !== 'string') return;
    if (key === 'cf-turnstile-response') {
      if (value) data['turnstileToken'] = value;
      return;
    }
    data[key] = value;
  });
  form.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((box) => {
    data[box.name] = box.checked;
  });
  return data;
}

export function setMessage(form: HTMLFormElement, tone: 'ok' | 'error' | null, text = '') {
  const el = form.querySelector<HTMLElement>('[data-form-message]');
  if (!el) return;
  el.textContent = text;
  el.dataset['tone'] = tone ?? '';
  el.classList.toggle('hidden', !tone);
}

export function clearErrors(form: HTMLFormElement) {
  form.querySelectorAll<HTMLElement>('[data-error-for]').forEach((el) => (el.textContent = ''));
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  setMessage(form, null);
}

/** Shows API validation errors next to each field and a summary on top. */
export function showError(form: HTMLFormElement, error: unknown) {
  if (error instanceof ApiError) {
    let focused = false;
    for (const detail of error.details) {
      const field = String(detail.path[0] ?? '');
      const slot = form.querySelector<HTMLElement>(`[data-error-for="${CSS.escape(field)}"]`);
      const input = form.querySelector<HTMLElement>(`[name="${CSS.escape(field)}"]`);
      if (slot && !slot.textContent) slot.textContent = detail.message;
      if (input) {
        input.setAttribute('aria-invalid', 'true');
        if (!focused) {
          input.focus();
          focused = true;
        }
      }
    }
    setMessage(form, 'error', error.details.length ? 'Revisa los campos marcados.' : error.message);
  } else {
    setMessage(form, 'error', 'No pudimos conectar. Revisa tu conexión e intenta de nuevo.');
  }
  // A Turnstile token is single use: get a fresh one for the next attempt.
  (window as unknown as { turnstile?: { reset: () => void } }).turnstile?.reset();
}

export function setBusy(form: HTMLFormElement, busy: boolean) {
  const button = form.querySelector<HTMLButtonElement>('button[type=submit]');
  if (!button) return;
  button.disabled = busy;
  button.setAttribute('aria-busy', String(busy));
}

/** Wires a form: validation errors, busy state and a success callback. */
export function handleForm(
  form: HTMLFormElement,
  submit: (data: Record<string, unknown>) => Promise<void>,
) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors(form);
    setBusy(form, true);
    try {
      await submit(readForm(form));
    } catch (error) {
      showError(form, error);
    } finally {
      setBusy(form, false);
    }
  });
}
