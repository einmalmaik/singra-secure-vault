import * as React from "react";
import { Badge as DnaBadge } from "@maunting/design-dna";
import type { BadgeProps as DnaBadgeProps } from "@maunting/design-dna";

export interface BadgeProps extends Omit<DnaBadgeProps, "variant" | "tone"> {
  variant?: "default" | "secondary" | "destructive" | "outline";
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  const toneMap: Record<string, any> = {
    default: "mint",
    secondary: "ice",
    destructive: "danger",
    outline: "neutral",
  };
  return <DnaBadge className={className} tone={toneMap[variant]} {...props} />;
}

export { Badge };

