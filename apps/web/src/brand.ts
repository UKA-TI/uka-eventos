// Los archivos de marca viven en la carpeta img/ de la raíz del proyecto. Para
// cambiarlos, reemplázalos ahí conservando el nombre y vuelve a compilar.
import faviconUrl from '../../../img/Favicon.png';

export { default as logoUrl } from '../../../img/logo_uka.png';

export function applyFavicon() {
  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/png';
  link.href = faviconUrl;
  document.head.append(link);
}
