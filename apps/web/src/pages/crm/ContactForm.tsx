import { Field } from '../../components/ui.js';
import type { ContactFormValues } from './crm.js';

export function ContactForm({
  form,
  setForm,
  errors,
  companies,
}: {
  form: ContactFormValues;
  setForm: (form: ContactFormValues) => void;
  errors: Record<string, string>;
  companies: { id: string; name: string }[];
}) {
  const input = (key: keyof ContactFormValues, type = 'text') => (
    <input
      type={type}
      value={form[key]}
      onChange={(e) => setForm({ ...form, [key]: e.target.value })}
    />
  );
  return (
    <div className="form-grid">
      <Field label="Nombre" error={errors.firstName}>
        {input('firstName')}
      </Field>
      <Field label="Apellidos" error={errors.lastName}>
        {input('lastName')}
      </Field>
      <Field
        label="Correo"
        error={errors.email}
        hint="Opcional, pero sin correo no recibe comunicaciones."
      >
        {input('email', 'email')}
      </Field>
      <Field label="Teléfono" error={errors.phone}>
        {input('phone', 'tel')}
      </Field>
      <Field label="Empresa" error={errors.companyId}>
        <select
          value={form.companyId}
          onChange={(e) => setForm({ ...form, companyId: e.target.value })}
        >
          <option value="">Sin empresa</option>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Puesto" error={errors.position}>
        {input('position')}
      </Field>
    </div>
  );
}
