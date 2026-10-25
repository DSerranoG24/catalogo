import Image from "next/image";
import type { CSSProperties } from "react";

type BrandLogoProps = {
  variant: "horizontal" | "icono";
  theme: "claro" | "oscuro";
  className?: string;
  iconSize?: number;
  nameRatio?: number;
  gapSize?: number;
};

export default function BrandLogo({ variant, theme, className, iconSize = 40, nameRatio = 0.65, gapSize = iconSize * 0.15 }: BrandLogoProps) {
  if (!Number.isFinite(iconSize) || iconSize <= 0 || !Number.isFinite(nameRatio) || nameRatio <= 0) {
    throw new Error("BrandLogo sizes must be positive finite numbers.");
  }
  const style: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: `${gapSize}px`,
    fontFamily: "var(--font-app-sans)",
    fontSize: `${iconSize * nameRatio}px`,
    fontWeight: 600,
    lineHeight: 1,
  };
  return (
    <span role="img" aria-label="Vitrinaya" data-theme={theme} className={className} style={style}>
      <Image
        src={theme === "oscuro" ? "/brand/icon-dark.svg" : "/brand/icon.svg"}
        alt=""
        aria-hidden="true"
        width={iconSize}
        height={iconSize}
        style={{ flexShrink: 0 }}
        unoptimized
      />
      {variant === "horizontal" && (
        <span aria-hidden="true" style={{ whiteSpace: "nowrap", color: theme === "oscuro" ? "#FFFFFF" : "var(--brand-forest)" }}>
          vitrina<span style={{ color: "var(--brand-coral)" }}>ya</span>
        </span>
      )}
    </span>
  );
}
