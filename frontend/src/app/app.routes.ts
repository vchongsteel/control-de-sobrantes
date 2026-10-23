import { Routes } from '@angular/router';
import { sesionGuard } from './guards/sesion.guards';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'login',
    pathMatch: 'full',
  },
  {
    path: 'login',
    loadComponent: () =>
      import('./pages/login/login.page')
        .then((m) => m.LoginPage),
  },
  {
    path: 'registro',
    loadComponent: () =>
      import('./pages/registro/registro.page')
        .then((m) => m.RegistroPage),
  },
  {
    path: 'recuperar-contrasena',
    loadComponent: () =>
      import('./pages/recuperar-contrasena/recuperar-contrasena.page')
        .then((m) => m.RecuperarContrasenaPage),
  },
  {
    path: 'restablecer-contrasena',
    loadComponent: () =>
      import('./pages/restablecer-contrasena/restablecer-contrasena.page')
        .then((m) => m.RestablecerContrasenaPage),
  },
  {
    path: 'principal',
    canActivate: [sesionGuard],
    canActivateChild: [sesionGuard],
    loadComponent: () =>
      import('./pages/principal/principal.page')
        .then((m) => m.PrincipalPage),
    children: [
      {
        path: '',
        redirectTo: 'inicio',
        pathMatch: 'full',
      },
      {
        path: 'inicio',
        loadComponent: () =>
          import('./pages/inicio/inicio.page')
            .then((m) => m.InicioPage),
      },
      {
        path: 'sobrantes',
        loadComponent: () =>
          import('./pages/sobrantes/sobrantes.page')
            .then((m) => m.SobrantesPage),
      },
      {
        path: 'solicitudes',
        loadComponent: () =>
          import('./pages/solicitudes/solicitudes.page')
            .then((m) => m.SolicitudesPage),
      },
      {
        path: 'aprobaciones',
        loadComponent: () => import('./pages/aprobaciones/aprobaciones.page').then(m => m.AprobacionesPage),
      },
      {
        path: 'despachos',
        loadComponent: () => import('./pages/despachos/despachos.page').then(m => m.DespachosPage),
      },
      {
  path: 'guias-salida',
  loadComponent: () =>
    import('./pages/guias/guias')
      .then(m => m.GuiasSalidaPage),
},
      {
        path: 'registrar-sobrante',
        loadComponent: () =>
          import('./pages/registrar-sobrante/registrar-sobrante.page')
            .then((m) => m.RegistrarSobrantePage),
      },
      {
        path: 'administrar-usuarios',
        loadComponent: () =>
          import('./pages/administrar-usuarios/administrar-usuarios.page')
            .then((m) => m.AdministrarUsuariosPage),
      },
    ],
  },
  {
    path: 'inicio',
    redirectTo: 'principal/inicio',
    pathMatch: 'full',
  },
  {
    path: 'sobrantes',
    redirectTo: 'principal/sobrantes',
    pathMatch: 'full',
  },
  {
    path: '**',
    redirectTo: 'login',
  },
];