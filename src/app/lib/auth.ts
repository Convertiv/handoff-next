import { DrizzleAdapter } from '@auth/drizzle-adapter';
import NextAuth, { type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import GitHub from 'next-auth/providers/github';
import Google from 'next-auth/providers/google';
import { getDb } from './db';
import * as schema from './db/schema';
import { getMode } from './mode';

function oauthProviders(): NextAuthConfig['providers'] {
  const list: NextAuthConfig['providers'] = [];
  if (process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET) {
    list.push(GitHub({ clientId: process.env.AUTH_GITHUB_ID, clientSecret: process.env.AUTH_GITHUB_SECRET }));
  }
  if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
    list.push(Google({ clientId: process.env.AUTH_GOOGLE_ID, clientSecret: process.env.AUTH_GOOGLE_SECRET }));
  }
  return list;
}

const db = typeof window === 'undefined' ? getDb() : null;
const oauth = typeof window === 'undefined' ? oauthProviders() : [];
const useDatabaseSession = Boolean(db && oauth.length > 0);

/**
 * NextAuth (Auth.js v5). OAuth + DB sessions when DB + OAuth env are configured;
 * otherwise JWT + credentials (HANDOFF_ADMIN_PASSWORD) for local admin.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  adapter:
    useDatabaseSession && db
      ? DrizzleAdapter(db, {
          usersTable: schema.users,
          accountsTable: schema.accounts,
          sessionsTable: schema.sessions,
          verificationTokensTable: schema.verificationTokens,
        })
      : undefined,
  session: { strategy: useDatabaseSession ? 'database' : 'jwt' },
  providers: [
    ...oauth,
    Credentials({
      id: 'handoff-credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      authorize(credentials) {
        if (getMode() !== 'dynamic') return null;
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;
        const adminPassword = process.env.HANDOFF_ADMIN_PASSWORD;
        if (!email || !adminPassword || password !== adminPassword) return null;
        return { id: email, email, name: email };
      },
    }),
  ],
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
});
