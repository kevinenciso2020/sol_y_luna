import { useEffect, useState } from 'preact/hooks';
import { api, formatDate } from './api';
import { Badge, Button, ConfirmDialog, Loading, Notice, PageHeader, toFieldErrors } from './ui';

interface Status {
  mode: 'demo' | 'live';
  demo: boolean;
  mercadopago: {
    configured: boolean;
    mode: 'marketplace' | 'direct';
    connected: boolean;
    connectedAt: string | null;
    expiresAt: string | null;
  };
  wompi: { configured: boolean; env: string };
}

const RESULT: Record<string, { tone: 'ok' | 'error'; text: string }> = {
  conectado: { tone: 'ok', text: 'La cuenta de Mercado Pago quedó conectada.' },
  'estado-invalido': {
    tone: 'error',
    text: 'La conexión venció o no es válida. Inténtalo de nuevo.',
  },
  'no-configurado': { tone: 'error', text: 'Mercado Pago no está configurado en el servidor.' },
};

export default function PaymentsSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(() => {
    if (typeof window === 'undefined') return null;
    return RESULT[new URLSearchParams(window.location.search).get('mp') ?? ''] ?? null;
  });
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const load = () =>
    api.get<{ data: Status }>('/api/admin/payments/status').then(
      (r) => setStatus(r.data),
      (e) => setNotice({ tone: 'error', text: toFieldErrors(e).message }),
    );
  useEffect(() => {
    void load();
  }, []);

  if (!status) return notice ? <Notice tone="error">{notice.text}</Notice> : <Loading />;

  return (
    <div class="space-y-6">
      <PageHeader
        title="Pagos"
        description="Medios de pago activos y conexión de la cuenta de Mercado Pago del comercio."
      />
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {status.demo && (
        <Notice tone="info">
          La tienda está en <strong>modo demo</strong>: el checkout usa el pago de prueba porque{' '}
          {status.mode === 'demo' ? 'PAYMENTS_MODE=demo' : 'faltan credenciales de las pasarelas'}.
        </Notice>
      )}
      <div class="grid gap-4 md:grid-cols-2">
        <section class="space-y-3 rounded-3xl bg-white p-5 ring-1 ring-luna/10 sm:p-6">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="text-2xl">Mercado Pago</h2>
            <Badge
              tone={
                status.mercadopago.connected
                  ? 'ok'
                  : status.mercadopago.configured
                    ? 'warn'
                    : 'neutral'
              }
            >
              {status.mercadopago.connected
                ? 'Activo'
                : status.mercadopago.configured
                  ? 'Falta conectar la cuenta'
                  : 'No configurado'}
            </Badge>
          </div>
          <p class="text-sm text-noche/80">
            {status.mercadopago.mode === 'marketplace'
              ? 'Modo marketplace: el comercio conecta su cuenta y la comisión de la plataforma se cobra en cada pago (marketplace_fee).'
              : 'Modo directo (pruebas): cobra con el token de la cuenta configurada en el servidor, sin dividir el pago.'}
          </p>
          {status.mercadopago.connectedAt && (
            <p class="text-sm">Conectada el {formatDate(status.mercadopago.connectedAt)}.</p>
          )}
          {status.mercadopago.configured && status.mercadopago.mode === 'marketplace' && (
            <div class="flex flex-wrap gap-2">
              <Button
                busy={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const res = await api.post<{ data: { url: string } }>(
                      '/api/admin/payments/mercadopago/connect',
                      {},
                    );
                    window.location.assign(res.data.url);
                  } catch (e) {
                    setNotice({ tone: 'error', text: toFieldErrors(e).message });
                    setBusy(false);
                  }
                }}
              >
                {status.mercadopago.connected
                  ? 'Volver a conectar'
                  : 'Conectar cuenta de Mercado Pago'}
              </Button>
              {status.mercadopago.connected && (
                <Button variant="ghost" class="text-sol-700" onClick={() => setConfirm(true)}>
                  Desconectar
                </Button>
              )}
            </div>
          )}
        </section>
        <section class="space-y-3 rounded-3xl bg-white p-5 ring-1 ring-luna/10 sm:p-6">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="text-2xl">Wompi</h2>
            <Badge tone={status.wompi.configured ? 'ok' : 'neutral'}>
              {status.wompi.configured ? 'Activo' : 'No configurado'}
            </Badge>
          </div>
          <p class="text-sm text-noche/80">
            El dinero entra a la cuenta Wompi del comercio. La comisión de la plataforma queda
            registrada en cada pedido y se cobra en la liquidación.
          </p>
          <p class="text-sm">
            Ambiente: {status.wompi.env === 'production' ? 'producción' : 'pruebas (sandbox)'}
          </p>
        </section>
      </div>
      <ConfirmDialog
        open={confirm}
        danger
        title="Desconectar Mercado Pago"
        confirmLabel="Desconectar"
        body={
          <p>El checkout dejará de ofrecer Mercado Pago hasta que vuelvas a conectar la cuenta.</p>
        }
        onClose={() => setConfirm(false)}
        onConfirm={async () => {
          await api.del('/api/admin/payments/mercadopago');
          setConfirm(false);
          setNotice({ tone: 'ok', text: 'La cuenta de Mercado Pago se desconectó.' });
          await load();
        }}
      />
    </div>
  );
}
