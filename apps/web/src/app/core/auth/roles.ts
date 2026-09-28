export type Rol = 'VENTAS' | 'CAJA' | 'FINANZAS' | 'ADMIN' | 'INTEGRACION';

export const ETIQUETA_ROL: Record<Rol, string> = {
  VENTAS: 'Ventas',
  CAJA: 'Caja',
  FINANZAS: 'Finanzas',
  ADMIN: 'Administración',
  INTEGRACION: 'Integración',
};

export interface Modulo {
  ruta: string;
  titulo: string;
  descripcion: string;
  roles: readonly Rol[];
  fase: string;
}

/** Qué módulo ve cada rol. La API aplica los mismos permisos: esto es solo la vista. */
export const MODULOS: readonly Modulo[] = [
  {
    ruta: 'monitor',
    titulo: 'Monitor de movimientos',
    descripcion: 'Abonos entrando en vivo, filtros y búsqueda rápida por monto.',
    roles: ['CAJA', 'VENTAS', 'FINANZAS'],
    fase: 'F3',
  },
  {
    ruta: 'conciliacion',
    titulo: 'Conciliación',
    descripcion: 'Pagos conciliados, probables por confirmar y sin identificar.',
    roles: ['CAJA', 'FINANZAS'],
    fase: 'F4',
  },
  {
    ruta: 'alertas',
    titulo: 'Alertas',
    descripcion: 'Pagos recibidos, sin identificar, duplicados y montos inusuales.',
    roles: ['CAJA', 'VENTAS', 'FINANZAS'],
    fase: 'F5',
  },
  {
    ruta: 'proveedores',
    titulo: 'Validación de proveedores',
    descripcion: 'Verificar que el CCI pertenece al proveedor antes de pagar.',
    roles: ['FINANZAS'],
    fase: 'F6',
  },
  {
    ruta: 'posicion',
    titulo: 'Posición de caja',
    descripcion: 'Saldos, ingresos del día y cuentas por cobrar por antigüedad.',
    roles: ['FINANZAS'],
    fase: 'F7',
  },
];

export function puedeVer(rol: Rol | undefined, roles: readonly Rol[]): boolean {
  return !!rol && (rol === 'ADMIN' || roles.includes(rol));
}
