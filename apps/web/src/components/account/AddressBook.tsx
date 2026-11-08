import { DEPARTMENTS, getMunicipalities } from '@sol-y-luna/shared/divipola';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { apiFetch } from '../../lib/auth-client';
import {
  Button,
  ConfirmDialog,
  FormDialog,
  Loading,
  Notice,
  Select,
  TextInput,
  Toggle,
  toFieldErrors,
  type FieldErrors,
} from '../admin/ui';

interface Address {
  id: string;
  recipientName: string;
  phone: string;
  departmentCode: string;
  departmentName: string | null;
  municipalityCode: string;
  municipalityName: string | null;
  addressLine: string;
  neighborhood: string | null;
  instructions: string | null;
  isDefault: boolean;
}

const empty = {
  recipientName: '',
  phone: '',
  departmentCode: '',
  municipalityCode: '',
  addressLine: '',
  neighborhood: '',
  instructions: '',
  isDefault: false,
};
type FormValues = typeof empty;

function AddressForm(props: { initial: Address | null; onSaved: (message: string) => void }) {
  const [form, setForm] = useState<FormValues>(
    props.initial
      ? {
          recipientName: props.initial.recipientName,
          phone: props.initial.phone,
          departmentCode: props.initial.departmentCode,
          municipalityCode: props.initial.municipalityCode,
          addressLine: props.initial.addressLine,
          neighborhood: props.initial.neighborhood ?? '',
          instructions: props.initial.instructions ?? '',
          isDefault: props.initial.isDefault,
        }
      : empty,
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const municipalities = useMemo(
    () => (form.departmentCode ? getMunicipalities(form.departmentCode) : []),
    [form.departmentCode],
  );
  const set =
    <K extends keyof FormValues>(key: K) =>
    (value: FormValues[K]) => {
      setForm((f) => ({ ...f, [key]: value }));
      setErrors((e) => ({ ...e, [key]: '' }));
    };

  return (
    <form
      class="space-y-4"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const path = props.initial
            ? `/api/account/addresses/${props.initial.id}`
            : '/api/account/addresses';
          await apiFetch(path, {
            method: props.initial ? 'PUT' : 'POST',
            body: JSON.stringify({
              ...form,
              neighborhood: form.neighborhood || undefined,
              instructions: form.instructions || undefined,
            }),
          });
          props.onSaved(props.initial ? 'Dirección actualizada.' : 'Dirección guardada.');
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
        <TextInput
          id="addr-name"
          label="Quién recibe"
          value={form.recipientName}
          onInput={set('recipientName')}
          error={errors['recipientName']}
        />
        <TextInput
          id="addr-phone"
          label="Celular de quien recibe"
          type="tel"
          inputMode="tel"
          value={form.phone}
          onInput={set('phone')}
          error={errors['phone']}
        />
        <Select
          id="addr-department"
          label="Departamento"
          value={form.departmentCode}
          onChange={(v) => {
            setForm((f) => ({ ...f, departmentCode: v, municipalityCode: '' }));
            setErrors((e) => ({ ...e, departmentCode: '', municipalityCode: '' }));
          }}
          options={[
            { value: '', label: 'Elige el departamento' },
            ...DEPARTMENTS.map((d) => ({ value: d.code, label: d.name })),
          ]}
          error={errors['departmentCode']}
        />
        <Select
          id="addr-municipality"
          label="Municipio"
          value={form.municipalityCode}
          onChange={set('municipalityCode')}
          options={[
            {
              value: '',
              label: form.departmentCode ? 'Elige el municipio' : 'Primero elige el departamento',
            },
            ...municipalities.map((m) => ({ value: m.code, label: m.name })),
          ]}
          error={errors['municipalityCode']}
        />
      </div>
      <TextInput
        id="addr-line"
        label="Dirección"
        value={form.addressLine}
        onInput={set('addressLine')}
        placeholder="Calle 10 # 43-20, apto 502"
        error={errors['addressLine']}
      />
      <div class="grid gap-4 sm:grid-cols-2">
        <TextInput
          id="addr-neighborhood"
          label="Barrio (opcional)"
          value={form.neighborhood}
          onInput={set('neighborhood')}
          error={errors['neighborhood']}
        />
        <TextInput
          id="addr-instructions"
          label="Indicaciones (opcional)"
          value={form.instructions}
          onInput={set('instructions')}
          placeholder="Portería, casa esquinera…"
          error={errors['instructions']}
        />
      </div>
      <Toggle
        id="addr-default"
        label="Usar como dirección principal"
        checked={form.isDefault}
        onChange={set('isDefault')}
      />
      <Button type="submit" busy={busy}>
        Guardar dirección
      </Button>
    </form>
  );
}

export default function AddressBook() {
  const [addresses, setAddresses] = useState<Address[] | null>(null);
  const [editing, setEditing] = useState<Address | 'new' | null>(null);
  const [toDelete, setToDelete] = useState<Address | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const load = () =>
    apiFetch<{ data: Address[] }>('/api/account/addresses')
      .then((res) => setAddresses(res.data))
      .catch((e: unknown) => {
        setAddresses([]);
        setNotice({ tone: 'error', text: toFieldErrors(e).message });
      });
  useEffect(() => {
    void load();
  }, []);

  if (addresses === null) return <Loading />;
  return (
    <div class="space-y-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="max-w-[50ch] text-noche/80">
          Las usas en el checkout para no escribirlas cada vez.
        </p>
        <Button onClick={() => setEditing('new')}>Agregar dirección</Button>
      </div>
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {addresses.length === 0 ? (
        <div class="rounded-[2rem] border-2 border-dashed border-luna/25 p-8 text-center">
          Aún no tienes direcciones guardadas.
        </div>
      ) : (
        <ul class="grid gap-4 md:grid-cols-2">
          {addresses.map((a) => (
            <li key={a.id} class="rounded-[1.5rem] bg-white p-5 ring-1 ring-luna/10">
              {a.isDefault && (
                <p class="mb-2 inline-flex rounded-full bg-luna px-3 py-0.5 text-xs font-bold text-crema">
                  Principal
                </p>
              )}
              <address class="break-words not-italic">
                <strong>{a.recipientName}</strong>
                <br />
                {a.addressLine}
                {a.neighborhood && `, ${a.neighborhood}`}
                <br />
                {a.municipalityName}, {a.departmentName}
                <br />
                Tel. {a.phone}
              </address>
              <div class="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setEditing(a)}>
                  Editar
                </Button>
                <Button variant="ghost" onClick={() => setToDelete(a)}>
                  Eliminar
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <FormDialog
        open={editing !== null}
        title={editing === 'new' ? 'Nueva dirección' : 'Editar dirección'}
        onClose={() => setEditing(null)}
      >
        {editing && (
          <AddressForm
            key={editing === 'new' ? 'new' : editing.id}
            initial={editing === 'new' ? null : editing}
            onSaved={(text) => {
              setEditing(null);
              setNotice({ tone: 'ok', text });
              void load();
            }}
          />
        )}
      </FormDialog>
      <ConfirmDialog
        open={toDelete !== null}
        title="Eliminar dirección"
        body={<p>¿Eliminar la dirección de {toDelete?.recipientName}?</p>}
        confirmLabel="Eliminar"
        danger
        onClose={() => setToDelete(null)}
        onConfirm={async () => {
          try {
            await apiFetch(`/api/account/addresses/${toDelete!.id}`, { method: 'DELETE' });
            setNotice({ tone: 'ok', text: 'Dirección eliminada.' });
            void load();
          } catch (error) {
            setNotice({ tone: 'error', text: toFieldErrors(error).message });
          }
          setToDelete(null);
        }}
      />
    </div>
  );
}
