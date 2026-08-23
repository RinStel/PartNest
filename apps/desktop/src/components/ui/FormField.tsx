import type { ReactNode } from "react";

export function FormField({ label, htmlFor, error, children }: { label: string; htmlFor: string; error?: string; children: ReactNode }): JSX.Element {
  const errorId = error ? `${htmlFor}-error` : undefined;
  return <div className="pn-form-field">
    <label className="pn-form-field__label" htmlFor={htmlFor}>{label}</label>
    {children}
    {error && <span id={errorId} className="pn-form-field__error" role="alert">{error}</span>}
  </div>;
}
