import { z } from 'zod';
import { DEPARTMENTS, MUNICIPALITIES_BY_DEPARTMENT } from './data.js';

export { DEPARTMENTS, MUNICIPALITIES_BY_DEPARTMENT };

export type DepartmentCode = (typeof DEPARTMENTS)[number]['code'];

export interface Municipality {
  code: string;
  name: string;
  departmentCode: string;
}

const departmentNames = new Map<string, string>(DEPARTMENTS.map((d) => [d.code, d.name]));

export function getDepartments(): readonly { code: string; name: string }[] {
  return DEPARTMENTS;
}

export function getDepartmentName(code: string): string | undefined {
  return departmentNames.get(code);
}

export function getMunicipalities(departmentCode: string): Municipality[] {
  return (MUNICIPALITIES_BY_DEPARTMENT[departmentCode] ?? []).map(([code, name]) => ({
    code,
    name,
    departmentCode,
  }));
}

export function getMunicipalityName(municipalityCode: string): string | undefined {
  const list = MUNICIPALITIES_BY_DEPARTMENT[municipalityCode.slice(0, 2)];
  return list?.find(([code]) => code === municipalityCode)?.[1];
}

/** True when the municipality exists and belongs to the department. */
export function isValidLocation(departmentCode: string, municipalityCode: string): boolean {
  return (MUNICIPALITIES_BY_DEPARTMENT[departmentCode] ?? []).some(
    ([code]) => code === municipalityCode,
  );
}

/** Zod schema for a department/municipality pair, with Spanish messages. */
export const locationSchema = z
  .object({
    departmentCode: z.string().regex(/^\d{2}$/, { error: 'Selecciona un departamento' }),
    municipalityCode: z.string().regex(/^\d{5}$/, { error: 'Selecciona un municipio' }),
  })
  .refine((value) => isValidLocation(value.departmentCode, value.municipalityCode), {
    error: 'El municipio no pertenece al departamento seleccionado',
    path: ['municipalityCode'],
  });
