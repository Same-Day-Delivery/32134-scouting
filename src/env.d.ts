import type { User } from './lib/users';

declare global {
  namespace App {
    interface Locals {
      /** The signed-in user, or null. Set by src/middleware.ts on every request. */
      user: User | null;
    }
  }
}

export {};
