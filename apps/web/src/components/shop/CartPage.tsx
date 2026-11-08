import { formatCOP } from '@sol-y-luna/shared';
import { useEffect, useState } from 'preact/hooks';
import { ApiError } from '../../lib/auth-client';
import { cartApi, setCartCount, type Cart, type CartLine } from '../../lib/cart-client';
import { productImage } from '../../lib/store-images';

const COUPON_KEY = 'syl_cupon';

function Summary({
  cart,
  coupon,
  onCoupon,
  busy,
}: {
  cart: Cart;
  coupon: string;
  onCoupon: (code: string) => void;
  busy: boolean;
}) {
  const [code, setCode] = useState(coupon);
  return (
    <aside
      class="rounded-[1.75rem] bg-white p-5 ring-1 ring-luna/10 sm:p-6 lg:sticky lg:top-6"
      aria-labelledby="resumen"
    >
      <h2 id="resumen" class="text-2xl">
        Resumen
      </h2>
      <form
        class="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onCoupon(code.trim().toUpperCase());
        }}
      >
        <label for="cupon" class="sr-only">
          Cupón de descuento
        </label>
        <input
          id="cupon"
          value={code}
          onInput={(e) => setCode((e.target as HTMLInputElement).value)}
          placeholder="Cupón de descuento"
          autocomplete="off"
          class="min-h-11 min-w-0 flex-1 rounded-full border-2 border-luna/20 px-4 uppercase outline-none focus:border-luna"
        />
        <button
          type="submit"
          disabled={busy}
          class="min-h-11 rounded-full border-2 border-luna px-4 font-semibold text-luna hover:bg-luna-50"
        >
          Aplicar
        </button>
      </form>
      {cart.coupon && (
        <p
          role="status"
          class={`mt-2 text-sm font-medium ${cart.coupon.ok ? 'text-luna' : 'text-sol-700'}`}
        >
          {cart.coupon.ok ? `Cupón ${cart.coupon.code} aplicado.` : cart.coupon.message}
        </p>
      )}
      <dl class="mt-5 space-y-2 text-base">
        <div class="flex justify-between gap-4">
          <dt>Subtotal</dt>
          <dd>{formatCOP(cart.totals.subtotal)}</dd>
        </div>
        {cart.totals.discount > 0 && (
          <div class="flex justify-between gap-4 text-luna">
            <dt>Descuento</dt>
            <dd>−{formatCOP(cart.totals.discount)}</dd>
          </div>
        )}
        <div class="flex justify-between gap-4">
          <dt>Envío</dt>
          <dd class="font-semibold text-luna">Gratis</dd>
        </div>
        <div class="flex justify-between gap-4 border-t border-luna/15 pt-3 font-display text-2xl font-black">
          <dt>Total</dt>
          <dd>{formatCOP(cart.totals.total)}</dd>
        </div>
      </dl>
      <a
        href={`/checkout${cart.coupon?.ok ? `?cupon=${encodeURIComponent(cart.coupon.code)}` : ''}`}
        aria-disabled={!cart.canCheckout}
        class={`pill-cta mt-6 w-full justify-center ${cart.canCheckout ? '' : 'pointer-events-none opacity-50'}`}
      >
        Continuar al pago <span aria-hidden="true">→</span>
      </a>
      {!cart.canCheckout && (
        <p class="mt-2 text-sm text-sol-700">Corrige los productos marcados para continuar.</p>
      )}
      <p class="mt-4 text-xs text-noche/70">
        Apartamos los productos por 30 minutos cuando confirmas el pedido.
      </p>
    </aside>
  );
}

