import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-ds-md text-body-strong transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:size-5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // The one primary action per screen or sheet.
        default: "bg-brand text-brand-ink hover:brightness-95",
        destructive: "bg-neg-bg text-neg-ink hover:brightness-95",
        outline:
          "border border-border-strong bg-surface-raised text-ink hover:bg-accent",
        secondary:
          "border border-border-strong bg-surface-raised text-ink hover:bg-accent",
        ghost: "text-ink hover:bg-accent hover:text-accent-foreground",
        // Text-only: Select, Manage and inline links.
        quiet: "text-brand-text hover:bg-accent",
        link: "text-brand-text underline-offset-4 hover:underline",
      },
      size: {
        default: "h-tap px-5",
        // Compact (36px) for inline actions inside cards; an invisible
        // extension keeps the tappable area at 44px.
        sm: "h-9 px-3.5 text-[15px] leading-5 after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']",
        lg: "h-tap px-8",
        icon: "h-tap w-tap",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
