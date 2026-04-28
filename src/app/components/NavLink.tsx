'use client';

import * as React from 'react';
import Link, { LinkProps } from 'next/link';
import { usePathname } from 'next/navigation';

const NavLink = React.forwardRef<
  HTMLAnchorElement,
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps> &
    LinkProps & {
      children?: React.ReactNode;
      activeClassName?: string;
    }
>(({ activeClassName = 'is-selected', className, children, ...props }, ref) => {
  const pathname = usePathname();

  return (
    <Link {...props} ref={ref} className={`${className} ${pathname.startsWith(props.href.toString()) ? activeClassName : ''}`}>
      {children}
    </Link>
  );
});

NavLink.displayName = 'NavLink';

export default NavLink;
