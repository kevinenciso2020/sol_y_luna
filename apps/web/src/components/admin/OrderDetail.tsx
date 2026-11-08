import { CARRIERS, ORDER_STATUS_LABELS, formatCOP, type OrderStatus } from '@sol-y-luna/shared';
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { api, formatDate } from './api';
import { StatusBadge, panelPaths, type PanelScope } from './OrdersPanel';
import {
  Button,
  ConfirmDialog,
  Loading,
  Notice,
  Select,
  TextInput,
  Toggle,
  toFieldErrors,
  type FieldErrors,
} from './ui';

interface OrderDetailDto {
  number: string;
  status: OrderStatus;
  createdAt: string;
  paidAt: string | null;
  email: string;
  customerName: string;
  phone: string;
  shipping: {
    recipientName: string;
    phone: string;
    department: string;
    municipality: string;
    addressLine: string;
    neighborhood: string | null;
    instructions: string | null;
  };
  discreetPackaging: boolean;
  subtotal: number;
  discount: number;
  total: number;
  couponCode: string | null;
  paymentProvider: string | null;
  needsReview: boolean;
  reviewReason: string | null;
  notes: string | null;
  refundedAmount: number;
  items: {
    productName: string;
    variantName: string;
    sku: string;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
    priceTier: string;
  }[];
  shipment: {
    carrier: string;
    trackingNumber: string;
    trackingUrl: string | null;
    shippedAt: string | null;
    deliveredAt: string | null;
  } | null;
  history: { status: OrderStatus; at: string; note: string | null; by: string | null }[];
  // Admin only
  commission?: {
    rateBps: number | null;
    amount: number;
    refunded: number;
    current: number;
    gatewayFee: number | null;
    merchantNet: number;
  };
  refunds?: {
    id: string;
    amount: number;
    commissionReversed: number;
    restocked: boolean;
    reason: string;
    by: string | null;
    createdAt: string;
  }[];
}

const PROVIDER_LABELS: Record<string, string> = {
  MOCK: 'Pago de prueba',
  WOMPI: 'Wompi',
  MERCADOPAGO: 'Mercado Pago',
};

function Section(props: { title: string; children: ComponentChildren; class?: string }) {
  return (
    <section class={`rounded-3xl bg-white p-5 ring-1 ring-luna/10 ${props.class ?? ''}`}>
      <h2 class="font-display text-xl text-luna">{props.title}</h2>
      <div class="mt-3">{props.children}</div>
    </section>
  );
}

/** The dispatch label: what the operator copies onto the package. */
function ShippingLabel({ order }: { order: OrderDetailDto }) {
  const s = order.shipping;
  return (
    <section
      aria-label="Rótulo de despacho"
      class="relative overflow-hidden rounded-3xl border-2 border-dashed border-luna bg-crema-50 p-5 sm:p-6"
    >
      <span
        aria-hidden="true"
        class="absolute -top-10 -right-10 size-32 rounded-full bg-sol/15 ring-8 ring-luna/10"
      />
      <p class="text-sm font-semibold text-luna">Enviar a</p>
      <p class="mt-1 font-display text-2xl font-bold break-words text-noche sm:text-3xl">
        {s.recipientName}
      </p>
      <address class="mt-2 text-lg leading-snug break-words not-italic">
        {s.addressLine}
        {s.neighborhood && (
          <>
            <br />
            Barrio {s.neighborhood}
          </>
        )}
        <br />
        <strong>
          {s.municipality}, {s.department}
        </strong>
        <br />
        Tel. <a href={`tel:${s.phone}`}>{s.phone}</a>
      </address>
      {s.instructions && (
        <p class="mt-3 rounded-2xl bg-white px-4 py-2 text-sm break-words">
          <span class="font-semibold">Indicaciones:</span> {s.instructions}
        </p>
      )}
      {order.discreetPackaging && (
        <p class="mt-4 rounded-2xl bg-sol-700 px-4 py-3 font-semibold text-white">
          Empaque discreto: caja sin logos ni nombres de producto por fuera.
        </p>
      )}
    </section>
  );
}

