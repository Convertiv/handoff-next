import { DownloadTokens } from '../../../components/DownloadTokens';
import { ProvenanceBadge } from '../../../components/Foundations/ProvenanceBadge';
import { TokenOutputTabs } from '../../../components/Foundations/TokenOutputTabs';
import { InlineEditHeader } from '../../../components/InlineEdit/InlineEditHeader';
import Layout from '../../../components/Layout/Main';
import AnchorNav from '../../../components/Navigation/AnchorNav';
import PrevNextNav from '../../../components/Navigation/PrevNextNav';
import { fetchFoundationDocPageMarkdownAsync, getClientRuntimeConfig } from '../../../components/util';
import { fetchDtcgManifest, fetchDtcgTokenStrings } from '../../../components/util/dtcg';

interface GridTokenMap {
  columns: number;
  gutter: { rem: string; px: number };
  gutterHalf: { rem: string; px: number };
  breakpoints: Array<{ key: string; label: string; bp: string; bpPx: number; container: string; containerPx: number }>;
}

function remToPx(rem: string): number {
  return Math.round(parseFloat(rem) * 16);
}

function parseGridTokens(dtcgJson: string): GridTokenMap | null {
  try {
    const obj = JSON.parse(dtcgJson) as Record<string, { $type?: string; $value: unknown; $description?: string }>;

    const cols = obj['columns']?.$value;
    const gutter = String(obj['gutter']?.$value ?? '2.625rem');
    const gutterHalf = String(obj['gutter-half']?.$value ?? '1.3125rem');

    const BP_KEYS = ['sm', 'md', 'lg', 'xl', 'xxl'] as const;
    const BP_LABELS: Record<string, string> = {
      sm: 'Small',
      md: 'Medium',
      lg: 'Large',
      xl: 'X-Large',
      xxl: 'XX-Large',
    };

    const breakpoints = BP_KEYS.map((k) => {
      const bp = String(obj[`breakpoint-${k}`]?.$value ?? '0rem');
      const container = String(obj[`container-${k}`]?.$value ?? '0rem');
      return {
        key: k,
        label: BP_LABELS[k] ?? k,
        bp,
        bpPx: remToPx(bp),
        container,
        containerPx: remToPx(container),
      };
    }).filter((b) => b.bpPx > 0);

    return {
      columns: typeof cols === 'number' ? cols : 12,
      gutter: { rem: gutter, px: remToPx(gutter) },
      gutterHalf: { rem: gutterHalf, px: remToPx(gutterHalf) },
      breakpoints,
    };
  } catch {
    return null;
  }
}

export async function generateMetadata() {
  const { props } = await fetchFoundationDocPageMarkdownAsync('docs/foundations/', 'grid', '/foundations');
  return { title: props.metadata.metaTitle, description: props.metadata.metaDescription };
}

