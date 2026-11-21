import * as React from 'react';
import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-[transform,background-color,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-mint-hover hover:shadow-[0_10px_30px_-10px_rgb(163_247_181/0.55)]',
        destructive: 'bg-destructive text-void hover:brightness-110',
        outline: 'border border-white/15 bg-white/[0.04] text-foreground hover:border-white/30 hover:bg-white/10',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-white/15',
        ghost: 'hover:bg-white/10',
        link: 'text-primary underline-offset-4 hover:translate-y-0 hover:underline',
        white: 'bg-white text-void hover:bg-white/90',
      },
      size: { default: 'h-10 px-4 py-2', sm: 'h-8 px-3', lg: 'h-12 px-6 text-base rounded-2xl', xl: 'h-16 px-8 text-xl rounded-2xl', icon: 'size-10' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export function Button({
  className, variant, size, asChild = false, ...props
}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button';
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { buttonVariants };
