import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold transition-[transform,background,border-color,box-shadow,filter] focus-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-60 select-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'primary-btn font-bold',
        secondary:
          'secondary-btn border border-ice-300/15 bg-ink-850/65 text-ice-100',
        ghost:
          'bg-transparent text-ice-200/70 hover:bg-ice-300/[.06] hover:text-white',
        outline:
          'border border-ice-300/15 bg-transparent text-ice-100 hover:border-ice-300/30 hover:bg-ice-300/[.06]',
        destructive:
          'border border-red-400/20 bg-red-400/[.1] text-red-200 hover:bg-red-400/[.16]',
        link: 'bg-transparent text-ice-300 underline-offset-4 hover:text-ice-100 hover:underline shadow-none',
      },
      size: {
        sm: 'h-9 px-3.5 text-xs',
        md: 'h-11 px-4.5 text-sm',
        lg: 'h-12 px-6 text-sm',
        icon: 'size-9 p-0',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export type ButtonGlow = 'blue' | 'purple' | 'pink' | 'success' | 'warn';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  loading?: boolean;
  glow?: ButtonGlow;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      asChild = false,
      leftIcon,
      rightIcon,
      loading = false,
      glow: _glow,
      disabled,
      children,
      type = "button",
      ...props
    },
    ref,
  ) => {
    const mappedVariant = variant === "default" ? "primary" : variant;
    const mappedSize = size === "default" ? "md" : size;
    const isDisabled = disabled || loading;

    if (asChild) {
      return (
        <Slot
          ref={ref}
          className={cn(buttonVariants({ variant: mappedVariant, size: mappedSize }), className)}
          {...props}
        >
          {children}
        </Slot>
      );
    }

    return (
      <button
        ref={ref}
        type={type}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        className={cn(buttonVariants({ variant: mappedVariant, size: mappedSize }), className)}
        {...props}
      >
        {loading ? (
          <span
            className="inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent"
            aria-hidden="true"
          />
        ) : leftIcon ? (
          <span className="inline-flex shrink-0 mr-2">{leftIcon}</span>
        ) : null}
        {children}
        {rightIcon && !loading ? <span className="inline-flex shrink-0 ml-2">{rightIcon}</span> : null}
      </button>
    );
  }
);
Button.displayName = "Button";

const buttonVariantsWrapper = (props?: any) => {
  const variant = props?.variant === "default" ? "primary" : props?.variant;
  const size = props?.size === "default" ? "md" : props?.size;
  return buttonVariants({ ...props, variant, size });
};

export { Button, buttonVariantsWrapper as buttonVariants };