function Line({
  line,
  onQty,
  onRemove,
  busy,
}: {
  line: CartLine;
  onQty: (q: number) => void;
  onRemove: () => void;
  busy: boolean;
}) {
  const img = productImage(line.image?.publicId, 200);
  return (
    <li class="flex gap-3 rounded-[1.5rem] bg-white p-3 ring-1 ring-luna/10 sm:gap-4 sm:p-4">
      <a
        href={`/productos/${line.productSlug}`}
        class="relative size-20 shrink-0 overflow-hidden rounded-2xl bg-sol-100 sm:size-24"
      >
        <img
          src={img.src}
          alt=""
          width={96}
          height={96}
          class="size-full object-contain p-2"
          loading="lazy"
        />
      </a>
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-start justify-between gap-x-3">
          <div class="min-w-0">
            <a
              href={`/productos/${line.productSlug}`}
              class="font-display text-lg leading-tight font-bold text-luna hover:underline"
            >
              {line.productName}
            </a>
            <p class="text-sm text-noche/75">
              {line.variantName}
              {line.priceTier === 'WHOLESALE' && (
                <span class="ml-2 rounded-full bg-luna-100 px-2 py-0.5 text-xs font-bold text-luna-800">
                  Precio mayorista
                </span>
              )}
            </p>
          </div>
          <p class="font-display text-lg font-black">{formatCOP(line.lineTotal)}</p>
        </div>
        <div class="mt-2 flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center rounded-full border-2 border-luna/20">
            <button
              type="button"
              disabled={busy || line.quantity <= 1}
              onClick={() => onQty(line.quantity - 1)}
              class="grid size-11 place-items-center text-xl font-bold text-luna disabled:opacity-40"
              aria-label={`Quitar una unidad de ${line.productName}`}
            >
              −
            </button>
            <span class="w-8 text-center font-semibold" aria-live="polite">
              <span class="sr-only">Cantidad: </span>
              {line.quantity}
            </span>
            <button
              type="button"
              disabled={busy || line.quantity >= line.available}
              onClick={() => onQty(line.quantity + 1)}
              class="grid size-11 place-items-center text-xl font-bold text-luna disabled:opacity-40"
              aria-label={`Agregar una unidad de ${line.productName}`}
            >
              +
            </button>
          </div>
          <span class="text-sm text-noche/70">{formatCOP(line.unitPrice)} c/u</span>
          <button
            type="button"
            disabled={busy}
            onClick={onRemove}
            class="min-h-11 rounded-full px-3 text-sm font-semibold text-sol-700 hover:bg-sol-50"
          >
            Quitar
          </button>
        </div>
        {line.issue === 'UNAVAILABLE' && (
          <p class="mt-2 text-sm font-medium text-sol-700">
            Este producto ya no está disponible. Quítalo para continuar.
          </p>
        )}
        {line.issue === 'NOT_ENOUGH_STOCK' && (
          <p class="mt-2 text-sm font-medium text-sol-700">
            {line.available === 0
              ? 'Se agotó. Quítalo para continuar.'
              : `Solo quedan ${line.available} unidades. Ajusta la cantidad.`}
          </p>
        )}
      </div>
    </li>
  );
}

export default function CartPage() {
  const [cart, setCart] = useState<Cart | null>(null);
  const [coupon, setCoupon] = useState(() =>
    typeof sessionStorage === 'undefined' ? '' : (sessionStorage.getItem(COUPON_KEY) ?? ''),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const apply = (next: Cart) => {
    setCart(next);
    setCartCount(next.itemCount);
    sessionStorage.setItem('syl_cart_n', String(next.itemCount));
  };

  useEffect(() => {
    cartApi
      .get(coupon || undefined)
      .then(apply, () => setError('No pudimos cargar tu carrito. Recarga la página.'));
  }, [coupon]);

  async function run(action: () => Promise<Cart>) {
    setBusy(true);
    setError('');
    try {
      await action();
      apply(await cartApi.get(coupon || undefined));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No pudimos actualizar el carrito.');
    } finally {
      setBusy(false);
    }
  }

  if (!cart)
    return (
      <p class="py-16 text-center text-noche/70" role="status">
        {error || 'Cargando tu carrito…'}
      </p>
    );

  if (cart.lines.length === 0) {
    return (
      <div class="rounded-[2rem] border-2 border-dashed border-luna/25 p-10 text-center">
        <p class="font-display text-3xl font-bold text-luna">Tu carrito está vacío</p>
        <p class="mt-2">Encuentra suplementos, skincare y más con envío gratis.</p>
        <a href="/productos" class="pill-cta mt-6">
          Ver productos <span aria-hidden="true">→</span>
        </a>
      </div>
    );
  }

  return (
    <div class="grid gap-6 lg:grid-cols-[1fr_22rem] lg:items-start">
      <div>
        {error && (
          <p
            role="alert"
            class="mb-4 rounded-2xl bg-sol-50 px-4 py-3 text-sm font-medium text-sol-800"
          >
            {error}
          </p>
        )}
        <ul class="space-y-3">
          {cart.lines.map((line) => (
            <Line
              key={line.variantId}
              line={line}
              busy={busy}
              onQty={(q) => run(() => cartApi.setQuantity(line.variantId, q))}
              onRemove={() => run(() => cartApi.remove(line.variantId))}
            />
          ))}
        </ul>
      </div>
      <Summary
        cart={cart}
        coupon={coupon}
        busy={busy}
        onCoupon={(code) => {
          sessionStorage.setItem(COUPON_KEY, code);
          setCoupon(code);
        }}
      />
    </div>
  );
}
