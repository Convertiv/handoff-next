'use client';

import { useState } from 'react';
import Layout from '../../components/Layout/Main';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Separator } from '../../components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { handoffApiUrl } from '../../lib/api-path';
import type { AiEventRow, AiCostByUserRow } from '../../lib/db/queries';
import IntegrationsSection from './IntegrationsSection';

type UserInfo = {
  id: string;
  name: string;
  email: string;
  image: string;
  role: string;
};

function currency(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value);
}

function initials(name: string, email: string): string {
  if (name) return name.slice(0, 2).toUpperCase();
  return email.slice(0, 2).toUpperCase();
}

export default function AccountClient({
  config,
  menu,
  user,
  aiEvents,
  aiByUser,
  message,
}: {
  config: any;
  menu: any;
  user: UserInfo | null;
  aiEvents: AiEventRow[];
  aiByUser: AiCostByUserRow[];
  message?: string;
}) {
  const layoutMeta = { metaTitle: 'Account', metaDescription: 'Manage your profile and workspace settings' };
  const isAdmin = user?.role === 'admin';

  const [name, setName] = useState(user?.name ?? '');
  const [imageUrl, setImageUrl] = useState(user?.image ?? '');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const totalCost = aiEvents.reduce((s, e) => s + Number(e.estimatedCostUsd || 0), 0);

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch(handoffApiUrl('/api/account'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: name.trim(), image: imageUrl.trim() }),
      });
      if (res.ok) {
        setSaveMsg('Saved.');
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setSaveMsg(data.error ?? 'Failed to save.');
      }
    } catch {
      setSaveMsg('Network error.');
    } finally {
      setSaving(false);
    }
  };

  if (message) {
    return (
      <Layout config={config} menu={menu} current={null} metadata={layoutMeta}>
        <p className="text-sm text-muted-foreground">{message}</p>
      </Layout>
    );
  }

  if (!user) {
    return (
      <Layout config={config} menu={menu} current={null} metadata={layoutMeta}>
        <p className="text-sm text-muted-foreground">Not signed in.</p>
      </Layout>
    );
  }

  const avatarInitials = initials(name || user.name, user.email);

  return (
    <Layout config={config} menu={menu} current={null} metadata={layoutMeta}>
      <div className="mx-auto max-w-2xl space-y-8">
        <div>
          <h1 className="text-xl font-semibold">Account</h1>
          <p className="text-sm text-muted-foreground">Manage your profile and workspace settings.</p>
        </div>

        {/* Profile card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Profile</CardTitle>
            <CardDescription>Your name and avatar are visible to teammates.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Avatar preview */}
            <div className="flex items-center gap-4">
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt={name || user.email}
                  className="h-16 w-16 rounded-full object-cover ring-1 ring-border"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-xl font-semibold">
                  {avatarInitials}
                </div>
              )}
              <div>
                <p className="text-sm font-medium">{name || user.email}</p>
                <Badge variant="secondary" className="mt-1 text-[10px]">{user.role}</Badge>
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="email">Email</Label>
              <Input id="email" value={user.email} disabled className="bg-muted" />
              <p className="text-xs text-muted-foreground">Email cannot be changed here.</p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="name">Display name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                maxLength={100}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="image">Avatar URL</Label>
              <Input
                id="image"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://example.com/avatar.png"
                type="url"
              />
              <p className="text-xs text-muted-foreground">Link to an image (HTTPS). Leave blank to use initials.</p>
            </div>

            <div className="flex items-center gap-3">
              <Button onClick={handleSave} disabled={saving} size="sm">
                {saving ? 'Saving…' : 'Save changes'}
              </Button>
              {saveMsg && (
                <p className={`text-xs ${saveMsg === 'Saved.' ? 'text-green-600' : 'text-destructive'}`}>
                  {saveMsg}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Admin sections */}
        {isAdmin && (
          <>
            <Separator />

            {/* Integrations */}
            <div>
              <h2 className="mb-4 text-base font-semibold">Integrations</h2>
              <IntegrationsSection />
            </div>

            <Separator />

            {/* AI cost */}
            <div>
              <div className="mb-4 flex items-baseline justify-between">
                <h2 className="text-base font-semibold">AI Cost</h2>
                <span className="text-sm text-muted-foreground">Last 30 days — {currency(totalCost)}</span>
              </div>

              {aiByUser.length > 0 && (
                <Card className="mb-4">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">By user</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>User</TableHead>
                          <TableHead className="text-right">Calls</TableHead>
                          <TableHead className="text-right">Failed</TableHead>
                          <TableHead className="text-right">Cost</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {aiByUser.map((row, i) => (
                          <TableRow key={row.userId ?? `anon-${i}`}>
                            <TableCell className="text-sm">
                              {row.name || row.email || <span className="text-muted-foreground">Unknown</span>}
                            </TableCell>
                            <TableCell className="text-right text-sm">{row.calls}</TableCell>
                            <TableCell className="text-right text-sm">
                              {row.failedCalls > 0 ? (
                                <span className="text-destructive">{row.failedCalls}</span>
                              ) : '0'}
                            </TableCell>
                            <TableCell className="text-right text-sm font-medium">{currency(row.totalCostUsd)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}

              {aiEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground">No AI events in the last 30 days.</p>
              ) : (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Recent events</CardTitle>
                    <CardDescription>Up to 200 most recent AI calls (last 30 days).</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>User</TableHead>
                          <TableHead>Event</TableHead>
                          <TableHead>Model</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Cost</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {aiEvents.map((event) => (
                          <TableRow key={event.id}>
                            <TableCell className="text-xs text-muted-foreground">
                              {event.actorName || event.actorEmail || event.actorUserId || '—'}
                            </TableCell>
                            <TableCell className="text-xs">{event.eventType}</TableCell>
                            <TableCell className="text-xs">{event.model || '—'}</TableCell>
                            <TableCell>
                              <Badge variant={event.status === 'error' ? 'destructive' : 'outline'}>
                                {event.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right text-xs">
                              {currency(Number(event.estimatedCostUsd || 0))}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
