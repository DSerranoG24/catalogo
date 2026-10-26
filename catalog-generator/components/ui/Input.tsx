import type { ComponentPropsWithRef } from "react";
import styles from "./ui.module.css";

type InputProps = ComponentPropsWithRef<"input"> & { error?: boolean };
type TextareaProps = ComponentPropsWithRef<"textarea"> & { error?: boolean };

export function Input({ error, className = "", ...props }: InputProps) {
  return <input {...props} aria-invalid={error || props["aria-invalid"]} className={`${styles.input} ${className}`} />;
}

export function Textarea({ error, className = "", ...props }: TextareaProps) {
  return <textarea {...props} aria-invalid={error || props["aria-invalid"]} className={`${styles.input} ${styles.textarea} ${className}`} />;
}
