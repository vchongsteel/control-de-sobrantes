import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';

export type Tema = 'claro' | 'oscuro';

@Injectable({ providedIn: 'root' })
export class TemaService {
  private document = inject(DOCUMENT);
  private clave = 'steel-iem-tema';
  readonly actual = signal<Tema>('claro');
  readonly guardado = signal(true);

  constructor() {
    let tema: Tema = 'claro';
    try {
      if (this.document.defaultView?.localStorage.getItem(this.clave) === 'oscuro') tema = 'oscuro';
    } catch { this.guardado.set(false); }
    this.aplicar(tema);
  }

  elegir(tema: Tema): void {
    this.aplicar(tema);
    try {
      const storage = this.document.defaultView?.localStorage;
      if (!storage) { this.guardado.set(false); return; }
      storage.setItem(this.clave, tema);
      this.guardado.set(true);
    } catch { this.guardado.set(false); }
  }

  private aplicar(tema: Tema): void {
    this.actual.set(tema);
    const html = this.document.documentElement;
    html.classList.toggle('ion-palette-dark', tema === 'oscuro');
    html.classList.toggle('tema-oscuro', tema === 'oscuro');
    html.classList.toggle('tema-claro', tema === 'claro');
    html.style.colorScheme = tema === 'oscuro' ? 'dark' : 'light';
  }
}
