import type { HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide',
  {
    variants: {
      variant: {
        default: 'bg-muted text-muted-foreground',
        secondary: 'bg-purple-100 text-purple-600',
        success: 'bg-emerald-100 text-emerald-800',
        warning: 'bg-amber-100 text-amber-800',
        error: 'bg-rose-100 text-rose-800',
        outline: 'border border-border text-muted-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export function Badge({ variant = 'default', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        badgeVariants({ variant }),
        className
      )}
      {...props}
    />
  );
}

export { badgeVariants };
