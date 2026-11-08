import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { api } from './api';
import {
  Button,
  ConfirmDialog,
  DataList,
  FormDialog,
  Loading,
  Notice,
  PageHeader,
  Select,
  TextArea,
  TextInput,
  Toggle,
  toFieldErrors,
  type Column,
  type FieldErrors,
} from './ui';

export type FieldDef =
  | {
      kind: 'text' | 'number' | 'date';
      name: string;
      label: string;
      hint?: string;
      inputMode?: 'numeric' | 'text';
    }
  | { kind: 'textarea'; name: string; label: string; hint?: string; rows?: number }
  | { kind: 'toggle'; name: string; label: string; hint?: string }
  | {
      kind: 'select';
      name: string;
      label: string;
      hint?: string;
      options: (values: Values, rows: Row[]) => { value: string; label: string }[];
    };

export type Values = Record<string, string | boolean>;
export type Row = { id: string } & Record<string, unknown>;

export interface EntityConfig {
  title: string;
  description: string;
  singular: string;
  /** Grammatical gender, for "Nueva categoría" / "Nuevo cupón". */
  gender: 'f' | 'm';
  endpoint: string;
  columns: Column<Row>[];
  fields: FieldDef[];
  empty: () => Values;
  toValues: (row: Row) => Values;
  toPayload: (values: Values) => unknown;
  /** Called when a value changes, to derive others (e.g. slug from name). */
  onChange?: (name: string, values: Values, editing: boolean) => Values;
  deleteWarning: (row: Row) => ComponentChildren;
  listMeta?: (meta: Record<string, unknown> | undefined) => ComponentChildren;
}

export function EntityManager({ config }: { config: EntityConfig }) {
  const f = config.gender === 'f';
  const noun = config.singular.toLowerCase();
  const labels = {
    new: `${f ? 'Nueva' : 'Nuevo'} ${noun}`,
    created: `${config.singular} ${f ? 'creada' : 'creado'}.`,
    deleted: `${config.singular} ${f ? 'borrada' : 'borrado'}.`,
  };
  const [rows, setRows] = useState<Row[] | null>(null);
  const [meta, setMeta] = useState<Record<string, unknown> | undefined>();
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [values, setValues] = useState<Values>(config.empty());
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<Row | null>(null);

  async function load() {
    try {
      const res = await api.get<{ data: Row[]; meta?: Record<string, unknown> }>(config.endpoint);
      setRows(res.data);
      setMeta(res.meta);
    } catch (e) {
      setNotice({ tone: 'error', text: toFieldErrors(e).message });
    }
  }
  useEffect(() => {
    void load();
  }, []);

  const open = (row: Row | 'new') => {
    setEditing(row);
    setValues(row === 'new' ? config.empty() : config.toValues(row));
    setErrors({});
    setFormError('');
  };

  const update = (name: string, value: string | boolean) =>
    setValues((v) => {
      const next = { ...v, [name]: value };
      return config.onChange ? config.onChange(name, next, editing !== 'new') : next;
    });

  async function submit(event: Event) {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    setFormError('');
    try {
      const payload = config.toPayload(values);
      if (editing === 'new') await api.post(config.endpoint, payload);
      else if (editing) await api.put(`${config.endpoint}/${editing.id}`, payload);
      setNotice({
        tone: 'ok',
        text: editing === 'new' ? labels.created : 'Cambios guardados.',
      });
      setEditing(null);
      await load();
    } catch (e) {
      const parsed = toFieldErrors(e);
      setErrors(parsed.fields);
      setFormError(parsed.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="space-y-6">
      <PageHeader
        title={config.title}
        description={config.description}
        actions={<Button onClick={() => open('new')}>{labels.new}</Button>}
      />
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {config.listMeta?.(meta)}
      {rows === null ? (
        <Loading />
      ) : (
        <DataList
          caption={config.title}
          rows={rows}
          columns={config.columns}
          empty={<p>Todavía no hay registros. Crea el primero con el botón de arriba.</p>}
          actions={(row) => (
            <>
              <Button variant="secondary" onClick={() => open(row)}>
                Editar
              </Button>
              <Button variant="ghost" class="text-sol-700" onClick={() => setToDelete(row)}>
                Borrar
              </Button>
            </>
          )}
        />
      )}

      <FormDialog
        open={editing !== null}
        title={editing === 'new' ? labels.new : `Editar ${noun}`}
        onClose={() => setEditing(null)}
      >
        <form onSubmit={submit} noValidate class="space-y-4">
          {formError && <Notice tone="error">{formError}</Notice>}
          {config.fields.map((f) => {
            const id = `f-${f.name}`;
            const raw = values[f.name];
            const value = typeof raw === 'string' ? raw : '';
            if (f.kind === 'toggle')
              return (
                <Toggle
                  key={f.name}
                  id={id}
                  label={f.label}
                  hint={f.hint}
                  checked={Boolean(raw)}
                  onChange={(v) => update(f.name, v)}
                />
              );
            if (f.kind === 'textarea')
              return (
                <TextArea
                  key={f.name}
                  id={id}
                  label={f.label}
                  hint={f.hint}
                  rows={f.rows}
                  value={value}
                  error={errors[f.name]}
                  onInput={(v) => update(f.name, v)}
                />
              );
            if (f.kind === 'select')
              return (
                <Select
                  key={f.name}
                  id={id}
                  label={f.label}
                  hint={f.hint}
                  value={value}
                  error={errors[f.name]}
                  options={f.options(values, rows ?? [])}
                  onChange={(v) => update(f.name, v)}
                />
              );
            return (
              <TextInput
                key={f.name}
                id={id}
                label={f.label}
                hint={f.hint}
                type={f.kind === 'date' ? 'datetime-local' : 'text'}
                inputMode={f.kind === 'number' ? 'numeric' : f.inputMode}
                value={value}
                error={errors[f.name]}
                onInput={(v) => update(f.name, v)}
              />
            );
          })}
          <div class="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            <Button type="submit" busy={saving}>
              Guardar
            </Button>
          </div>
        </form>
      </FormDialog>

      <ConfirmDialog
        open={toDelete !== null}
        danger
        title={`Borrar ${noun}`}
        confirmLabel="Borrar"
        body={toDelete ? config.deleteWarning(toDelete) : null}
        onClose={() => setToDelete(null)}
        onConfirm={async () => {
          if (!toDelete) return;
          try {
            await api.del(`${config.endpoint}/${toDelete.id}`);
            setNotice({ tone: 'ok', text: labels.deleted });
            await load();
          } catch (e) {
            setNotice({ tone: 'error', text: toFieldErrors(e).message });
          } finally {
            setToDelete(null);
          }
        }}
      />
    </div>
  );
}
