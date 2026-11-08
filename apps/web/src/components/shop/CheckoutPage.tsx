import { formatCOP } from '@sol-y-luna/shared';
import { DEPARTMENTS, getMunicipalities } from '@sol-y-luna/shared/divipola';
import { PUBLIC_TURNSTILE_SITE_KEY } from 'astro:env/client';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ApiError, apiFetch } from '../../lib/auth-client';
import { cartApi, isSignedIn, shopFetch, type Cart } from '../../lib/cart-client';
import { Select, TextArea, TextInput, Toggle, toFieldErrors, type FieldErrors } from '../admin/ui';

type Provider = 'MOCK' | 'MERCADOPAGO' | 'WOMPI';
const PROVIDER_LABELS: Record<Provider, { title: string; text: string }> = {
  WOMPI: { title: 'Wompi', text: 'Tarjeta, PSE, Nequi o Bancolombia.' },
  MERCADOPAGO: { title: 'Mercado Pago', text: 'Tarjeta, PSE o saldo en Mercado Pago.' },
  MOCK: {
    title: 'Pago de prueba',
    text: 'Modo demo: eliges si el pago se aprueba, se rechaza o queda pendiente.',
  },
};

interface SavedAddress {
  id: string;
  recipientName: string;
  addressLine: string;
  municipalityName: string | null;
  departmentName: string | null;
  isDefault: boolean;
}

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove?: (id: string) => void;
    };
  }
}

/**
 * Turnstile for guest checkout. The container only exists once the cart has loaded, so the widget
 * is rendered when the element mounts (callback ref), not on the first render.
 */
function useTurnstile(enabled: boolean) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [token, setToken] = useState<string | undefined>();
  const widget = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || !PUBLIC_TURNSTILE_SITE_KEY || !container) return;
    const render = () => {
      if (window.turnstile && widget.current === null) {
        widget.current = window.turnstile.render(container, {
          sitekey: PUBLIC_TURNSTILE_SITE_KEY,
          language: 'es',
          callback: (t: string) => setToken(t),
          'expired-callback': () => setToken(undefined),
        });
      }
    };
    if (window.turnstile) render();
    else {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.onload = render;
      document.head.appendChild(script);
    }
    return () => {
      if (widget.current !== null) window.turnstile?.remove?.(widget.current);
      widget.current = null;
    };
  }, [enabled, container]);
  const reset = () => {
    setToken(undefined);
    if (widget.current !== null) window.turnstile?.reset(widget.current);
  };
  return {
    ref: setContainer,
    token,
    reset,
    active: enabled && Boolean(PUBLIC_TURNSTILE_SITE_KEY),
  };
}

const ERROR_KEYS: Record<string, string> = {
  name: 'contact.name',
  email: 'contact.email',
  phone: 'contact.phone',
  documentNumber: 'contact.documentNumber',
  recipientName: 'address.recipientName',
  addressPhone: 'address.phone',
  departmentCode: 'address.departmentCode',
  municipalityCode: 'address.municipalityCode',
  addressLine: 'address.addressLine',
  neighborhood: 'address.neighborhood',
  instructions: 'address.instructions',
};

const Section = ({ title, children }: { title: string; children: preact.ComponentChildren }) => (
  <section class="rounded-[1.75rem] bg-white p-5 ring-1 ring-luna/10 sm:p-6">
    <h2 class="text-2xl">{title}</h2>
    <div class="mt-4 space-y-4">{children}</div>
  </section>
);

