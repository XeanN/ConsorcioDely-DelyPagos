import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ETIQUETA_ROL, MODULOS, puedeVer } from '../../core/auth/roles';
import { Sesion } from '../../core/auth/sesion';

/** Marco de la aplicación con sesión: cabecera, menú según rol y contenido. */
@Component({
  selector: 'app-marco',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './marco.html',
})
export class Marco {
  private readonly sesion = inject(Sesion);
  private readonly router = inject(Router);

  protected readonly usuario = this.sesion.usuario;
  protected readonly etiquetaRol = computed(() => {
    const rol = this.usuario()?.rol;
    return rol ? ETIQUETA_ROL[rol] : '';
  });
  protected readonly modulos = computed(() =>
    MODULOS.filter((m) => puedeVer(this.usuario()?.rol, m.roles)),
  );

  protected async salir(): Promise<void> {
    await this.sesion.salir();
    await this.router.navigate(['/ingresar']);
  }
}
