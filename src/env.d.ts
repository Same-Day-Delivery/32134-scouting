declare namespace App {
  interface Locals {
    /** Set by src/middleware.ts on every request. */
    authed: boolean;
  }
}
