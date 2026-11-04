import type { Prisma } from '../../generated/prisma/client.js';

interface Person {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  organization: string | null;
}

/** Busca o crea la empresa. Las lecturas con bloqueo ven lo que otra transacción ya confirmó. */
async function ensureCompany(
  tx: Prisma.TransactionClient,
  rawName: string,
): Promise<string> {
  const name = rawName.trim();
  await tx.company.createMany({ data: [{ name }], skipDuplicates: true });
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM companies WHERE name = ${name} FOR UPDATE`;
  const company = rows[0];
  if (!company) {
    throw new Error('La empresa no se pudo crear.');
  }
  return company.id;
}

/**
 * Une a quien se registra con su contacto: el mismo correo es la misma persona.
 * Solo completa datos vacíos. Quien se registra no ha demostrado ser dueño del
 * correo, así que nunca sobrescribe lo capturado por el equipo ni revierte una baja.
 */
export async function linkContact(
  tx: Prisma.TransactionClient,
  person: Person,
): Promise<string> {
  const email = person.email.trim().toLowerCase();
  await tx.contact.createMany({
    data: [
      {
        firstName: person.firstName,
        lastName: person.lastName,
        email,
        phone: person.phone,
        source: 'registration',
      },
    ],
    skipDuplicates: true,
  });
  const rows = await tx.$queryRaw<
    { id: string; phone: string | null; company_id: string | null }[]
  >`SELECT id, phone, company_id FROM contacts WHERE email = ${email} FOR UPDATE`;
  const contact = rows[0];
  if (!contact) {
    throw new Error('El contacto no se pudo crear.');
  }
  const organization = person.organization?.trim();
  const data: Prisma.ContactUncheckedUpdateInput = {};
  if (!contact.phone && person.phone) {
    data.phone = person.phone;
  }
  if (!contact.company_id && organization) {
    data.companyId = await ensureCompany(tx, organization);
  }
  if (Object.keys(data).length > 0) {
    await tx.contact.update({ where: { id: contact.id }, data });
  }
  return contact.id;
}
