import { HttpInterceptorFn } from '@angular/common/http';
import { environment } from '../environments/environment';

export const apiProduccionInterceptor: HttpInterceptorFn = (
  peticion,
  siguiente
) => {
  const servidorLocal = 'http://localhost:3000';

  const esApiLocal =
    peticion.url === `${servidorLocal}/api` ||
    peticion.url.startsWith(`${servidorLocal}/api/`) ||
    peticion.url.startsWith(`${servidorLocal}/api?`);

  if (environment.production && esApiLocal) {
    return siguiente(
      peticion.clone({
        url: peticion.url.slice(servidorLocal.length),
      })
    );
  }

  return siguiente(peticion);
};