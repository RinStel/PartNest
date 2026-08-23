import type { ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva("pn-button", {
  variants: {
    variant: {
      default: "pn-button--primary",
      primary: "pn-button--primary",
      secondary: "pn-button--secondary",
      outline: "pn-button--secondary",
      danger: "pn-button--danger",
      ghost: "pn-button--ghost",
      icon: "pn-button--icon pn-button--ghost",
    },
  },
  defaultVariants: { variant: "default" },
});

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant }), className)} {...props} />;
}
