declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

// Minimal typings for react-dom/client to support local builds without
// fetching the official @types package in restricted environments.
declare module 'react-dom/client' {
  import type { ReactNode } from 'react';

  interface Root {
    render(children: ReactNode): void;
    unmount(): void;
  }

  interface RootOptions {
    identifierPrefix?: string;
    onRecoverableError?: (error: Error) => void;
  }

  export function createRoot(
    container: Element | DocumentFragment,
    options?: RootOptions
  ): Root;
}
