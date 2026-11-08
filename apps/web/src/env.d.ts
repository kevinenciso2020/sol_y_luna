declare namespace App {
  interface Locals {
    /** Set by the middleware on protected pages (/admin, /operador, /cuenta). */
    user: {
      id: string;
      email: string;
      name: string;
      role: 'ADMIN' | 'OPERATOR' | 'CUSTOMER';
      emailVerified: boolean;
      wholesaleStatus: string;
    } | null;
  }
}
