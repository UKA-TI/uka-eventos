import type { FiscalData } from '@uka/shared';

export type FiscalDraft = Record<keyof FiscalData, string>;

export const emptyFiscal: FiscalDraft = {
  rfc: '',
  legalName: '',
  regime: '',
  postalCode: '',
  cfdiUse: '',
  email: '',
};
