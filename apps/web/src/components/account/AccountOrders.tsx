import { ORDER_STATUS_LABELS, formatCOP, type OrderStatus } from '@sol-y-luna/shared';
import { useEffect, useState } from 'preact/hooks';
import { apiFetch } from '../../lib/auth-client';
import { formatDate, qs, type PageMeta } from '../admin/api';
import { StatusBadge } from '../admin/OrdersPanel';
import { FormDialog, Loading, Notice, Pagination, toFieldErrors } from '../admin/ui';
import { ReviewForm } from './ReviewForm';

interface OrderRow {
  number: string;
  status: OrderStatus;
  createdAt: string;
  total: number;
  itemCount: number;
  preview: string[];
  shipment: { carrier: string; trackingNumber: string } | null;
}

/** The customer's journey, in order. Cancelled/failed/refunded orders show their own state. */
const STEPS: OrderStatus[] = ['PAID', 'PREPARING', 'SHIPPED', 'DELIVERED'];

export function AccountOrders() {
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<OrderRow[] | null>(null);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setRows(null);
    apiFetch<{ data: OrderRow[]; meta: PageMeta }>(`/api/account/orders${qs({ page })}`)
      .then((res) => {
        setRows(res.data);
        setMeta(res.meta);
      })
      .catch((e: unknown) => {
        setRows([]);
        setError(toFieldErrors(e).message);
      });
  }, [page]);

  if (rows === null) return <Loading />;
  return (
    <div class="space-y-4">
      {error && <Notice tone="error">{error}</Notice>}
      {rows.length === 0 && !error ? (
        <div class="rounded-[2rem] border-2 border-dashed border-luna/25 p-8 text-center">
          <p>Todavía no tienes pedidos.</p>
          <a
            href="/productos"
            class="mt-4 inline-flex min-h-11 items-center rounded-full bg-luna px-6 font-semibold text-crema"
          >
            Ver productos
          </a>
        </div>
      ) : (
        <ul class="space-y-3">
          {rows.map((o) => (
            <li key={o.number}>
              <a
                href={`/cuenta/pedidos/${o.number}`}
                class="block rounded-[1.5rem] bg-white p-5 ring-1 ring-luna/10 hover:ring-2 hover:ring-luna"
              >
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <span class="font-display text-xl font-bold text-luna">{o.number}</span>
                  <StatusBadge status={o.status} />
                </div>
                <p class="mt-1 text-sm text-noche/75">{formatDate(o.createdAt)}</p>
                <p class="mt-2 text-sm break-words">
                  {o.preview.join(', ')}
                  {o.itemCount > o.preview.length && ` y ${o.itemCount - o.preview.length} más`}
                </p>
                <div class="mt-2 flex flex-wrap items-baseline justify-between gap-2">
                  <span class="text-sm">
                    {o.shipment ? `${o.shipment.carrier} · guía ${o.shipment.trackingNumber}` : ''}
                  </span>
                  <span class="font-display text-lg font-bold">{formatCOP(o.total)}</span>
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
      {meta && rows.length > 0 && (
        <Pagination
          page={meta.page}
          totalPages={meta.totalPages}
          total={meta.total}
          onPage={setPage}
        />
      )}
    </div>
  );
}

interface OrderDetailDto {
  number: string;
  status: OrderStatus;
  createdAt: string;
  paidAt: string | null;
  shipping: {
    recipientName: string;
    phone: string;
    department: string;
    municipality: string;
    addressLine: string;
    neighborhood: string | null;
  };
  discreetPackaging: boolean;
  subtotal: number;
  discount: number;
  total: number;
  couponCode: string | null;
  items: {
    productId: string | null;
    productName: string;
    productSlug: string | null;
    variantName: string;
    sku: string;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
    priceTier: string;
    reviewable: boolean;
    reviewStatus: string | null;
  }[];
  shipment: {
    carrier: string;
    trackingNumber: string;
    trackingUrl: string | null;
    shippedAt: string | null;
    deliveredAt: string | null;
  } | null;
  history: { status: OrderStatus; at: string }[];
}

function Tracker({ order }: { order: OrderDetailDto }) {
  const reached = new Map(order.history.map((h) => [h.status, h.at]));
  if (!STEPS.includes(order.status))
    return (
      <Notice tone="info">
        Estado del pedido: <strong>{ORDER_STATUS_LABELS[order.status]}</strong>.
        {order.status === 'PENDING_PAYMENT' && ' Estamos esperando la confirmación del pago.'}
        {order.status === 'PAYMENT_FAILED' && ' El pago no se aprobó.'}
      </Notice>
    );
  const current = STEPS.indexOf(order.status);
  return (
    <ol class="grid gap-3 sm:grid-cols-4" aria-label="Seguimiento del pedido">
      {STEPS.map((step, i) => {
        const done = i <= current;
        return (
          <li
            key={step}
            aria-current={i === current ? 'step' : undefined}
            class={`rounded-2xl px-4 py-3 ${done ? 'bg-luna text-crema' : 'bg-white text-noche/70 ring-1 ring-luna/10'}`}
          >
            <p class="font-semibold">{ORDER_STATUS_LABELS[step]}</p>
            <p class="text-xs">
              {reached.get(step) ? formatDate(reached.get(step)!) : done ? '' : 'Pendiente'}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

export function AccountOrderDetail({ number }: { number: string }) {
  const [order, setOrder] = useState<OrderDetailDto | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [reviewing, setReviewing] = useState<OrderDetailDto['items'][number] | null>(null);
  const [notice, setNotice] = useState('');

  const load = () =>
    apiFetch<{ data: OrderDetailDto }>(`/api/account/orders/${number}`)
      .then((res) => setOrder(res.data))
      .catch(() => setNotFound(true));
  useEffect(() => {
    void load();
  }, [number]);

  if (notFound)
    return (
      <div class="space-y-4">
        <Notice tone="error">No encontramos ese pedido en tu cuenta.</Notice>
        <a href="/cuenta/pedidos" class="font-semibold text-luna underline">
          Volver a mis pedidos
        </a>
      </div>
    );
  if (!order) return <Loading />;

  return (
    <div class="space-y-6">
      <a href="/cuenta/pedidos" class="inline-flex min-h-11 items-center font-semibold text-luna">
        ← Mis pedidos
      </a>
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h2 class="font-display text-3xl text-luna">Pedido {order.number}</h2>
        <p class="text-sm text-noche/75">Hecho el {formatDate(order.createdAt)}</p>
      </div>
      {notice && <Notice tone="ok">{notice}</Notice>}
      <Tracker order={order} />

      {order.shipment && (
        <div class="rounded-[1.5rem] bg-white p-5 ring-1 ring-luna/10">
          <h3 class="font-display text-xl text-luna">Envío</h3>
          <p class="mt-2">
            {order.shipment.carrier} · guía <strong>{order.shipment.trackingNumber}</strong>
          </p>
          {order.shipment.trackingUrl && (
            <a
              href={order.shipment.trackingUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="mt-3 inline-flex min-h-11 items-center rounded-full bg-luna px-5 font-semibold text-crema"
            >
              Seguir mi envío
            </a>
          )}
        </div>
      )}

      <div class="grid gap-6 md:grid-cols-[1.4fr_1fr]">
        <section class="rounded-[1.5rem] bg-white p-5 ring-1 ring-luna/10">
          <h3 class="font-display text-xl text-luna">Productos</h3>
          <ul class="mt-2 divide-y divide-luna/10">
            {order.items.map((i) => (
              <li key={i.sku} class="py-3">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    {i.productSlug ? (
                      <a
                        href={`/productos/${i.productSlug}`}
                        class="font-semibold text-luna underline-offset-4 hover:underline"
                      >
                        {i.productName}
                      </a>
                    ) : (
                      <p class="font-semibold">{i.productName}</p>
                    )}
                    <p class="text-sm text-noche/75">
                      {i.variantName} · {i.quantity} × {formatCOP(i.unitPrice)}
                      {i.priceTier === 'WHOLESALE' && ' (mayorista)'}
                    </p>
                  </div>
                  <span class="shrink-0">{formatCOP(i.lineTotal)}</span>
                </div>
                {i.reviewable && i.productId && !i.reviewStatus && (
                  <button
                    type="button"
                    onClick={() => setReviewing(i)}
                    class="mt-2 inline-flex min-h-11 items-center rounded-full border-2 border-luna px-4 text-sm font-semibold text-luna hover:bg-luna-50"
                  >
                    Escribir una reseña
                  </button>
                )}
                {i.reviewStatus && (
                  <a
                    href="/cuenta/resenas"
                    class="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-luna underline underline-offset-4"
                  >
                    Ver mi reseña
                  </a>
                )}
              </li>
            ))}
          </ul>
          <dl class="mt-2 space-y-1 border-t border-luna/10 pt-3 text-sm">
            <div class="flex justify-between">
              <dt>Subtotal</dt>
              <dd>{formatCOP(order.subtotal)}</dd>
            </div>
            {order.discount > 0 && (
              <div class="flex justify-between">
                <dt>Descuento{order.couponCode && ` (${order.couponCode})`}</dt>
                <dd>−{formatCOP(order.discount)}</dd>
              </div>
            )}
            <div class="flex justify-between">
              <dt>Envío</dt>
              <dd>Gratis</dd>
            </div>
            <div class="flex justify-between font-display text-lg font-bold">
              <dt>Total</dt>
              <dd>{formatCOP(order.total)}</dd>
            </div>
          </dl>
        </section>
        <section class="rounded-[1.5rem] bg-white p-5 ring-1 ring-luna/10">
          <h3 class="font-display text-xl text-luna">Entrega</h3>
          <address class="mt-2 break-words not-italic">
            {order.shipping.recipientName}
            <br />
            {order.shipping.addressLine}
            {order.shipping.neighborhood && `, ${order.shipping.neighborhood}`}
            <br />
            {order.shipping.municipality}, {order.shipping.department}
            <br />
            Tel. {order.shipping.phone}
          </address>
          {order.discreetPackaging && <p class="mt-3 text-sm">Con empaque discreto.</p>}
        </section>
      </div>

      <FormDialog open={reviewing !== null} title="Tu reseña" onClose={() => setReviewing(null)}>
        {reviewing?.productId && (
          <ReviewForm
            key={reviewing.productId}
            productId={reviewing.productId}
            productName={reviewing.productName}
            onSaved={() => {
              setReviewing(null);
              setNotice('Gracias. Publicaremos tu reseña cuando la revisemos.');
              void load();
            }}
          />
        )}
      </FormDialog>
    </div>
  );
}

export default AccountOrders;
