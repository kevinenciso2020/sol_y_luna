import { formatCOP } from '@sol-y-luna/shared';
import { useEffect, useState } from 'preact/hooks';
import { api } from './api';
import { Loading, Notice, toFieldErrors } from './ui';

interface DashboardData {
  days: number;
  sales: number;
  orders: number;
  averageTicket: number;
  commission: number;
  topProducts: { productId: string | null; name: string; quantity: number; revenue: number }[];
  lowStock: { id: string; productName: string; name: string; sku: string; available: number }[];
  lowStockThreshold: number;
  toDispatch: number;
  needsReview: number;
}

const RANGES = [
  { days: 7, label: '7 días' },
  { days: 30, label: '30 días' },
  { days: 90, label: '90 días' },
];

export function Dashboard() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null);
    api
      .get<{ data: DashboardData }>(`/api/admin/dashboard?days=${days}`)
      .then((res) => {
        setData(res.data);
        setError('');
      })
      .catch((e: unknown) => setError(toFieldErrors(e).message));
  }, [days]);

  return (
    <section aria-labelledby="dashboard-title" class="space-y-5">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 id="dashboard-title" class="font-display text-2xl text-luna">
          Ventas de los últimos {days} días
        </h2>
        <div
          role="group"
          aria-label="Periodo"
          class="flex gap-1 rounded-full bg-white p-1 ring-1 ring-luna/10"
        >
          {RANGES.map((r) => (
            <button
              key={r.days}
              type="button"
              aria-pressed={days === r.days}
              onClick={() => setDays(r.days)}
              class="min-h-11 flex-1 rounded-full px-4 text-sm font-semibold text-luna aria-pressed:bg-luna aria-pressed:text-crema sm:flex-none"
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {!data && !error && <Loading />}
      {data && (
        <>
          {(data.toDispatch > 0 || data.needsReview > 0) && (
            <div class="flex flex-wrap gap-3">
              {data.toDispatch > 0 && (
                <a
                  href="/admin/pedidos?estado=TO_DISPATCH"
                  class="inline-flex min-h-11 items-center rounded-full bg-sol-700 px-5 font-semibold text-white"
                >
                  {data.toDispatch} {data.toDispatch === 1 ? 'pedido' : 'pedidos'} por despachar
                </a>
              )}
              {data.needsReview > 0 && (
                <a
                  href="/admin/pedidos?revision=1"
                  class="inline-flex min-h-11 items-center rounded-full border-2 border-sol-700 px-5 font-semibold text-sol-800"
                >
                  {data.needsReview} {data.needsReview === 1 ? 'requiere' : 'requieren'} revisión
                </a>
              )}
            </div>
          )}

          <div class="grid gap-4 md:grid-cols-[1.4fr_1fr]">
            <div class="relative overflow-hidden rounded-3xl bg-luna p-6 pb-24 text-crema sm:pb-6">
              <span
                aria-hidden="true"
                class="absolute -right-12 -bottom-16 size-48 rounded-full bg-sol ring-[14px] ring-luna-400/40"
              />
              <p class="relative font-semibold text-crema/85">Ventas netas</p>
              <p class="relative mt-1 font-display text-4xl font-bold break-words sm:text-5xl">
                {formatCOP(data.sales)}
              </p>
              <p class="relative mt-3 max-w-[28ch] text-sm text-crema/85">
                Pedidos pagados del periodo, ya descontados los reembolsos.
              </p>
            </div>
            <dl class="grid grid-cols-1 gap-3 sm:grid-cols-3 md:grid-cols-1">
              {[
                ['Pedidos', String(data.orders)],
                ['Ticket promedio', formatCOP(data.averageTicket)],
                ['Comisión de la plataforma', formatCOP(data.commission)],
              ].map(([label, value]) => (
                <div key={label} class="rounded-3xl bg-white px-5 py-4 ring-1 ring-luna/10">
                  <dt class="text-sm font-semibold text-noche/80">{label}</dt>
                  <dd class="font-display text-2xl font-bold whitespace-nowrap text-luna tabular-nums">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div class="grid gap-4 lg:grid-cols-2">
            <section class="rounded-3xl bg-white p-5 ring-1 ring-luna/10">
              <h3 class="font-display text-xl text-luna">Más vendidos</h3>
              {data.topProducts.length === 0 ? (
                <p class="mt-2 text-sm text-noche/80">Aún no hay ventas en este periodo.</p>
              ) : (
                <ol class="mt-3 space-y-2">
                  {data.topProducts.map((p) => (
                    <li
                      key={p.productId ?? p.name}
                      class="flex items-baseline justify-between gap-4"
                    >
                      <span class="min-w-0 break-words">{p.name}</span>
                      <span class="shrink-0 text-right text-sm tabular-nums">
                        <strong>{p.quantity} u.</strong> · {formatCOP(p.revenue)}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
            <section class="rounded-3xl bg-white p-5 ring-1 ring-luna/10">
              <h3 class="font-display text-xl text-luna">Stock bajo</h3>
              {data.lowStock.length === 0 ? (
                <p class="mt-2 text-sm text-noche/80">
                  Todas las presentaciones tienen más de {data.lowStockThreshold} unidades
                  disponibles.
                </p>
              ) : (
                <>
                  <ul class="mt-3 space-y-2">
                    {data.lowStock.map((v) => (
                      <li key={v.id} class="flex items-baseline justify-between gap-4">
                        <span class="min-w-0 break-words">
                          {v.productName}
                          <span class="block text-xs text-noche/70">{v.name}</span>
                        </span>
                        <strong class="shrink-0 text-sol-700 tabular-nums">{v.available}</strong>
                      </li>
                    ))}
                  </ul>
                  <a
                    href="/admin/inventario"
                    class="mt-3 inline-flex min-h-11 items-center font-semibold text-luna underline underline-offset-4"
                  >
                    Ajustar inventario
                  </a>
                </>
              )}
            </section>
          </div>
        </>
      )}
    </section>
  );
}

export default Dashboard;
