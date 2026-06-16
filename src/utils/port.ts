import net from 'node:net';

export type ResolvePortOptions = {
  maxAttempts?: number;
  /** Ports already reserved for other services in this process */
  exclude?: Iterable<number>;
};

/** Try binding a single host; resolves true when the port is free on that address. */
function canBind(port: number, host: string, ipv6Only?: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen({ port, host, ipv6Only, exclusive: true });
  });
}

/**
 * Returns true when the port is free for a typical Node HTTP server.
 * Next.js dev binds to `::` (dual-stack); probing only 127.0.0.1 misses that.
 */
export async function isPortAvailable(port: number): Promise<boolean> {
  if (await canBind(port, '::', false)) return true;
  return canBind(port, '0.0.0.0');
}

/**
 * Pick the first free port starting at `preferred`.
 * Skips any ports listed in `exclude` (e.g. another local service we are about to bind).
 */
export async function resolveAvailablePort(
  preferred: number,
  { maxAttempts = 50, exclude = [] }: ResolvePortOptions = {}
): Promise<number> {
  const blocked = new Set(exclude);
  for (let i = 0; i < maxAttempts; i++) {
    const port = preferred + i;
    if (port > 65535) break;
    if (blocked.has(port)) continue;
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available port found starting from ${preferred}`);
}