export default async function GridPage() {
  const { props } = await fetchFoundationDocPageMarkdownAsync('docs/foundations/', 'grid', '/foundations');
  const config = getClientRuntimeConfig();
  const { content, menu, metadata, current } = props;

  const dtcg = await fetchDtcgTokenStrings('grid');
  const manifest = await fetchDtcgManifest();
  const grid = dtcg ? parseGridTokens(dtcg.dtcg) : null;

  const COLS = grid?.columns ?? 12;

  return (
    <Layout config={config} menu={menu} metadata={metadata} current={current}>
      <InlineEditHeader
        slug="foundations/grid"
        initialTitle={String(metadata.title ?? '')}
        initialDescription={String(metadata.description ?? '')}
        initialFrontmatter={metadata as Record<string, unknown>}
        markdown={content}
      >
        {dtcg && (
          <DownloadTokens
            componentId="grid"
            scss={dtcg.scss}
            css={dtcg.css}
            styleDictionary={null}
            types={null}
            tailwind={dtcg.tailwind}
            dtcg={dtcg.dtcg}
          />
        )}
        {manifest && <ProvenanceBadge manifest={manifest} />}
      </InlineEditHeader>

      <div className="lg:gap-10 lg:py-8 xl:grid xl:grid-cols-[1fr_280px]">
        <div>

          {/* ── Column Grid Visualization ─────────────────────────────── */}
          {grid ? (
            <section id="grid-columns" className="scroll-mt-24 pb-12">
              <h2 className="mb-1 text-2xl font-semibold">12-Column Grid</h2>
              <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
                {COLS} equal columns separated by a <code className="rounded bg-gray-100 px-1 dark:bg-gray-800">{grid.gutter.px}px</code> gutter
                ({grid.gutterHalf.px}px per side).
              </p>

              {/* Column visualizer */}
              <div className="overflow-x-auto rounded-xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900">
                <div
                  className="grid"
                  style={{
                    gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`,
                    gap: `${grid.gutter.px}px`,
                    minWidth: '480px',
                  }}
                >
                  {Array.from({ length: COLS }, (_, i) => (
                    <div key={i} className="flex flex-col items-center gap-1.5">
                      <div className="h-16 w-full rounded-sm bg-blue-500 opacity-80" />
                      <span className="text-[10px] font-medium text-gray-400">{i + 1}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-center gap-6 text-xs text-gray-400">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-3 w-3 rounded-sm bg-blue-500 opacity-80" />
                    Column
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-3 w-3 rounded-sm bg-gray-300 dark:bg-gray-600" />
                    Gutter ({grid.gutter.px}px)
                  </span>
                </div>
              </div>

              {/* Common span examples */}
              <div className="mt-6">
                <h3 className="mb-3 text-base font-medium text-gray-700 dark:text-gray-300">Common Column Spans</h3>
                <div className="flex flex-col gap-2">
                  {[
                    { span: 12, label: 'Full width', class: 'col-12' },
                    { span: 8,  label: 'Two-thirds', class: 'col-8' },
                    { span: 6,  label: 'Half',       class: 'col-6' },
                    { span: 4,  label: 'One-third',  class: 'col-4' },
                    { span: 3,  label: 'One-quarter', class: 'col-3' },
                  ].map(({ span, label, class: cls }) => (
                    <div key={span} className="flex items-center gap-4">
                      <div className="w-[200px] shrink-0">
                        <div
                          className="h-6 rounded-sm bg-blue-500"
                          style={{ width: `${(span / COLS) * 100}%` }}
                        />
                      </div>
                      <code className="w-16 shrink-0 text-xs text-gray-600 dark:text-gray-400">.{cls}</code>
                      <span className="text-xs text-gray-500">{label} — {span} of {COLS} columns</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          ) : (
            <div className="mb-10 rounded-lg border border-dashed border-gray-200 p-10 text-center text-sm text-gray-400">
              No grid tokens found. Run{' '}
              <code className="rounded bg-gray-100 px-1.5 py-0.5">npm run tokens:build</code> in the workspace and push to the registry.
            </div>
          )}

          {/* ── Breakpoints ───────────────────────────────────────────── */}
          {grid?.breakpoints && grid.breakpoints.length > 0 && (
            <section id="breakpoints" className="scroll-mt-24 pb-12">
              <h2 className="mb-1 text-2xl font-semibold">Breakpoints</h2>
              <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
                The grid adapts at five named breakpoints, each with a corresponding max container width.
              </p>

              {/* Breakpoint ruler */}
              <div className="mb-6 overflow-x-auto rounded-xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900">
                <div className="relative" style={{ minWidth: '560px', height: '64px' }}>
                  {grid.breakpoints.map((bp, i) => {
                    const maxBpPx = grid.breakpoints[grid.breakpoints.length - 1]!.bpPx + 200;
                    const left = (bp.bpPx / maxBpPx) * 100;
                    const colors = ['bg-blue-400', 'bg-blue-500', 'bg-blue-600', 'bg-blue-700', 'bg-blue-800'];
                    return (
                      <div
                        key={bp.key}
                        className="absolute top-0 flex flex-col items-start"
                        style={{ left: `${left}%` }}
                      >
                        <div className={`h-8 w-0.5 ${colors[i] ?? 'bg-blue-500'}`} />
                        <span className={`mt-1 rounded px-1.5 py-0.5 text-[10px] font-semibold text-white ${colors[i] ?? 'bg-blue-500'}`}>
                          {bp.label}
                        </span>
                        <span className="mt-0.5 text-[10px] text-gray-400">{bp.bpPx}px</span>
                      </div>
                    );
                  })}
                  {/* baseline bar */}
                  <div className="absolute bottom-6 left-0 right-0 h-px bg-gray-200 dark:bg-gray-700" />
                </div>
              </div>

              {/* Breakpoints table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-gray-400">
                      <th className="pb-2 pr-4 font-medium">Name</th>
                      <th className="pb-2 pr-4 font-medium">Breakpoint</th>
                      <th className="pb-2 pr-4 font-medium">Container max-width</th>
                      <th className="pb-2 pr-4 font-medium">Columns</th>
                      <th className="pb-2 font-medium">Gutter</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b text-gray-500 dark:text-gray-400">
                      <td className="py-2 pr-4 font-medium text-gray-700 dark:text-gray-300">xs</td>
                      <td className="py-2 pr-4 font-mono text-xs">&lt;576px</td>
                      <td className="py-2 pr-4 font-mono text-xs">100%</td>
                      <td className="py-2 pr-4">12</td>
                      <td className="py-2 font-mono text-xs">{grid.gutter.px}px</td>
                    </tr>
                    {grid.breakpoints.map((bp) => (
                      <tr key={bp.key} className="border-b text-gray-500 dark:text-gray-400">
                        <td className="py-2 pr-4 font-medium text-gray-700 dark:text-gray-300">{bp.label}</td>
                        <td className="py-2 pr-4 font-mono text-xs">≥{bp.bpPx}px</td>
                        <td className="py-2 pr-4">
                          <code className="rounded bg-gray-100 px-1 text-xs dark:bg-gray-800">
                            --grid-container-{bp.key}
                          </code>
                          <span className="ml-2 font-mono text-xs text-gray-400">{bp.container} ({bp.containerPx}px)</span>
                        </td>
                        <td className="py-2 pr-4">12</td>
                        <td className="py-2 font-mono text-xs">{grid.gutter.px}px</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* ── Container width visualization ─────────────────────────── */}
          {grid?.breakpoints && grid.breakpoints.length > 0 && (
            <section id="containers" className="scroll-mt-24 pb-12">
              <h2 className="mb-1 text-2xl font-semibold">Container Widths</h2>
              <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
                Each breakpoint sets a max-width on the container, centering content with automatic side margins.
              </p>
              <div className="flex flex-col gap-2">
                {grid.breakpoints.map((bp, i) => {
                  const maxW = grid.breakpoints[grid.breakpoints.length - 1]!.containerPx;
                  const pct = (bp.containerPx / maxW) * 100;
                  const colors = ['bg-blue-300', 'bg-blue-400', 'bg-blue-500', 'bg-blue-600', 'bg-blue-700'];
                  return (
                    <div key={bp.key} className="flex items-center gap-4">
                      <div className="w-[240px] shrink-0">
                        <div
                          className={`h-6 rounded-sm ${colors[i] ?? 'bg-blue-500'} transition-all`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <code className="w-28 shrink-0 text-xs text-gray-600 dark:text-gray-400">
                        --grid-container-{bp.key}
                      </code>
                      <span className="font-mono text-xs text-gray-500">{bp.container}</span>
                      <span className="text-xs text-gray-400">{bp.containerPx}px</span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── Token Output Tabs ────────────────────────────────────────── */}
          {dtcg && (
            <TokenOutputTabs
              css={dtcg.css}
              scss={dtcg.scss}
              tailwind={dtcg.tailwind}
              dtcg={dtcg.dtcg}
              name="grid"
            />
          )}

          <PrevNextNav
            previous={{ title: 'Spacing', href: '/foundations/spacing' }}
            next={{ title: 'Effects', href: '/foundations/effects' }}
          />
        </div>

        <AnchorNav
          groups={[
            { 'grid-columns': '12-Column Grid' },
            { breakpoints: 'Breakpoints' },
            { containers: 'Container Widths' },
          ]}
        />
      </div>
    </Layout>
  );
}
