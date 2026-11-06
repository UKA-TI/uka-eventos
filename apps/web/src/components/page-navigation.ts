import { createContext, type ReactNode } from 'react';

/** Ubica la navegación del módulo después de su encabezado compartido. */
export const PageNavigationContext = createContext<ReactNode>(null);
