'use client';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError } from '@/lib/api';
import { Button, Checkbox, Field, Input, Modal, Select, Textarea } from './ui';

export type FieldValue = string | boolean;
export type FormValues = Record<string, FieldValue>;

export interface FieldDef {
  name: string;
  label: string;
  type?: 'text' | 'email' | 'number' | 'money' | 'date' | 'month' | 'select' | 'textarea' | 'checkbox' | 'password';
  options?: Array<{ value: string; label: string }>;
  required?: boolean;
  placeholder?: string;
  hint?: ReactNode;
  half?: boolean;
  show?: (values: FormValues) => boolean;
}

/** Turns form values into an API payload: trims strings and drops empty optional fields. */
export function cleanValues(values: FormValues, opts: { nullEmpty?: boolean } = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (typeof v === 'string') {
      const t = v.trim();
      if (t === '') {
        if (opts.nullEmpty) out[k] = null;
        continue;
      }
      out[k] = t;
    } else out[k] = v;
  }
  return out;
}

/** Generic create/edit dialog driven by a field list, with server-side validation messages. */
export function FormModal({
  open,
  onClose,
  title,
  description,
  fields,
  initial,
  onSubmit,
  submitLabel = 'Save',
  size = 'md',
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  fields: FieldDef[];
  initial?: FormValues;
  onSubmit: (values: FormValues) => Promise<unknown>;
  submitLabel?: string;
  size?: 'sm' | 'md' | 'lg';
  children?: ReactNode;
}) {
  const [values, setValues] = useState<FormValues>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const base: FormValues = {};
    for (const f of fields) base[f.name] = f.type === 'checkbox' ? false : '';
    setValues({ ...base, ...(initial ?? {}) });
    setErrors({});
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setError(null);
    try {
      await onSubmit(values);
      onClose();
    } catch (err) {
      const apiErr = err as ApiError;
      const fieldErrors = apiErr.fieldErrors?.() ?? {};
      setErrors(fieldErrors);
      if (!Object.keys(fieldErrors).length || !fields.some((f) => fieldErrors[f.name])) setError(apiErr.message ?? 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const set = (name: string, v: FieldValue) => setValues((prev) => ({ ...prev, [name]: v }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size={size}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="form-modal" loading={busy}>{submitLabel}</Button>
        </>
      }
    >
      <form id="form-modal" onSubmit={submit} className="grid grid-cols-2 gap-4">
        {error && <div className="col-span-2 rounded-xl border border-negative/30 bg-negative/10 px-3 py-2 text-sm text-negative" role="alert">{error}</div>}
        {fields.filter((f) => !f.show || f.show(values)).map((f) => {
          const id = `fm-${f.name}`;
          const value = values[f.name];
          const span = f.half ? 'col-span-2 sm:col-span-1' : 'col-span-2';
          if (f.type === 'checkbox') {
            return (
              <div key={f.name} className={span}>
                <Checkbox id={id} checked={Boolean(value)} onChange={(e) => set(f.name, e.target.checked)} label={f.label} />
                {f.hint && <p className="mt-1 text-xs text-muted">{f.hint}</p>}
              </div>
            );
          }
          return (
            <Field key={f.name} label={`${f.label}${f.required ? '' : ' (optional)'}`} htmlFor={id} error={errors[f.name]} hint={f.hint} className={span}>
              {f.type === 'select' ? (
                <Select id={id} required={f.required} value={String(value ?? '')} onChange={(e) => set(f.name, e.target.value)}>
                  {!f.required && <option value="">—</option>}
                  {f.required && !value && <option value="">Select…</option>}
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </Select>
              ) : f.type === 'textarea' ? (
                <Textarea id={id} required={f.required} placeholder={f.placeholder} value={String(value ?? '')} onChange={(e) => set(f.name, e.target.value)} />
              ) : (
                <Input
                  id={id}
                  type={f.type === 'money' ? 'text' : (f.type ?? 'text')}
                  inputMode={f.type === 'money' || f.type === 'number' ? 'decimal' : undefined}
                  required={f.required}
                  placeholder={f.placeholder ?? (f.type === 'money' ? '0.00' : undefined)}
                  value={String(value ?? '')}
                  onChange={(e) => set(f.name, f.type === 'money' ? e.target.value.replace(/[^\d.-]/g, '') : e.target.value)}
                  className={f.type === 'money' ? 'num' : undefined}
                />
              )}
            </Field>
          );
        })}
        {children && <div className="col-span-2">{children}</div>}
      </form>
    </Modal>
  );
}

export function ConfirmDialog({ open, onClose, title, message, confirmLabel = 'Confirm', onConfirm, danger }: { open: boolean; onClose: () => void; title: string; message: ReactNode; confirmLabel?: string; onConfirm: () => Promise<unknown>; danger?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm();
                onClose();
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-muted">{message}</div>
      {error && <p className="mt-3 text-sm text-negative">{error}</p>}
    </Modal>
  );
}
