import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-banner-demo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      role="status"
      class="bg-amber-400 px-4 py-2 text-center text-sm font-semibold tracking-wide text-amber-950"
    >
      Modo demostración — datos simulados
    </div>
  `,
})
export class BannerDemo {}
