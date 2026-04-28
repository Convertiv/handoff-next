'use client';

import { LogOut, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { useAuthUi } from '../context/AuthUiContext';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

export function AuthControls() {
  const { authEnabled } = useAuthUi();
  const { data: session, status } = useSession();
  const router = useRouter();

  if (!authEnabled) return null;

  if (status === 'loading') {
    return <div className="h-9 w-20 animate-pulse rounded-md bg-muted" aria-hidden />;
  }

  if (!session?.user) {
    return (
      <Button variant="outline" size="sm" asChild>
        <Link href="/login">Sign in</Link>
      </Button>
    );
  }

  const initial = (session.user.name || session.user.email || '?').slice(0, 1).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-medium">{initial}</span>
          <span className="max-w-[120px] truncate">{session.user.name || session.user.email}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">{session.user.name || 'User'}</p>
            <p className="text-xs leading-none text-muted-foreground">{session.user.email}</p>
            <Badge variant="secondary" className="mt-2 w-fit text-[10px]">
              {session.user.role}
            </Badge>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {session.user.role === 'admin' ? (
          <>
            <DropdownMenuItem asChild>
              <Link href="/admin/users">Manage users</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/admin/builds">Component builds</Link>
            </DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            void signOut({ redirect: false }).then(() => {
              router.push('/');
              router.refresh();
            });
          }}
        >
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AuthControlsMobile() {
  const { authEnabled } = useAuthUi();
  const { data: session, status } = useSession();
  const router = useRouter();

  if (!authEnabled) return null;

  if (status === 'loading') {
    return <div className="h-9 w-full animate-pulse rounded-md bg-muted" aria-hidden />;
  }

  if (!session?.user) {
    return (
      <Link
        href="/login"
        className="rounded-md px-4 py-2 text-sm text-foreground hover:bg-accent/50 hover:text-accent-foreground"
      >
        Sign in
      </Link>
    );
  }

  return (
    <div className="flex flex-col gap-2 border-t pt-4">
      <div className="flex items-center gap-2 px-4 text-sm text-muted-foreground">
        <UserRound className="h-4 w-4" />
        <span className="truncate">{session.user.email}</span>
      </div>
      {session.user.role === 'admin' ? (
        <>
          <Link href="/admin/users" className="rounded-md px-4 py-2 text-sm hover:bg-accent/50">
            Manage users
          </Link>
          <Link href="/admin/builds" className="rounded-md px-4 py-2 text-sm hover:bg-accent/50">
            Component builds
          </Link>
        </>
      ) : null}
      <Button
        variant="ghost"
        className="w-full justify-start font-normal"
        onClick={() => {
          void signOut({ redirect: false }).then(() => {
            router.push('/');
            router.refresh();
          });
        }}
      >
        <LogOut className="mr-2 h-4 w-4" />
        Sign out
      </Button>
    </div>
  );
}
