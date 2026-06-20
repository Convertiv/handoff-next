'use client';

import { FileText, LogOut, Terminal, UserRound } from 'lucide-react';
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
  const isLocal = !authEnabled;

  if (status === 'loading' && !isLocal) {
    return <div className="h-9 w-20 animate-pulse rounded-md bg-muted" aria-hidden />;
  }

  if (!isLocal && !session?.user) {
    return (
      <Button variant="outline" size="sm" asChild>
        <Link href="/login">Sign in</Link>
      </Button>
    );
  }

  const displayName = isLocal ? 'Dev User' : (session?.user?.name || session?.user?.email || 'User');
  const displayEmail = isLocal ? 'local@handoff.local' : (session?.user?.email || '');
  const displayRole = isLocal ? 'admin' : (session?.user?.role || 'member');
  const initial = displayName.slice(0, 1).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-medium">{initial}</span>
          <span className="max-w-[120px] truncate">{displayName}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal p-0">
          {!isLocal ? (
            <Link
              href="/account"
              className="flex flex-col space-y-1 rounded-sm px-2 py-1.5 hover:bg-accent hover:text-accent-foreground"
            >
              <p className="text-sm font-medium leading-none">{displayName}</p>
              <p className="text-xs leading-none text-muted-foreground">{displayEmail}</p>
              <Badge variant="secondary" className="mt-2 w-fit text-[10px]">
                {displayRole}
              </Badge>
            </Link>
          ) : (
            <div className="flex flex-col space-y-1 px-2 py-1.5">
              <p className="text-sm font-medium leading-none">{displayName}</p>
              <p className="text-xs leading-none text-muted-foreground">{displayEmail}</p>
              <Badge variant="secondary" className="mt-2 w-fit text-[10px]">
                {displayRole}
              </Badge>
            </div>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {displayRole === 'admin' ? (
          <>
            <DropdownMenuItem asChild>
              <Link href="/admin/users">Manage users</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/admin/builds">Builds</Link>
            </DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuItem asChild>
          <Link href="/admin/pages">
            <FileText className="mr-2 h-4 w-4" />
            Page Manager
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/developer/local-setup">
            <Terminal className="mr-2 h-4 w-4" />
            CLI docs
          </Link>
        </DropdownMenuItem>
        {!isLocal && (
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
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AuthControlsMobile() {
  const { authEnabled } = useAuthUi();
  const { data: session, status } = useSession();
  const router = useRouter();
  const isLocal = !authEnabled;

  if (status === 'loading' && !isLocal) {
    return <div className="h-9 w-full animate-pulse rounded-md bg-muted" aria-hidden />;
  }

  if (!isLocal && !session?.user) {
    return (
      <Link
        href="/login"
        className="rounded-md px-4 py-2 text-sm text-foreground hover:bg-accent/50 hover:text-accent-foreground"
      >
        Sign in
      </Link>
    );
  }

  const displayEmail = isLocal ? 'local@handoff.local' : (session?.user?.email || '');
  const displayName = isLocal ? 'Dev User' : (session?.user?.name || session?.user?.email || 'User');
  const displayRole = isLocal ? 'admin' : (session?.user?.role || 'member');

  return (
    <div className="flex flex-col gap-2 border-t pt-4">
      <div className="flex items-center gap-2 px-4 text-sm text-muted-foreground">
        <UserRound className="h-4 w-4" />
        <span className="truncate">{isLocal ? 'Dev User' : displayEmail}</span>
      </div>
      {!isLocal && (
        <Link href="/account" className="rounded-md px-4 py-2 text-sm hover:bg-accent/50">
          Account settings
        </Link>
      )}
      {displayRole === 'admin' ? (
        <>
          <Link href="/admin/users" className="rounded-md px-4 py-2 text-sm hover:bg-accent/50">
            Manage users
          </Link>
          <Link href="/admin/builds" className="rounded-md px-4 py-2 text-sm hover:bg-accent/50">
            Builds
          </Link>
        </>
      ) : null}
      <Link href="/admin/pages" className="rounded-md px-4 py-2 text-sm hover:bg-accent/50">
        Page Manager
      </Link>
      {!isLocal && (
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
      )}
    </div>
  );
}
