import { inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of, timeout } from 'rxjs';

export const sesionGuard: CanActivateFn = () => {
  const http = inject(HttpClient);
  const router = inject(Router);

  const token = sessionStorage.getItem('token');

  if (!token) {
    return router.createUrlTree(['/login']);
  }

  return http.get('http://localhost:3000/api/sesion', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  }).pipe(
    timeout(10000),
    map(() => true),
    catchError((error) => {
      if (error.status === 401) {
        sessionStorage.removeItem('token');
      }

      return of(router.createUrlTree(['/login']));
    })
  );
};