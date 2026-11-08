import { useEffect, useState } from 'preact/hooks';
import { apiFetch } from '../../lib/auth-client';
import { Button, Loading, Notice, TextInput, toFieldErrors, type FieldErrors } from '../admin/ui';

interface Profile {
  email: string;
  name: string;
  phone: string | null;
  documentNumber: string | null;
}

export default function ProfileForm() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', documentNumber: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<{ data: Profile }>('/api/account/profile')
      .then(({ data }) => {
        setProfile(data);
        setForm({
          name: data.name,
          phone: data.phone ?? '',
          documentNumber: data.documentNumber ?? '',
        });
      })
      .catch((e: unknown) => setNotice({ tone: 'error', text: toFieldErrors(e).message }));
  }, []);

  const set = (key: keyof typeof form) => (value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: '' }));
  };

  return (
    <div class="rounded-[2rem] bg-white p-6 ring-1 ring-luna/10 sm:p-8">
      <h2 class="text-2xl">Tus datos</h2>
      <p class="mt-1 text-sm text-noche/70">
        Los usamos para tus pedidos. Tu correo ({profile?.email ?? '…'}) no se puede cambiar desde
        aquí.
      </p>
      {!profile && !notice ? (
        <Loading />
      ) : (
        <form
          class="mt-6 space-y-5"
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const { data } = await apiFetch<{ data: Profile }>('/api/account/profile', {
                method: 'PUT',
                body: JSON.stringify(form),
              });
              setProfile(data);
              setErrors({});
              setNotice({ tone: 'ok', text: 'Guardamos tus datos.' });
            } catch (error) {
              const parsed = toFieldErrors(error);
              setErrors(parsed.fields);
              setNotice({ tone: 'error', text: parsed.message });
            } finally {
              setBusy(false);
            }
          }}
        >
          {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
          <TextInput
            id="profile-name"
            label="Nombre y apellido"
            value={form.name}
            onInput={set('name')}
            error={errors['name']}
          />
          <div class="grid gap-5 sm:grid-cols-2">
            <TextInput
              id="profile-phone"
              label="Celular (opcional)"
              type="tel"
              inputMode="tel"
              value={form.phone}
              onInput={set('phone')}
              error={errors['phone']}
            />
            <TextInput
              id="profile-document"
              label="Documento (opcional)"
              value={form.documentNumber}
              onInput={set('documentNumber')}
              error={errors['documentNumber']}
              hint="Cédula o NIT, para la factura."
            />
          </div>
          <Button type="submit" busy={busy}>
            Guardar datos
          </Button>
        </form>
      )}
    </div>
  );
}
