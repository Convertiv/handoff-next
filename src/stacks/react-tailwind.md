# React + Tailwind Stack Guide

## Component Structure

```
components/
  button/
    button.handoff.ts     — declaration (metadata, properties, previews, entries)
    Button.tsx            — React component
    style.scss            — optional additional styles (Tailwind handles most styling)
    dist/                 — built artifacts (committed to git)
```

## Declaration File

```ts
import { defineReactComponent } from 'handoff-app';

export default defineReactComponent({
  id: 'button',
  title: 'Button',
  description: 'Primary action button.',
  group: 'atoms',
  type: 'element',
  entries: {
    component: './Button.tsx',
  },
  properties: {
    label: { type: 'text', default: 'Click me' },
    variant: { type: 'select', options: ['primary', 'secondary', 'ghost'], default: 'primary' },
    size: { type: 'select', options: ['sm', 'md', 'lg'], default: 'md' },
    disabled: { type: 'boolean', default: false },
  },
  previews: {
    default: { title: 'Default', values: { label: 'Button', variant: 'primary' } },
    secondary: { title: 'Secondary', values: { label: 'Button', variant: 'secondary' } },
  },
});
```

## React Component Conventions

- Functional components with TypeScript props
- Props shape matches the `properties` schema in the declaration
- Use `class-variance-authority` (CVA) for variant management when components have multiple variants
- `cn()` utility (clsx + tailwind-merge) for conditional class merging
- Export default the component

```tsx
import { cn } from '@/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
      },
      size: {
        sm: 'h-9 px-3 text-sm',
        md: 'h-10 px-4',
        lg: 'h-11 px-8 text-lg',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  }
);

interface ButtonProps extends VariantProps<typeof buttonVariants> {
  label: string;
  disabled?: boolean;
  className?: string;
}

export default function Button({ label, variant, size, disabled, className }: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled}
      type="button"
    >
      {label}
    </button>
  );
}
```

## Tailwind Conventions

- Use Tailwind CSS v4 with `@theme {}` blocks for design tokens
- Define custom tokens in the project's token CSS file — reference as `var(--color-primary)` or via Tailwind utilities
- Avoid arbitrary values (`w-[327px]`) — use token-backed utilities
- Use `@apply` sparingly — prefer composition over utility extraction
- Responsive: mobile-first (`sm:`, `md:`, `lg:`)

## Design Tokens

Figma tokens export to CSS custom properties. Reference in Tailwind config via `@theme`:

```css
@theme {
  --color-primary: oklch(55% 0.2 250);
  --font-heading: "Inter", sans-serif;
  --radius-md: 0.5rem;
}
```

Then use as Tailwind utilities: `bg-primary`, `font-heading`, `rounded-md`.

## Vite Hook Expectations

- `cssBuildConfig` — handles Tailwind CSS v4 via `@tailwindcss/postcss` plugin
- `clientBuildConfig` — React JSX transform, resolve `@/` alias to project root

## Key Libraries

- `tailwindcss` v4+ with `@tailwindcss/postcss`
- `class-variance-authority` for variant patterns
- `clsx` + `tailwind-merge` for conditional classes
- `lucide-react` for icons (tree-shakable)
