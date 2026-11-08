/**
 * Demo catalog for Sol y Luna Store. Prices are realistic sample values in integer COP.
 * INVIMA codes are clearly marked as DEMO: replace them with the real registrations before going live.
 */
import type { Audience, InvimaStatus } from '../src/generated/prisma/enums.js';

export const SUPPLEMENT_DISCLAIMER =
  'Este producto es un suplemento dietario, no es un medicamento y no suple una alimentación equilibrada.';
export const COSMETIC_DISCLAIMER =
  'Producto cosmético de uso externo. Suspende su uso si presentas irritación y consulta a tu médico.';

export interface SeedCategory {
  slug: string;
  name: string;
  description: string;
  sortOrder: number;
  isAdult?: boolean;
}

export const categories: SeedCategory[] = [
  {
    slug: 'bienestar-y-defensas',
    name: 'Bienestar y defensas',
    description: 'Vitaminas, minerales y extractos para tu día a día.',
    sortOrder: 1,
  },
  {
    slug: 'para-el',
    name: 'Para él',
    description: 'Suplementos y cuidado pensados para hombres.',
    sortOrder: 2,
  },
  {
    slug: 'para-ella',
    name: 'Para ella',
    description: 'Suplementos y cuidado pensados para mujeres.',
    sortOrder: 3,
  },
  {
    slug: 'cuidado-intimo',
    name: 'Cuidado íntimo',
    description: 'Higiene y cuidado de la zona íntima.',
    sortOrder: 4,
  },
  {
    slug: 'potenciadores',
    name: 'Potenciadores (+18)',
    description: 'Productos para mayores de 18 años.',
    sortOrder: 5,
    isAdult: true,
  },
  {
    slug: 'alivio-y-neuropatia',
    name: 'Alivio y neuropatía',
    description: 'Cremas y suplementos para el bienestar de pies y manos.',
    sortOrder: 6,
  },
  {
    slug: 'skincare',
    name: 'Skincare',
    description: 'Sérums y soluciones para el cuidado de la piel.',
    sortOrder: 7,
  },
  {
    slug: 'energia',
    name: 'Energía',
    description: 'Energía práctica para llevar a cualquier parte.',
    sortOrder: 8,
  },
  {
    slug: 'hogar-y-carro',
    name: 'Hogar y carro',
    description: 'Limpieza y cuidado para tu casa y tu carro.',
    sortOrder: 9,
  },
];

export interface SeedBrand {
  slug: string;
  name: string;
  description: string;
  theme?: Record<string, string>;
}

export const brands: SeedBrand[] = [
  {
    slug: 'wild',
    name: 'WILD',
    description: 'Mentas con energía para tu ritmo.',
    theme: {
      mode: 'dark',
      style: 'graffiti-neon',
      background: '#0b0b12',
      accent: '#39ff14',
      accent2: '#ff2bd6',
    },
  },
  {
    slug: 'old-school',
    name: 'Old School',
    description: 'Suplementos clásicos para el entrenamiento.',
  },
  { slug: 'flujovital', name: 'FlujoVital', description: 'Bienestar circulatorio y metabólico.' },
  { slug: 'true-fem', name: 'True Fem', description: 'Bienestar femenino en cada etapa.' },
  { slug: 'perky', name: 'Perky', description: 'Aceites corporales para el cuidado de la piel.' },
];

export interface SeedVariant {
  sku: string;
  name: string;
  retailPrice: number;
  compareAtPrice?: number;
  wholesalePrice?: number;
  wholesaleMinQty?: number;
  stock: number;
  weightGrams?: number;
}

export interface SeedProduct {
  slug: string;
  name: string;
  shortDescription: string;
  description: string;
  benefits: string[];
  usage: string;
  ingredients?: string;
  warnings: string;
  category: string | null;
  brand: string | null;
  audience: Audience;
  isAdult?: boolean;
  invimaStatus: InvimaStatus;
  invimaCode?: string;
  disclaimer: string;
  featured?: boolean;
  placeholder: 'frasco' | 'gotero' | 'tubo' | 'spray' | 'lata';
  variants: SeedVariant[];
}

