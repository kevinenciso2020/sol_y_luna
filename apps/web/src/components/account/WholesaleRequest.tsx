import type { WholesaleStatus } from '@sol-y-luna/shared';
import { useEffect, useState } from 'preact/hooks';
import { apiFetch } from '../../lib/auth-client';
import {
  Button,
  Loading,
  Notice,
  TextArea,
  TextInput,
  toFieldErrors,
  type FieldErrors,
} from '../admin/ui';

interface Profile {
  wholesaleStatus: WholesaleStatus;
  wholesaleBusinessName: string | null;
}

const STATE_TEXT: Record<WholesaleStatus, { title: string; body: string } | null> = {
  NONE: null,
  PENDING: {
    title: 'Tu solicitud está en revisión',
    body: 'Te escribimos al correo cuando tengamos una respuesta.',
  },
  APPROVED: {
    title: 'Tu cuenta mayorista está activa',
    body: 'En cada ficha ves el precio mayorista y desde cuántas unidades aplica. El carrito lo usa solo cuando llegas a esa cantidad de la misma presentación.',
  },
  REJECTED: {
    title: 'No pudimos aprobar tu solicitud',
    body: 'Si cambió algo de tu negocio, puedes enviarla de nuevo.',
  },
};

export default function WholesaleRequest() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [businessName, setBusinessName] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<{ data: Profile }>('/api/account/profile')
      .then(({ data }) => {
        setProfile(data);
        setBusinessName(data.wholesaleBusinessName ?? '');
      })
      .catch((e: unknown) => setMessage(toFieldErrors(e).message));
  }, []);

  if (!profile) return message ? <Notice tone="error">{message}</Notice> : <Loading />;
  const state = STATE_TEXT[profile.wholesaleStatus];
  const canRequest = profile.wholesaleStatus === 'NONE' || profile.wholesaleStatus === 'REJECTED';

  return (
    <div class="grid gap-6 md:grid-cols-[1fr_1.2fr]">
      <div class="relative overflow-hidden rounded-[2rem] bg-luna p-6 pb-28 text-crema md:pb-32">
        <span
          aria-hidden="true"
          class="absolute -right-8 -bottom-16 size-36 rounded-full bg-sol ring-[12px] ring-luna-400/40"
        />
        <h2 class="relative font-display text-3xl text-crema">Compra al por mayor</h2>
        <p class="relative mt-3 max-w-[36ch] text-crema/90">
          Para droguerías, tiendas naturistas y revendedores. Con la cuenta aprobada pagas el precio
          mayorista al comprar la cantidad mínima de cada presentación. El envío sigue siendo
          gratis.
        </p>
      </div>
      <div class="space-y-5">
        {state && (
          <div
            class={`rounded-[1.5rem] p-5 ${profile.wholesaleStatus === 'REJECTED' ? 'bg-sol-50 text-sol-900' : 'bg-white ring-1 ring-luna/10'}`}
            role="status"
          >
            <p class="font-display text-xl font-bold">{state.title}</p>
            <p class="mt-1">{state.body}</p>
            {profile.wholesaleBusinessName && (
              <p class="mt-2 text-sm">Negocio: {profile.wholesaleBusinessName}</p>
            )}
          </div>
        )}
        {canRequest && (
          <form
            class="space-y-4 rounded-[1.5rem] bg-white p-5 ring-1 ring-luna/10"
            noValidate
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                const { data } = await apiFetch<{ data: Profile }>('/api/account/wholesale', {
                  method: 'POST',
                  body: JSON.stringify({ businessName, note }),
                });
                setProfile(data);
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
            <TextInput
              id="wholesale-business"
              label="Nombre del negocio"
              value={businessName}
              onInput={setBusinessName}
              error={errors['businessName']}
            />
            <TextArea
              id="wholesale-note"
              label="Cuéntanos de tu negocio (opcional)"
              value={note}
              onInput={setNote}
              rows={3}
              hint="Ciudad, tipo de negocio y qué productos te interesan."
              error={errors['note']}
            />
            <Button type="submit" busy={busy}>
              Enviar solicitud
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