function ShipmentForm(props: {
  initial: OrderDetailDto['shipment'];
  dispatching: boolean;
  onSave: (input: {
    carrier: string;
    trackingNumber: string;
    trackingUrl: string;
  }) => Promise<void>;
}) {
  const initialCarrier = props.initial?.carrier ?? CARRIERS[0];
  const known = (CARRIERS as readonly string[]).includes(initialCarrier);
  const [carrier, setCarrier] = useState(known ? initialCarrier : 'OTRA');
  const [other, setOther] = useState(known ? '' : initialCarrier);
  const [tracking, setTracking] = useState(props.initial?.trackingNumber ?? '');
  const [url, setUrl] = useState(props.initial?.trackingUrl ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      class="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await props.onSave({
            carrier: carrier === 'OTRA' ? other : carrier,
            trackingNumber: tracking,
            trackingUrl: url,
          });
          setErrors({});
          setMessage('');
        } catch (error) {
          const parsed = toFieldErrors(error);
          setErrors(parsed.fields);
          setMessage(parsed.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {message && <Notice tone="error">{message}</Notice>}
      <div class="grid gap-4 sm:grid-cols-2">
        <Select
          id="carrier"
          label="Transportadora"
          value={carrier}
          onChange={setCarrier}
          options={[
            ...CARRIERS.map((c) => ({ value: c, label: c })),
            { value: 'OTRA', label: 'Otra' },
          ]}
          error={carrier === 'OTRA' ? undefined : errors['carrier']}
        />
        {carrier === 'OTRA' && (
          <TextInput
            id="carrier-other"
            label="¿Cuál transportadora?"
            value={other}
            onInput={setOther}
            error={errors['carrier']}
          />
        )}
        <TextInput
          id="tracking"
          label="Número de guía"
          value={tracking}
          onInput={setTracking}
          error={errors['trackingNumber']}
          inputMode="text"
        />
        <TextInput
          id="tracking-url"
          label="Enlace de seguimiento (opcional)"
          type="url"
          value={url}
          onInput={setUrl}
          error={errors['trackingUrl']}
          placeholder="https://"
          class="sm:col-span-2"
        />
      </div>
      <Button type="submit" busy={busy}>
        {props.dispatching ? 'Despachar y avisar al cliente' : 'Guardar guía'}
      </Button>
    </form>
  );
}

function RefundForm(props: {
  remaining: number;
  onSave: (input: { amount: number; reason: string; restock: boolean }) => Promise<void>;
}) {
  const [amount, setAmount] = useState(String(props.remaining));
  const [reason, setReason] = useState('');
  const [restock, setRestock] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState(false);
  const value = Number(amount.replace(/\D/g, '')) || 0;
  const full = value === props.remaining;
  return (
    <form
      class="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setConfirming(true);
      }}
    >
      <p class="text-sm text-noche/80">
        Primero devuelve el dinero desde el panel de la pasarela. Aquí lo registras: la comisión se
        reversa en proporción y el reembolso entra en la liquidación.
      </p>
      {message && <Notice tone="error">{message}</Notice>}
      <div class="grid gap-4 sm:grid-cols-2">
        <TextInput
          id="refund-amount"
          label="Monto a reembolsar"
          value={amount}
          onInput={setAmount}
          inputMode="numeric"
          hint={`Máximo ${formatCOP(props.remaining)}`}
          error={errors['amount']}
        />
        <TextInput
          id="refund-reason"
          label="Motivo"
          value={reason}
          onInput={setReason}
          error={errors['reason']}
        />
      </div>
      {full && (
        <Toggle
          id="refund-restock"
          label="Devolver los productos al inventario"
          hint="Úsalo si el pedido no salió o si la mercancía regresó en buen estado."
          checked={restock}
          onChange={setRestock}
        />
      )}
      <Button type="submit" variant="danger" disabled={value <= 0}>
        Registrar reembolso
      </Button>
      <ConfirmDialog
        open={confirming}
        title={full ? 'Reembolso total' : 'Reembolso parcial'}
        body={
          <p>
            Vas a registrar un reembolso de <strong>{formatCOP(value)}</strong>.
            {full && ' El pedido quedará como reembolsado.'}
          </p>
        }
        confirmLabel="Registrar reembolso"
        danger
        onClose={() => setConfirming(false)}
        onConfirm={async () => {
          try {
            await props.onSave({ amount: value, reason, restock: full && restock });
            setConfirming(false);
          } catch (error) {
            const parsed = toFieldErrors(error);
            setErrors(parsed.fields);
            setMessage(parsed.message);
            setConfirming(false);
          }
        }}
      />
    </form>
  );
}

