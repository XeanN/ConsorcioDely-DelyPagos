import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { BannerDemo } from './compartido/banner-demo';
import { Configuracion } from './core/configuracion';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, BannerDemo],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly configuracion = inject(Configuracion);
}
