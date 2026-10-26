import type { ComponentPropsWithRef } from "react";
import styles from "./ui.module.css";

type CardProps = (
  | (ComponentPropsWithRef<"div"> & { as?: "div" })
  | (ComponentPropsWithRef<"article"> & { as: "article" })
  | (ComponentPropsWithRef<"section"> & { as: "section" })
) & { variant?: "normal" | "interactive" | "sunken" };

export function Card(props: CardProps) {
  if (props.as === "article" || props.as === "section") {
    const { as: Element, variant = "normal", className = "", ...rest } = props;
    return <Element {...rest} className={`${styles.card} ${variant === "normal" ? "" : styles[variant]} ${className}`} />;
  }
  const { as: Element = "div", variant = "normal", className = "", ...rest } = props;
  return <Element {...rest} className={`${styles.card} ${variant === "normal" ? "" : styles[variant]} ${className}`} />;
}
