import { DrizzleAdapter } from '@auth/drizzle-adapter';
import NextAuth, { type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import GitHub from 'next-auth/providers/github';
import Google from 'next-auth/providers/google';
import { eq } from 'drizzle-orm';
import { getDb } from './db';
import * as schema from './db/schema';
import { getMode } from './mode';
import { verifyPassword } from './passwords';

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
 * otherwise JWT + credentials (email/password in Postgres) for dynamic mode.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  pages: {
    signIn: '/login',
  },
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
      async authorize(credentials) {
        if (getMode() !== 'dynamic') return null;
        const conn = getDb();
        if (!conn) return null;
        const email = String(credentials?.email ?? '')
          .trim()
          .toLowerCase();
        const password = String(credentials?.password ?? '');
        if (!email || !password) return null;

        const [u] = await conn.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
        if (!u?.passwordHash) return null;
        const ok = await verifyPassword(password, u.passwordHash);
        if (!ok) return null;

        return {
          id: u.id,
          email: u.email,
          name: u.name ?? u.email,
          role: u.role ?? 'member',
          image: u.image,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.sub = (user as { id?: string }).id ?? token.sub;
        token.role = (user as { role?: string }).role ?? 'member';
        if (user.email) token.email = user.email;
      } else if (token.sub && token.role === undefined) {
        const conn = getDb();
        if (conn) {
          const [row] = await conn.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, token.sub as string)).limit(1);
          token.role = row?.role ?? 'member';
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.sub as string) ?? '';
        session.user.role = (token.role as string) ?? 'member';
      }
      return session;
    },
  },
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
});
