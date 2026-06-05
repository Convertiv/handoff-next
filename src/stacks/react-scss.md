# React + SCSS Stack Guide

## Component Structure

```
components/
  button/
    button.handoff.ts     — declaration (metadata, properties, previews, entries)
    Button.tsx            — React component
    style.scss            — component styles (BEM, imports shared tokens)
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
    scss: './style.scss',
  },
  properties: {
    label: { type: 'text', default: 'Click me' },
    variant: { type: 'select', options: ['primary', 'secondary', 'ghost'], default: 'primary' },
    size: { type: 'select', options: ['sm', 'md', 'lg'], default: 'md' },
    disabled: { type: 'boolean', default: false },
  },
  previews: {
    default: { title: 'Default', values: { label: 'Button', variant: 'primary' } },
  },
});
```

## React Component Conventions

- Functional components with TypeScript props
- Import SCSS module or global SCSS via `import './style.scss'`
- Use `classnames` / `clsx` for conditional class composition
- Props map 1:1 to declaration properties

```tsx
import clsx from 'clsx';
import './style.scss';

interface ButtonProps {
  label: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
}

export default function Button({ label, variant = 'primary', size = 'md', disabled }: ButtonProps) {
  return (
    <button
      className={clsx('button', `button--${variant}`, `button--${size}`, { 'button--disabled': disabled })}
      disabled={disabled}
      type="button"
    >
      {label}
    </button>
  );
}
```

## SCSS Conventions

- BEM methodology: `.block`, `.block__element`, `.block--modifier`
- Component root class matches component id: `.button { ... }`
- Import shared tokens/mixins at the top
- CSS custom properties for theming — avoid hard-coded hex values
- SCSS variables for internal component-level values only

```scss
@use '~/tokens' as *;

.button {
  display: inline-flex;
  align-items: center;
  padding: var(--spacing-btn-y) var(--spacing-btn-x);
  border-radius: var(--radius-md);
  font-family: var(--font-body);
  transition: background-color 0.2s;

  &--primary {
    background-color: var(--color-primary);
    color: var(--color-primary-foreground);

    &:hover { background-color: var(--color-primary-hover); }
  }

  &--secondary {
    background-color: var(--color-secondary);
    color: var(--color-secondary-foreground);
  }

  &--disabled {
    opacity: 0.5;
    pointer-events: none;
  }

  &--sm { font-size: 0.875rem; padding: 0.375rem 0.75rem; }
  &--lg { font-size: 1.125rem; padding: 0.75rem 1.5rem; }
}
```

## Design Tokens

Tokens from Figma export to `src/tokens/` as SCSS files and CSS custom properties:
- `_colors.scss` — color palette
- `_typography.scss` — font stacks, sizes
- `_spacing.scss` — spacing scale
- `_effects.scss` — shadows, radii

Import via `@use '~/tokens' as *` (resolved by Vite alias) or `@use '../../../tokens' as *`.

## Vite Hook Expectations

- `cssBuildConfig` — SCSS compilation with `sass` v2 modern API, load paths for shared tokens
- `clientBuildConfig` — React JSX transform, resolve `~/` alias to project src root
