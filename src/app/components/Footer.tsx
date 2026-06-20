import { ClientConfig } from '@handoff/types/config';
// Generated at build time — falls back when not yet built
let BUILD_VERSION = '2.0.0-alpha';
try {
  const meta = await import('../lib/generated/build-meta');
  BUILD_VERSION = meta.BUILD_VERSION;
} catch {
  // pre-build or dev mode before first `npm run build:app`
}

interface FooterProps {
  config: ClientConfig;
}

function Footer({ config }: FooterProps) {
  const date = new Date();
  return (
    <footer>
      <p className="fw-light py-6 text-center text-xs text-gray-400 dark:text-gray-500">
        Copyright {config?.app?.client}, {date.getFullYear()}
        {config?.app?.attribution && (
          <>
            {' '}
            - Powered By{' '}
            <a href="https://www.handoff.com/" target="_blank" rel="noreferrer">
              Handoff
            </a>
          </>
        )}
        <span className="ml-3 font-mono opacity-50" title="Registry build version">
          v{BUILD_VERSION}
        </span>
        <span className="mx-2 opacity-30">·</span>
        <a
          href="/developer"
          className="font-mono opacity-50 hover:opacity-100 transition-opacity"
          title="Developer documentation"
        >
          Developer Docs
        </a>
      </p>
    </footer>
  );
}

export default Footer;