export default function CheckoutPage() {
  const signedIn = isSignedIn();
  const coupon =
    typeof window === 'undefined'
      ? ''
      : (new URLSearchParams(window.location.search).get('cupon') ??
        sessionStorage.getItem('syl_cupon') ??
        '');
  const [cart, setCart] = useState<Cart | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [demo, setDemo] = useState(false);
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [addressId, setAddressId] = useState<string>('nueva');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const turnstile = useTurnstile(!signedIn);

  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    documentNumber: '',
    recipientName: '',
    addressPhone: '',
    departmentCode: '',
    municipalityCode: '',
    addressLine: '',
    neighborhood: '',
    instructions: '',
    saveAddress: true,
    discreetPackaging: false,
    notes: '',
    paymentProvider: '' as Provider | '',
    acceptTerms: false,
    acceptDataPolicy: false,
  });
  // Editing a field clears its own error (and the department also clears the municipality's).
  const clearError = (key: string) =>
    setErrors((current) => {
      const target = ERROR_KEYS[key] ?? key;
      const next = Object.fromEntries(
        Object.entries(current).filter(
          ([k]) =>
            k !== target &&
            !(key === 'departmentCode' && k === 'address.municipalityCode') &&
            !(key === 'addressLine' && k === 'address'),
        ),
      );
      if (Object.keys(next).length === 0) setMessage('');
      return next;
    });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    clearError(key);
  };
  const municipalities = useMemo(
    () => (form.departmentCode ? getMunicipalities(form.departmentCode) : []),
    [form.departmentCode],
  );

  useEffect(() => {
    cartApi
      .get(coupon || undefined)
      .then(setCart, () => setMessage('No pudimos cargar tu carrito.'));
    shopFetch<{ data: { providers: Provider[]; demo: boolean } }>('/api/checkout/options').then(
      (r) => {
        setProviders(r.data.providers);
        setDemo(r.data.demo);
        setForm((f) => ({ ...f, paymentProvider: r.data.providers[0] ?? '' }));
      },
    );
    if (signedIn) {
      apiFetch<{ user: { name: string; email: string; phone: string | null } }>('/api/auth/me')
        .then(({ user }) =>
          setForm((f) => ({
            ...f,
            name: user.name,
            email: user.email,
            phone: user.phone ?? '',
            recipientName: user.name,
            addressPhone: user.phone ?? '',
          })),
        )
        .catch(() => undefined);
      apiFetch<{ data: SavedAddress[] }>('/api/account/addresses')
        .then((r) => {
          setAddresses(r.data);
          const preferred = r.data.find((a) => a.isDefault) ?? r.data[0];
          if (preferred) setAddressId(preferred.id);
        })
        .catch(() => undefined);
    }
  }, []);

  if (!cart)
    return (
      <p class="py-16 text-center text-noche/70" role="status">
        {message || 'Cargando…'}
      </p>
    );
  if (cart.lines.length === 0) {
    return (
      <div class="rounded-[2rem] border-2 border-dashed border-luna/25 p-10 text-center">
        <p class="font-display text-3xl font-bold text-luna">Tu carrito está vacío</p>
        <a href="/productos" class="pill-cta mt-6">
          Ver productos <span aria-hidden="true">→</span>
        </a>
      </div>
    );
  }

  const err = (key: string) => errors[key];

  async function submit(event: Event) {
    event.preventDefault();
    setSending(true);
    setErrors({});
    setMessage('');
    const useSaved = addressId !== 'nueva';
    const body = {
      contact: {
        name: form.name,
        email: form.email,
        phone: form.phone,
        documentNumber: form.documentNumber,
      },
      ...(useSaved
        ? { addressId }
        : {
            address: {
              recipientName: form.recipientName || form.name,
              phone: form.addressPhone || form.phone,
              departmentCode: form.departmentCode,
              municipalityCode: form.municipalityCode,
              addressLine: form.addressLine,
              ...(form.neighborhood ? { neighborhood: form.neighborhood } : {}),
              ...(form.instructions ? { instructions: form.instructions } : {}),
            },
            saveAddress: signedIn && form.saveAddress,
          }),
      discreetPackaging: form.discreetPackaging,
      ...(form.notes ? { notes: form.notes } : {}),
      ...(cart?.coupon?.ok ? { couponCode: cart.coupon.code } : {}),
      paymentProvider: form.paymentProvider,
      acceptTerms: form.acceptTerms,
      acceptDataPolicy: form.acceptDataPolicy,
      ...(turnstile.token ? { turnstileToken: turnstile.token } : {}),
    };
    try {
      const res = await shopFetch<{ data: { redirectUrl: string } }>('/api/checkout', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      sessionStorage.removeItem('syl_cupon');
      sessionStorage.setItem('syl_cart_n', '0');
      window.location.assign(res.data.redirectUrl);
    } catch (e) {
      const parsed = toFieldErrors(e);
      setErrors(parsed.fields);
      // The coupon has no field on this page (it is applied in the cart): say what failed.
      const couponError = parsed.fields['couponCode'];
      setMessage(
        e instanceof ApiError && e.code === 'CART_CHANGED'
          ? `${e.message} `
          : couponError
            ? `El cupón ${cart?.coupon?.code ?? ''} no se puede usar: ${couponError}. Quítalo en el carrito para continuar.`
            : parsed.message,
      );
      turnstile.reset();
      setSending(false);
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('[aria-invalid="true"], [role="alert"]')?.focus(),
      );
    }
  }

  return (
    <form onSubmit={submit} noValidate class="grid gap-6 lg:grid-cols-[1fr_22rem] lg:items-start">
      <div class="space-y-6">
        {demo && (
          <p class="rounded-2xl bg-crema-200 px-4 py-3 text-sm">
            <strong>Modo demo:</strong> no se hacen cobros reales. Al final eliges el resultado del
            pago.
          </p>
        )}
        {message && (
          <p
            role="alert"
            tabIndex={-1}
            class="rounded-2xl bg-sol-50 px-4 py-3 text-sm font-medium text-sol-800"
          >
            {message}
            {message.includes('carrito') && (
              <a href="/carrito" class="ml-1 font-bold underline">
                Ir al carrito
              </a>
            )}
          </p>
        )}

        <Section title="Tus datos">
          {!signedIn && (
            <p class="text-sm text-noche/75">
              Compras como invitado. ¿Tienes cuenta?{' '}
              <a href="/cuenta/ingresar?next=/checkout" class="font-semibold text-luna underline">
                Ingresa
              </a>
            </p>
          )}
          <div class="grid gap-4 sm:grid-cols-2">
            <TextInput
              id="name"
              label="Nombre y apellido"
              value={form.name}
              error={err('contact.name')}
              onInput={(v) => set('name', v)}
            />
            <TextInput
              id="email"
              label="Correo"
              type="email"
              inputMode="email"
              value={form.email}
              error={err('contact.email')}
              hint="Te enviamos la confirmación y la guía."
              onInput={(v) => set('email', v)}
            />
            <TextInput
              id="phone"
              label="Celular"
              type="tel"
              inputMode="tel"
              value={form.phone}
              error={err('contact.phone')}
              onInput={(v) => set('phone', v)}
            />
            <TextInput
              id="documentNumber"
              label="Cédula (opcional)"
              inputMode="numeric"
              value={form.documentNumber}
              error={err('contact.documentNumber')}
              onInput={(v) => set('documentNumber', v)}
            />
          </div>
        </Section>

        <Section title="Dirección de entrega">
          {addresses.length > 0 && (
            <fieldset class="space-y-2">
              <legend class="sr-only">Elige una dirección</legend>
              {[
                ...addresses.map((a) => ({
                  id: a.id,
                  label: `${a.addressLine}, ${a.municipalityName ?? ''} (${a.departmentName ?? ''})`,
                  sub: a.recipientName,
                })),
                { id: 'nueva', label: 'Otra dirección', sub: '' },
              ].map((opt) => (
                <label
                  key={opt.id}
                  class="flex min-h-12 cursor-pointer items-start gap-3 rounded-2xl border-2 border-luna/15 p-3 has-[:checked]:border-luna"
                >
                  <input
                    type="radio"
                    name="addressId"
                    value={opt.id}
                    checked={addressId === opt.id}
                    onChange={() => setAddressId(opt.id)}
                    class="mt-1 size-5 accent-luna"
                  />
                  <span>
                    <span class="block font-semibold">{opt.label}</span>
                    {opt.sub && <span class="block text-sm text-noche/70">{opt.sub}</span>}
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          {addressId === 'nueva' && (
            <div class="grid gap-4 sm:grid-cols-2">
              <TextInput
                id="recipientName"
                label="Quién recibe"
                value={form.recipientName}
                error={err('address.recipientName')}
                hint="Si lo dejas vacío, usamos tu nombre."
                onInput={(v) => set('recipientName', v)}
              />
              <TextInput
                id="addressPhone"
                label="Celular de quien recibe"
                type="tel"
                inputMode="tel"
                value={form.addressPhone}
                error={err('address.phone')}
                hint="Si lo dejas vacío, usamos tu celular."
                onInput={(v) => set('addressPhone', v)}
              />
              <Select
                id="departmentCode"
                label="Departamento"
                value={form.departmentCode}
                error={err('address.departmentCode')}
                onChange={(v) => {
                  setForm((f) => ({ ...f, departmentCode: v, municipalityCode: '' }));
                  clearError('departmentCode');
                }}
                options={[
                  { value: '', label: 'Elige el departamento' },
                  ...DEPARTMENTS.map((d) => ({ value: d.code, label: d.name })),
                ]}
              />
              <Select
                id="municipalityCode"
                label="Municipio"
                value={form.municipalityCode}
                error={err('address.municipalityCode')}
                onChange={(v) => set('municipalityCode', v)}
                options={[
                  {
                    value: '',
                    label: form.departmentCode
                      ? 'Elige el municipio'
                      : 'Primero elige el departamento',
                  },
                  ...municipalities.map((m) => ({ value: m.code, label: m.name })),
                ]}
              />
              <TextInput
                id="addressLine"
                label="Dirección"
                value={form.addressLine}
                error={err('address.addressLine') ?? err('address')}
                placeholder="Calle 10 # 43-20, apto 502"
                class="sm:col-span-2"
                onInput={(v) => set('addressLine', v)}
              />
              <TextInput
                id="neighborhood"
                label="Barrio (opcional)"
                value={form.neighborhood}
                error={err('address.neighborhood')}
                onInput={(v) => set('neighborhood', v)}
              />
              <TextInput
                id="instructions"
                label="Indicaciones (opcional)"
                value={form.instructions}
                error={err('address.instructions')}
                placeholder="Portería, horario…"
                onInput={(v) => set('instructions', v)}
              />
              {signedIn && (
                <Toggle
                  id="saveAddress"
                  label="Guardar esta dirección en mi cuenta"
                  checked={form.saveAddress}
                  onChange={(v) => set('saveAddress', v)}
                />
              )}
            </div>
          )}
          <Toggle
            id="discreetPackaging"
            label="Empaque discreto"
            hint="Caja sin logos ni nombre de los productos."
            checked={form.discreetPackaging}
            onChange={(v) => set('discreetPackaging', v)}
          />
          <TextArea
            id="notes"
            label="Notas para el pedido (opcional)"
            rows={2}
            value={form.notes}
            error={err('notes')}
            onInput={(v) => set('notes', v)}
          />
        </Section>

        <Section title="Medio de pago">
          {providers.length === 0 ? (
            <p class="text-sm text-sol-700">No hay medios de pago disponibles en este momento.</p>
          ) : (
            <fieldset class="space-y-2">
              <legend class="sr-only">Elige cómo pagar</legend>
              {providers.map((p) => (
                <label
                  key={p}
                  class="flex min-h-12 cursor-pointer items-start gap-3 rounded-2xl border-2 border-luna/15 p-3 has-[:checked]:border-luna"
                >
                  <input
                    type="radio"
                    name="paymentProvider"
                    value={p}
                    checked={form.paymentProvider === p}
                    onChange={() => set('paymentProvider', p)}
                    class="mt-1 size-5 accent-luna"
                  />
                  <span>
                    <span class="block font-semibold">{PROVIDER_LABELS[p].title}</span>
                    <span class="block text-sm text-noche/70">{PROVIDER_LABELS[p].text}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          {err('paymentProvider') && (
            <p class="text-sm font-medium text-sol-700">{err('paymentProvider')}</p>
          )}
        </Section>
      </div>

      <aside
        class="space-y-4 rounded-[1.75rem] bg-white p-5 ring-1 ring-luna/10 sm:p-6 lg:sticky lg:top-6"
        aria-labelledby="tu-pedido"
      >
        <h2 id="tu-pedido" class="text-2xl">
          Tu pedido
        </h2>
        <ul class="space-y-2 text-sm">
          {cart.lines.map((l) => (
            <li key={l.variantId} class="flex justify-between gap-3">
              <span>
                {l.productName} · {l.variantName} × {l.quantity}
              </span>
              <span class="shrink-0 font-semibold">{formatCOP(l.lineTotal)}</span>
            </li>
          ))}
        </ul>
        <dl class="space-y-2 border-t border-luna/15 pt-3">
          <div class="flex justify-between">
            <dt>Subtotal</dt>
            <dd>{formatCOP(cart.totals.subtotal)}</dd>
          </div>
          {cart.totals.discount > 0 && (
            <div class="flex justify-between text-luna">
              <dt>Descuento ({cart.coupon?.code})</dt>
              <dd>−{formatCOP(cart.totals.discount)}</dd>
            </div>
          )}
          <div class="flex justify-between">
            <dt>Envío</dt>
            <dd class="font-semibold text-luna">Envío gratis</dd>
          </div>
          <div class="flex justify-between font-display text-2xl font-black">
            <dt>Total</dt>
            <dd>{formatCOP(cart.totals.total)}</dd>
          </div>
        </dl>
        <div class="space-y-2">
          <label class="flex min-h-11 items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={form.acceptTerms}
              onChange={(e) => set('acceptTerms', (e.target as HTMLInputElement).checked)}
              aria-invalid={err('acceptTerms') ? 'true' : undefined}
              class="mt-0.5 size-5 shrink-0 accent-luna"
            />
            <span>
              Acepto los{' '}
              <a href="/legal/terminos" target="_blank" class="font-semibold text-luna underline">
                términos y condiciones
              </a>{' '}
              y la política de{' '}
              <a href="/legal/retracto" target="_blank" class="font-semibold text-luna underline">
                retracto y garantías
              </a>
              .
            </span>
          </label>
          {err('acceptTerms') && (
            <p class="text-sm font-medium text-sol-700">{err('acceptTerms')}</p>
          )}
          <label class="flex min-h-11 items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={form.acceptDataPolicy}
              onChange={(e) => set('acceptDataPolicy', (e.target as HTMLInputElement).checked)}
              aria-invalid={err('acceptDataPolicy') ? 'true' : undefined}
              class="mt-0.5 size-5 shrink-0 accent-luna"
            />
            <span>
              Autorizo el{' '}
              <a href="/legal/privacidad" target="_blank" class="font-semibold text-luna underline">
                tratamiento de mis datos personales
              </a>{' '}
              (Ley 1581 de 2012).
            </span>
          </label>
          {err('acceptDataPolicy') && (
            <p class="text-sm font-medium text-sol-700">{err('acceptDataPolicy')}</p>
          )}
        </div>
        {turnstile.active && <div ref={turnstile.ref} />}
        <button
          type="submit"
          disabled={sending || providers.length === 0}
          class="pill-cta w-full justify-center disabled:opacity-60"
        >
          {sending ? 'Creando tu pedido…' : `Pagar ${formatCOP(cart.totals.total)}`}{' '}
          <span aria-hidden="true">→</span>
        </button>
        <p class="text-xs text-noche/70">
          Apartamos los productos por 30 minutos mientras completas el pago.
        </p>
      </aside>
    </form>
  );
}
