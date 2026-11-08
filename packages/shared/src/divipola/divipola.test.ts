import { describe, expect, it } from 'vitest';
import {
  DEPARTMENTS,
  getDepartmentName,
  getMunicipalities,
  getMunicipalityName,
  isValidLocation,
  locationSchema,
} from './index.js';

describe('DIVIPOLA', () => {
  it('includes the 32 departments plus Bogotá D.C.', () => {
    expect(DEPARTMENTS).toHaveLength(33);
    expect(getDepartmentName('11')).toBe('Bogotá, D.C.');
    expect(getDepartmentName('76')).toBe('Valle del Cauca');
  });

  it('contains every municipality (DANE, 1.122 rows)', () => {
    const total = DEPARTMENTS.reduce((sum, d) => sum + getMunicipalities(d.code).length, 0);
    expect(total).toBe(1122);
  });

  it('resolves well-known municipalities', () => {
    expect(getMunicipalityName('05001')).toBe('Medellín');
    expect(getMunicipalityName('11001')).toBe('Bogotá, D.C.');
    expect(getMunicipalityName('76001')).toBe('Santiago de Cali');
    expect(getMunicipalityName('54001')).toBe('San José de Cúcuta');
  });

  it('validates department/municipality pairs', () => {
    expect(isValidLocation('05', '05001')).toBe(true);
    expect(isValidLocation('76', '05001')).toBe(false);
    expect(
      locationSchema.safeParse({ departmentCode: '76', municipalityCode: '05001' }).success,
    ).toBe(false);
  });
});