export function OrderDetail({ scope, number }: { scope: PanelScope; number: string }) {
  const paths = panelPaths(scope);
  const base = `${paths.api}/orders/${number}`;
  const [order, setOrder] = useState<OrderDetailDto | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [confirm, setConfirm] = useState<{ status: OrderStatus; label: string } | null>(null);

  useEffect(() => {
    api
      .get<{ data: OrderDetailDto }>(base)
      .then((res) => setOrder(res.data))
      .catch(() => setNotFound(true));
  }, [base]);

  if (notFound)
    return (
      <div class="space-y-4">
        <Notice tone="error">No encontramos ese pedido.</Notice>
        <a href={paths.orders} class="font-semibold text-luna underline">
          Volver a los pedidos
        </a>
      </div>
    );
  if (!order) return <Loading />;

  async function changeStatus(status: OrderStatus) {
    try {
      const res = await api.post<{ data: OrderDetailDto }>(`${base}/status`, { status });
      setOrder(res.data);
      setNotice({ tone: 'ok', text: `Pedido marcado como "${ORDER_STATUS_LABELS[status]}".` });
    } catch (error) {
      setNotice({ tone: 'error', text: toFieldErrors(error).message });
    }
    setConfirm(null);
  }

  const next: { status: OrderStatus; label: string } | null =
    order.status === 'PAID'
      ? { status: 'PREPARING', label: 'Empezar a preparar' }
      : order.status === 'SHIPPED'
        ? { status: 'DELIVERED', label: 'Marcar como entregado' }
        : null;
  const canShip = ['PREPARING', 'SHIPPED', 'DELIVERED'].includes(order.status);
  const remaining = order.total - order.refundedAmount;
  const refundable =
    scope === 'admin' &&
    ['PAID', 'PREPARING', 'SHIPPED', 'DELIVERED'].includes(order.status) &&
    remaining > 0;
  const cancellable =
    scope === 'admin' && ['PENDING_PAYMENT', 'PAYMENT_FAILED'].includes(order.status);

  return (
    <div class="space-y-6">
      <a href={paths.orders} class="inline-flex min-h-11 items-center font-semibold text-luna">
        ← Pedidos
      </a>
      <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 class="text-3xl sm:text-4xl">Pedido {order.number}</h1>
          <p class="mt-1 text-noche/80">
            {order.paidAt
              ? `Pagado el ${formatDate(order.paidAt)}`
              : `Creado el ${formatDate(order.createdAt)}`}
            {order.paymentProvider &&
              ` con ${PROVIDER_LABELS[order.paymentProvider] ?? order.paymentProvider}`}
          </p>
        </div>
        <StatusBadge status={order.status} />
      </div>

      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {order.needsReview && (
        <Notice tone="error">
          Este pedido requiere revisión: {order.reviewReason ?? 'el pago no cuadró'}.
        </Notice>
      )}

      <div class="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div class="space-y-6">
          <ShippingLabel order={order} />

          {(next || canShip || cancellable) && (
            <Section title="Despacho">
              <div class="space-y-5">
                {next && (
                  <Button onClick={() => setConfirm(next)} class="w-full sm:w-auto">
                    {next.label}
                  </Button>
                )}
                {canShip && (
                  <ShipmentForm
                    initial={order.shipment}
                    dispatching={order.status === 'PREPARING'}
                    onSave={async (input) => {
                      const res = await api.put<{ data: OrderDetailDto }>(
                        `${base}/shipment`,
                        input,
                      );
                      setOrder(res.data);
                      setNotice({
                        tone: 'ok',
                        text:
                          order.status === 'PREPARING'
                            ? 'Pedido despachado. Le enviamos la guía al cliente.'
                            : 'Guía actualizada.',
                      });
                    }}
                  />
                )}
                {cancellable && (
                  <Button
                    variant="danger"
                    onClick={() => setConfirm({ status: 'CANCELLED', label: 'Cancelar pedido' })}
                  >
                    Cancelar pedido
                  </Button>
                )}
              </div>
            </Section>
          )}

          <Section title="Productos">
            <ul class="divide-y divide-luna/10">
              {order.items.map((i) => (
                <li key={i.sku} class="flex items-start justify-between gap-4 py-3">
                  <div class="min-w-0">
                    <p class="font-semibold break-words">{i.productName}</p>
                    <p class="text-sm text-noche/80">
                      {i.variantName} · SKU {i.sku}
                      {i.priceTier === 'WHOLESALE' && ' · mayorista'}
                    </p>
                  </div>
                  <p class="shrink-0 text-right">
                    <span class="font-display text-2xl font-bold text-luna">×{i.quantity}</span>
                    <span class="block text-sm">{formatCOP(i.lineTotal)}</span>
                  </p>
                </li>
              ))}
            </ul>
            <dl class="mt-3 space-y-1 border-t border-luna/10 pt-3 text-sm">
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
              {order.refundedAmount > 0 && (
                <div class="flex justify-between font-semibold text-sol-700">
                  <dt>Reembolsado</dt>
                  <dd>−{formatCOP(order.refundedAmount)}</dd>
                </div>
              )}
            </dl>
          </Section>
        </div>

        <div class="space-y-6">
          <Section title="Cliente">
            <p class="font-semibold break-words">{order.customerName}</p>
            <p class="text-sm break-words">
              <a href={`mailto:${order.email}`} class="text-luna underline">
                {order.email}
              </a>
              <br />
              <a href={`tel:${order.phone}`} class="text-luna underline">
                {order.phone}
              </a>
            </p>
            {order.notes && <p class="mt-3 text-sm break-words">Nota del cliente: {order.notes}</p>}
          </Section>

          {order.commission && (
            <Section title="Comisión de la plataforma">
              <dl class="space-y-1 text-sm">
                <div class="flex justify-between">
                  <dt>Tasa aplicada</dt>
                  <dd>
                    {order.commission.rateBps !== null
                      ? `${(order.commission.rateBps / 100).toLocaleString('es-CO')}%`
                      : '—'}
                  </dd>
                </div>
                <div class="flex justify-between">
                  <dt>Comisión al pagar</dt>
                  <dd>{formatCOP(order.commission.amount)}</dd>
                </div>
                {order.commission.refunded > 0 && (
                  <div class="flex justify-between">
                    <dt>Reversada por reembolsos</dt>
                    <dd>−{formatCOP(order.commission.refunded)}</dd>
                  </div>
                )}
                <div class="flex justify-between">
                  <dt>Comisión de la pasarela</dt>
                  <dd>{formatCOP(order.commission.gatewayFee ?? 0)}</dd>
                </div>
                <div class="flex justify-between border-t border-luna/10 pt-1 font-semibold">
                  <dt>Neto para la tienda</dt>
                  <dd>{formatCOP(order.commission.merchantNet)}</dd>
                </div>
              </dl>
            </Section>
          )}

          {scope === 'admin' && (refundable || (order.refunds?.length ?? 0) > 0) && (
            <Section title="Reembolsos">
              {order.refunds && order.refunds.length > 0 && (
                <ul class="mb-4 space-y-2 text-sm">
                  {order.refunds.map((r) => (
                    <li key={r.id} class="rounded-2xl bg-crema-100 px-4 py-2">
                      <strong>{formatCOP(r.amount)}</strong> · {formatDate(r.createdAt)}
                      <br />
                      {r.reason}
                      {r.restocked && ' · devuelto al inventario'}
                    </li>
                  ))}
                </ul>
              )}
              {refundable && (
                <RefundForm
                  key={remaining}
                  remaining={remaining}
                  onSave={async (input) => {
                    const res = await api.post<{ data: OrderDetailDto }>(`${base}/refunds`, input);
                    setOrder(res.data);
                    setNotice({ tone: 'ok', text: 'Reembolso registrado.' });
                  }}
                />
              )}
            </Section>
          )}

          <Section title="Historial">
            <ol class="space-y-3 border-l-2 border-luna/20 pl-4">
              {order.history.map((h, i) => (
                <li key={i} class="relative">
                  <span
                    aria-hidden="true"
                    class="absolute top-1.5 -left-[1.4rem] size-3 rounded-full bg-luna ring-4 ring-white"
                  />
                  <p class="font-semibold">{ORDER_STATUS_LABELS[h.status]}</p>
                  <p class="text-xs text-noche/70">
                    {formatDate(h.at)}
                    {h.by && ` · ${h.by}`}
                  </p>
                  {h.note && <p class="text-sm break-words">{h.note}</p>}
                </li>
              ))}
            </ol>
          </Section>
        </div>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.label ?? ''}
        body={
          <p>
            El pedido {order.number} pasará a{' '}
            <strong>{confirm ? ORDER_STATUS_LABELS[confirm.status] : ''}</strong>.
            {confirm?.status === 'CANCELLED' && ' Se liberan los productos apartados.'}
          </p>
        }
        confirmLabel={confirm?.label ?? 'Confirmar'}
        danger={confirm?.status === 'CANCELLED'}
        onClose={() => setConfirm(null)}
        onConfirm={() => (confirm ? changeStatus(confirm.status) : undefined)}
      />
    </div>
  );
}

export default OrderDetail;
