'use client';

import { useState } from 'react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { handoffApiUrl } from '../../lib/api-path';

export type AccountUserInfo = {
  id: string;
  name: string;
  email: string;
  image: string;
  role: string;
};

function initials(name: string, email: string): string {
  if (name) return name.slice(0, 2).toUpperCase();
  return email.slice(0, 2).toUpperCase();
}

export default function AccountClient({ user }: { user: AccountUserInfo }) {
  const [name, setName] = useState(user.name);
  const [imageUrl, setImageUrl] = useState(user.image);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

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

  const avatarInitials = initials(name || user.name, user.email);

  return (
    <div className="space-y-5">
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
    </div>
  );
}