const keepAway = 'Mantener fuera del alcance de los niños. Almacenar en lugar fresco y seco.';
const pregnancy =
  'No consumir durante el embarazo o la lactancia. Consulta a tu médico si tomas medicamentos.';

export const products: SeedProduct[] = [
  {
    slug: 'turkesterone-tongkat-ali',
    name: 'Turkesterone con Tongkat Ali',
    shortDescription: 'Turkesterona y Tongkat Ali en cápsulas para complementar tu entrenamiento.',
    description:
      'Fórmula que combina turkesterona y extracto de Tongkat Ali, pensada como complemento de una rutina de entrenamiento y una alimentación balanceada.',
    benefits: [
      'Complemento para tu rutina de entrenamiento',
      'Fórmula con extractos vegetales',
      'Presentación para 2 meses',
    ],
    usage: 'Tomar 2 cápsulas al día con agua, preferiblemente con una comida.',
    ingredients:
      'Extracto de Ajuga turkestanica, extracto de Tongkat Ali (Eurycoma longifolia), cápsula vegetal.',
    warnings: `${pregnancy} ${keepAway}`,
    category: 'para-el',
    brand: 'old-school',
    audience: 'HIM',
    invimaStatus: 'IN_PROCESS',
    disclaimer: SUPPLEMENT_DISCLAIMER,
    featured: true,
    placeholder: 'frasco',
    variants: [
      {
        sku: 'SYL-TURK-120',
        name: '120 cápsulas',
        retailPrice: 159_900,
        compareAtPrice: 179_900,
        wholesalePrice: 124_900,
        stock: 40,
      },
    ],
  },
  {
    slug: 'muscle-complex-185',
    name: 'Muscle Complex 185',
    shortDescription: 'Complejo de aminoácidos y minerales en cápsulas.',
    description:
      'Complejo en cápsulas con aminoácidos, minerales y vitaminas para acompañar tu plan de entrenamiento.',
    benefits: [
      'Aminoácidos y minerales en una sola toma',
      'Fácil de llevar',
      'Ideal como complemento del entrenamiento',
    ],
    usage: 'Tomar 3 cápsulas al día, divididas en las comidas.',
    ingredients: 'L-arginina, L-citrulina, zinc, magnesio, vitamina B6, cápsula de gelatina.',
    warnings: `${pregnancy} ${keepAway}`,
    category: 'para-el',
    brand: 'old-school',
    audience: 'HIM',
    invimaStatus: 'NOT_REGISTERED',
    disclaimer: SUPPLEMENT_DISCLAIMER,
    placeholder: 'frasco',
    variants: [
      {
        sku: 'SYL-MC185-84',
        name: '84 cápsulas',
        retailPrice: 129_900,
        compareAtPrice: 149_900,
        wholesalePrice: 99_900,
        stock: 35,
      },
    ],
  },
  {
    slug: 'spray-dictamni',
    name: 'Spray Dictamni',
    shortDescription: 'Spray de higiene íntima con extractos herbales.',
    description:
      'Spray refrescante para la higiene de la zona íntima externa, con extractos herbales.',
    benefits: ['Sensación de frescura', 'Aplicación fácil en spray', 'Uso externo diario'],
    usage: 'Aplicar sobre la zona íntima externa limpia y seca, 1 a 2 veces al día.',
    ingredients:
      'Agua, extracto de Dictamnus dasycarpus, extracto de Sophora flavescens, glicerina.',
    warnings: `Uso externo. No aplicar sobre heridas abiertas. ${keepAway}`,
    category: 'cuidado-intimo',
    brand: null,
    audience: 'UNISEX',
    invimaStatus: 'REGISTERED',
    invimaCode: 'DEMO-NSOC-0001',
    disclaimer: COSMETIC_DISCLAIMER,
    placeholder: 'spray',
    variants: [
      {
        sku: 'SYL-DICT-SPR',
        name: 'Spray',
        retailPrice: 49_900,
        wholesalePrice: 37_900,
        stock: 60,
      },
    ],
  },
  {
    slug: 'aceite-hip-lift-up',
    name: 'Aceite Hip Lift Up',
    shortDescription: 'Aceite corporal para masajes en glúteos y caderas.',
    description:
      'Aceite corporal de rápida absorción para incluir en tu rutina de masajes y cuidado de la piel.',
    benefits: ['Rápida absorción', 'Piel suave e hidratada', 'Aroma agradable'],
    usage:
      'Aplicar unas gotas sobre la piel limpia y masajear en movimientos circulares hasta su absorción.',
    ingredients: 'Aceite de almendras dulces, aceite de jengibre, vitamina E.',
    warnings: `Uso externo. Realiza una prueba de sensibilidad antes del primer uso. ${keepAway}`,
    category: 'para-ella',
    brand: 'perky',
    audience: 'HER',
    invimaStatus: 'NOT_REQUIRED',
    disclaimer: COSMETIC_DISCLAIMER,
    placeholder: 'gotero',
    variants: [
      {
        sku: 'SYL-HIPL-30',
        name: '30 ml',
        retailPrice: 79_900,
        wholesalePrice: 59_900,
        stock: 25,
        weightGrams: 60,
      },
    ],
  },
  {
    slug: 'aceite-perky',
    name: 'Aceite Perky',
    shortDescription: 'Aceite corporal para el cuidado del busto.',
    description:
      'Aceite corporal para masajes en el área del busto, que deja la piel suave e hidratada.',
    benefits: ['Hidratación profunda', 'Textura ligera', 'Ideal para masajes diarios'],
    usage: 'Aplicar unas gotas y masajear suavemente hasta su absorción, una vez al día.',
    ingredients: 'Aceite de almendras, aceite de rosa mosqueta, vitamina E.',
    warnings: `Uso externo. ${keepAway}`,
    category: 'para-ella',
    brand: 'perky',
    audience: 'HER',
    invimaStatus: 'NOT_REQUIRED',
    disclaimer: COSMETIC_DISCLAIMER,
    featured: true,
    placeholder: 'gotero',
    variants: [
      {
        sku: 'SYL-PERKY-30',
        name: '30 ml',
        retailPrice: 79_900,
        wholesalePrice: 59_900,
        stock: 30,
        weightGrams: 60,
      },
    ],
  },
  {
    slug: 'true-fem',
    name: 'True Fem',
    shortDescription: 'Suplemento con extractos vegetales para el bienestar femenino.',
    description:
      'Suplemento en cápsulas con extractos vegetales y vitaminas, pensado para el bienestar femenino.',
    benefits: ['Extractos vegetales y vitaminas', 'Una toma al día', 'Presentación para 2 meses'],
    usage: 'Tomar 1 cápsula al día con agua.',
    ingredients: 'Extracto de maca, extracto de Dong Quai, vitamina B6, ácido fólico.',
    warnings: `${pregnancy} ${keepAway}`,
    category: 'para-ella',
    brand: 'true-fem',
    audience: 'HER',
    invimaStatus: 'IN_PROCESS',
    disclaimer: SUPPLEMENT_DISCLAIMER,
    featured: true,
    placeholder: 'frasco',
    variants: [
      {
        sku: 'SYL-TFEM-60',
        name: '60 cápsulas',
        retailPrice: 119_900,
        wholesalePrice: 89_900,
        stock: 45,
      },
    ],
  },
  {
    slug: 'crema-neuropatia',
    name: 'Crema Neuropatía',
    shortDescription: 'Crema de masaje para pies y manos.',
    description:
      'Crema de uso tópico con sensación refrescante, para masajear pies y manos al final del día.',
    benefits: ['Sensación refrescante', 'No deja la piel grasosa', 'Uso tópico'],
    usage:
      'Aplicar una capa delgada sobre pies o manos y masajear hasta su absorción, 2 a 3 veces al día.',
    ingredients: 'Mentol, alcanfor, aceite de árnica, manteca de karité.',
    warnings: `Uso externo. No aplicar sobre heridas ni mucosas. ${keepAway}`,
    category: 'alivio-y-neuropatia',
    brand: 'flujovital',
    audience: 'UNISEX',
    invimaStatus: 'REGISTERED',
    invimaCode: 'DEMO-NSOC-0002',
    disclaimer: COSMETIC_DISCLAIMER,
    featured: true,
    placeholder: 'tubo',
    variants: [
      {
        sku: 'SYL-CNEU-120',
        name: '120 g',
        retailPrice: 69_900,
        wholesalePrice: 52_900,
        stock: 50,
        weightGrams: 140,
      },
    ],
  },
  {
    slug: 'allicarp-neuropatia',
    name: 'Allicarp Neuropatía',
    shortDescription: 'Suplemento con vitaminas del complejo B y ácido alfa lipoico.',
    description: 'Suplemento en cápsulas con vitaminas del complejo B y ácido alfa lipoico.',
    benefits: ['Vitaminas del complejo B', 'Ácido alfa lipoico', 'Una cápsula al día'],
    usage: 'Tomar 1 cápsula al día con una comida.',
    ingredients: 'Ácido alfa lipoico, vitamina B1, vitamina B6, vitamina B12.',
    warnings: `${pregnancy} ${keepAway}`,
    category: 'alivio-y-neuropatia',
    brand: 'flujovital',
    audience: 'UNISEX',
    invimaStatus: 'REGISTERED',
    invimaCode: 'DEMO-SD-0003',
    disclaimer: SUPPLEMENT_DISCLAIMER,
    placeholder: 'frasco',
    variants: [
      {
        sku: 'SYL-ALLI-30',
        name: '30 cápsulas',
        retailPrice: 89_900,
        wholesalePrice: 67_900,
        stock: 40,
      },
    ],
  },
  {
    slug: 'serum-facial-rejuvenecedor',
    name: 'Sérum facial rejuvenecedor',
    shortDescription: 'Sérum con ácido hialurónico y vitamina C.',
    description:
      'Sérum facial de textura ligera con ácido hialurónico y vitamina C para tu rutina de día y de noche.',
    benefits: [
      'Hidratación ligera',
      'Con ácido hialurónico y vitamina C',
      'Para todo tipo de piel',
    ],
    usage:
      'Aplicar 3 a 4 gotas sobre el rostro limpio, mañana y noche. En el día, usar protector solar.',
    ingredients: 'Ácido hialurónico, vitamina C estabilizada, niacinamida, glicerina.',
    warnings: `Uso externo. Evitar el contacto con los ojos. ${keepAway}`,
    category: 'skincare',
    brand: null,
    audience: 'UNISEX',
    invimaStatus: 'REGISTERED',
    invimaCode: 'DEMO-NSOC-0004',
    disclaimer: COSMETIC_DISCLAIMER,
    placeholder: 'gotero',
    variants: [
      {
        sku: 'SYL-SERUM-30',
        name: '30 ml',
        retailPrice: 74_900,
        compareAtPrice: 89_900,
        wholesalePrice: 55_900,
        stock: 35,
        weightGrams: 70,
      },
    ],
  },
  {
    slug: 'smoothing-solution-vellos-encarnados',
    name: 'Smoothing Solution vellos encarnados',
    shortDescription: 'Solución para después de la depilación.',
    description:
      'Solución tónica para aplicar después de la depilación o el afeitado, que ayuda a mantener la piel lisa.',
    benefits: ['Piel lisa después de depilar', 'Uso en cuerpo y rostro', 'Aplicación con algodón'],
    usage: 'Aplicar con un algodón sobre la zona depilada una vez al día, en la noche.',
    ingredients: 'Ácido salicílico, ácido glicólico, extracto de hamamelis, aloe vera.',
    warnings: `Uso externo. No aplicar sobre piel irritada. Usar protector solar. ${keepAway}`,
    category: 'skincare',
    brand: null,
    audience: 'UNISEX',
    invimaStatus: 'NOT_REGISTERED',
    disclaimer: COSMETIC_DISCLAIMER,
    placeholder: 'gotero',
    variants: [
      {
        sku: 'SYL-SMOOTH-50',
        name: '50 ml',
        retailPrice: 59_900,
        wholesalePrice: 44_900,
        stock: 30,
        weightGrams: 90,
      },
    ],
  },
  {
    slug: 'sauco-negro-vitamina-c-zinc',
    name: 'Saúco Negro con Vitamina C y Zinc',
    shortDescription: 'Saúco negro, vitamina C y zinc en cápsulas.',
    description: 'Suplemento con extracto de saúco negro, vitamina C y zinc para tu rutina diaria.',
    benefits: ['Vitamina C y zinc', 'Extracto de saúco negro', 'Presentación para 2 meses'],
    usage: 'Tomar 1 cápsula al día con agua.',
    ingredients: 'Extracto de saúco negro (Sambucus nigra), vitamina C, zinc, cápsula vegetal.',
    warnings: `${pregnancy} ${keepAway}`,
    category: 'bienestar-y-defensas',
    brand: null,
    audience: 'UNISEX',
    invimaStatus: 'REGISTERED',
    invimaCode: 'DEMO-SD-0005',
    disclaimer: SUPPLEMENT_DISCLAIMER,
    featured: true,
    placeholder: 'frasco',
    variants: [
      {
        sku: 'SYL-SAUCO-60',
        name: '60 cápsulas',
        retailPrice: 64_900,
        wholesalePrice: 48_900,
        stock: 80,
      },
    ],
  },
  {
    slug: 'blood-sugar-complex',
    name: 'Blood Sugar Complex',
    shortDescription: 'Canela, cromo y extractos vegetales en cápsulas.',
    description:
      'Suplemento con canela, cromo y extractos vegetales, como complemento de una alimentación balanceada.',
    benefits: ['Canela y cromo', 'Extractos vegetales', 'Dos tomas al día'],
    usage: 'Tomar 1 cápsula dos veces al día, con el desayuno y el almuerzo.',
    ingredients: 'Extracto de canela, picolinato de cromo, extracto de gymnema, berberina.',
    warnings: `No reemplaza ningún tratamiento médico. ${pregnancy} ${keepAway}`,
    category: null, // uncategorized on purpose: appears only in "Todos los productos"
    brand: 'flujovital',
    audience: 'UNISEX',
    invimaStatus: 'NOT_REGISTERED',
    disclaimer: SUPPLEMENT_DISCLAIMER,
    placeholder: 'frasco',
    variants: [
      {
        sku: 'SYL-BSC-60',
        name: '60 cápsulas',
        retailPrice: 99_900,
        wholesalePrice: 74_900,
        stock: 25,
      },
    ],
  },
  {
    slug: 'wild-mentas-energia',
    name: 'WILD mentas energía',
    shortDescription: 'Mentas con cafeína para llevar en el bolsillo.',
    description:
      'Mentas con cafeína y vitaminas del complejo B en una lata práctica para llevar a donde vayas.',
    benefits: ['Con cafeína y vitaminas B', 'Lata de bolsillo', 'Tres sabores'],
    usage: 'Consumir 1 a 2 mentas cuando lo necesites. No exceder 6 mentas al día.',
    ingredients: 'Sorbitol, cafeína, vitaminas B3, B6 y B12, saborizantes.',
    warnings:
      'Contiene cafeína. No recomendado para menores de edad, embarazadas ni personas sensibles a la cafeína.',
    category: 'energia',
    brand: 'wild',
    audience: 'UNISEX',
    invimaStatus: 'NOT_REQUIRED',
    disclaimer: 'Alimento con cafeína. Consumir con moderación.',
    featured: true,
    placeholder: 'lata',
    variants: [
      {
        sku: 'SYL-WILD-MENTA',
        name: 'Menta',
        retailPrice: 12_900,
        wholesalePrice: 9_500,
        wholesaleMinQty: 12,
        stock: 120,
        weightGrams: 30,
      },
      {
        sku: 'SYL-WILD-SANDIA',
        name: 'Sandía',
        retailPrice: 12_900,
        wholesalePrice: 9_500,
        wholesaleMinQty: 12,
        stock: 100,
        weightGrams: 30,
      },
      {
        sku: 'SYL-WILD-FRUTOS',
        name: 'Frutos rojos',
        retailPrice: 12_900,
        wholesalePrice: 9_500,
        wholesaleMinQty: 12,
        stock: 90,
        weightGrams: 30,
      },
    ],
  },
  {
    slug: 'interior-detailer-carro',
    name: 'Interior Detailer para carro',
    shortDescription: 'Limpiador para tablero, plásticos y tapicería.',
    description:
      'Limpiador en spray para el interior del carro: tablero, plásticos, vinilos y tapicería. Deja acabado mate y aroma fresco.',
    benefits: ['Acabado mate sin brillo grasoso', 'Para plásticos, vinilo y tela', 'Aroma fresco'],
    usage:
      'Aplicar sobre un paño de microfibra y limpiar la superficie. No aplicar directamente sobre pantallas.',
    warnings: `No ingerir. Evitar el contacto con los ojos. ${keepAway}`,
    category: 'hogar-y-carro',
    brand: null,
    audience: 'UNISEX',
    invimaStatus: 'NOT_REQUIRED',
    disclaimer: 'Producto de limpieza. No es apto para consumo humano.',
    placeholder: 'spray',
    variants: [
      {
        sku: 'SYL-INTDET-500',
        name: '500 ml',
        retailPrice: 39_900,
        wholesalePrice: 29_900,
        stock: 40,
        weightGrams: 550,
      },
    ],
  },
  {
    slug: 'gel-potenciador-intimo',
    name: 'Gel potenciador íntimo (ejemplo +18)',
    shortDescription: 'Producto de ejemplo para mayores de 18 años.',
    description:
      'Producto de ejemplo marcado como +18 para mostrar la verificación de edad y las imágenes borrosas en los listados.',
    benefits: ['Uso externo', 'Textura en gel', 'Empaque discreto disponible'],
    usage: 'Aplicar una pequeña cantidad en la zona externa.',
    ingredients: 'Agua, glicerina, extracto de jengibre, mentol.',
    warnings: `Solo para mayores de 18 años. Uso externo. Suspender si hay irritación. ${keepAway}`,
    category: 'potenciadores',
    brand: null,
    audience: 'UNISEX',
    isAdult: true,
    invimaStatus: 'NOT_REGISTERED',
    disclaimer: COSMETIC_DISCLAIMER,
    placeholder: 'tubo',
    variants: [
      {
        sku: 'SYL-GEL18-30',
        name: '30 ml',
        retailPrice: 54_900,
        wholesalePrice: 41_900,
        stock: 20,
        weightGrams: 50,
      },
    ],
  },
];

