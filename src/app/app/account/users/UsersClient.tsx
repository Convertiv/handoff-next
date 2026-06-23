'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { handoffApiUrl } from '../../../lib/api-path';
import type { UserRowDto } from '../../../lib/server/admin-users';
import { Button } from '../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../../components/ui/dialog';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';

async function fetchUsers(): Promise<UserRowDto[]> {
  const res = await fetch(handoffApiUrl('/api/handoff/admin/users'), { credentials: 'include' });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export default function UsersClient({ initialUsers }: { initialUsers: UserRowDto[] }) {
  const router = useRouter();
  const [users, setUsers] = useState(initialUsers);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const refresh = () => {
    startTransition(async () => {
      try {
        const next = await fetchUsers();
        setUsers(next);
        router.refresh();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Failed to load users');
      }
    });
  };

  const handleInvite = () => {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const res = await fetch(handoffApiUrl('/api/handoff/admin/invite'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Invite failed');
        return;
      }
      setInviteOpen(false);
      const sentTo = inviteEmail;
      setInviteEmail('');
      setInviteRole('member');
      setSuccess(`Invite sent to ${sentTo}. They'll receive an email with a link to set their password.`);
      refresh();
    });
  };

  const handleResend = (user: UserRowDto) => {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const res = await fetch(handoffApiUrl('/api/handoff/admin/resend-invite'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Resend failed');
        return;
      }
      setSuccess(`Invite resent to ${user.email}.`);
    });
  };

  const handleDelete = (id: string) => {
    if (!confirm('Remove this user? They will no longer be able to sign in.')) return;
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const res = await fetch(handoffApiUrl('/api/handoff/admin/remove'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: id }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Remove failed');
        return;
      }
      refresh();
    });
  };

  const handleRoleChange = (id: string, role: 'admin' | 'member') => {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const res = await fetch(handoffApiUrl('/api/handoff/admin/role'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: id, role }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Update failed');
        return;
      }
      refresh();
    });
  };

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Users</h1>
          <p className="text-sm text-muted-foreground">Invite members, assign roles, and remove accounts.</p>
        </div>
        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogTrigger asChild>
            <Button>Invite user</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invite user</DialogTitle>
              <DialogDescription>They will receive an email with a link to set their password.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="colleague@company.com"
                />
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as 'admin' | 'member')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setInviteOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleInvite} disabled={pending || !inviteEmail.trim()}>
                Send invite
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {success ? (
        <p className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
          {success}
        </p>
      ) : null}

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Verified</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-medium">{u.name ?? '-'}</TableCell>
                <TableCell>{u.email}</TableCell>
                <TableCell>
                  <Select
                    value={u.role}
                    onValueChange={(v) => {
                      const next = v as 'admin' | 'member';
                      if (next !== u.role) handleRoleChange(u.id, next);
                    }}
                  >
                    <SelectTrigger className="w-[120px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="member">Member</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="text-muted-foreground">{u.emailVerified ? 'Yes' : 'Pending'}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    {!u.emailVerified && (
                      <Button variant="ghost" size="sm" disabled={pending} onClick={() => handleResend(u)}>
                        Resend invite
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDelete(u.id)}>
                      Remove
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
