import type { ComponentPropsWithRef } from "react";
import styles from "./ui.module.css";

type ButtonProps = ComponentPropsWithRef<"button"> & {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "destructive" | "destructive-ghost" | "header-action" | "chip" | "tab";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  selected?: boolean;
} & ({ iconOnly: true; "aria-label": string } | { iconOnly?: false });

export function Button({ variant = "primary", size = "md", loading = false, selected = false, iconOnly = false, disabled, className = "", children, type = "button", ...props }: ButtonProps) {
  return <button {...props} type={type} disabled={disabled || loading} data-selected={selected || undefined} aria-pressed={props["aria-pressed"] ?? (variant === "chip" ? selected : undefined)} aria-busy={loading || props["aria-busy"]} className={`${styles.button} ${styles[variant]} ${styles[size]} ${iconOnly ? styles.iconOnly : ""} ${className}`}>
    {loading && <span aria-hidden="true" className={styles.spinner} />}{children}
  </button>;
}