const draft = (title: string, body: string) =>
  `# ${title}\n\n> Borrador de ejemplo. Debe revisarlo un asesor legal antes de publicar la tienda.\n\n${body}`;

export const legalTexts = {
  legalTerms: draft(
    'Términos y condiciones',
    'Al comprar en Sol y Luna Store aceptas estos términos. Los precios están en pesos colombianos e incluyen los impuestos aplicables. El envío es gratis a todo el país.',
  ),
  legalPrivacy: draft(
    'Política de privacidad y tratamiento de datos personales',
    'En cumplimiento de la Ley 1581 de 2012 y el Decreto 1377 de 2013, Sol y Luna Store trata tus datos personales solo para gestionar tus pedidos, tu cuenta y, si lo autorizas, enviarte información comercial. Puedes conocer, actualizar, rectificar y suprimir tus datos escribiendo a nuestro correo de contacto.',
  ),
  legalWithdrawal: draft(
    'Derecho de retracto y garantías',
    'De acuerdo con la Ley 1480 de 2011 (Estatuto del Consumidor), puedes ejercer el derecho de retracto dentro de los 5 días hábiles siguientes a la entrega, siempre que el producto esté sellado y sin uso. Por razones de higiene y salud, no aplica para productos abiertos de cuidado personal o íntimo.',
  ),
  legalShipping: draft(
    'Política de envíos',
    'El envío es gratis a toda Colombia. Despachamos en 1 a 2 días hábiles después de confirmar el pago y te enviamos la guía de la transportadora por correo. Puedes pedir empaque discreto en el checkout.',
  ),
  legalReturns: draft(
    'Política de devoluciones',
    'Si tu pedido llega con un defecto o no corresponde a lo que compraste, escríbenos dentro de los 5 días hábiles siguientes a la entrega con fotos del producto y del empaque.',
  ),
};
