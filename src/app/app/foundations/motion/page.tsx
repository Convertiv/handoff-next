import { DownloadTokens } from '../../../components/DownloadTokens';
import { ProvenanceBadge } from '../../../components/Foundations/ProvenanceBadge';
import { TokenOutputTabs } from '../../../components/Foundations/TokenOutputTabs';
import { InlineEditHeader } from '../../../components/InlineEdit/InlineEditHeader';
import Layout from '../../../components/Layout/Main';
import AnchorNav from '../../../components/Navigation/AnchorNav';
import PrevNextNav from '../../../components/Navigation/PrevNextNav';
import { fetchFoundationDocPageMarkdownAsync, getClientRuntimeConfig } from '../../../components/util';
import { fetchDtcgManifest, fetchDtcgTokenStrings } from '../../../components/util/dtcg';

interface DurationToken { key: string; name: string; value: string; ms: number; description: string }
interface EasingToken  { key: string; name: string; bezier: [number, number, number, number]; description: string }

interface MotionTokenMap { durations: DurationToken[]; easings: EasingToken[] }

function parseMotionTokens(dtcgJson: string): MotionTokenMap {
  try {
    const obj = JSON.parse(dtcgJson) as Record<string, { $type?: string; $value: unknown; $description?: string }>;
    const durations: DurationToken[] = [];
    const easings: EasingToken[] = [];
    for (const [key, token] of Object.entries(obj)) {
      if (token.$type === 'duration') {
        const value = String(token.$value ?? '0ms');
        durations.push({ key, name: `motion-${key}`, value, ms: parseInt(value, 10), description: token.$description ?? '' });
      } else if (token.$type === 'cubicBezier' && Array.isArray(token.$value)) {
        easings.push({ key, name: `motion-${key}`, bezier: token.$value as [number, number, number, number], description: token.$description ?? '' });
      }
    }
    durations.sort((a, b) => a.ms - b.ms);
    return { durations, easings };
  } catch {
    return { durations: [], easings: [] };
  }
}

function bezierToPath(bz: [number, number, number, number], size = 80): string {
  const [x1, y1, x2, y2] = bz;
  const p = (v: number) => Math.round(v * size);
  return `M 0 ${size} C ${p(x1)} ${size - p(y1)} ${p(x2)} ${size - p(y2)} ${size} 0`;
}

export async function generateMetadata() {
  const { props } = await fetchFoundationDocPageMarkdownAsync('docs/foundations/', 'motion', '/foundations');
  return { title: props.metadata.metaTitle, description: props.metadata.metaDescription };
}

export default async function MotionPage() {
  const { props } = await fetchFoundationDocPageMarkdownAsync('docs/foundations/', 'motion', '/foundations');
  const config = getClientRuntimeConfig();
  const { content, menu, metadata, current } = props;

  const dtcg     = await fetchDtcgTokenStrings('motion');
  const manifest = await fetchDtcgManifest();
  const motion   = dtcg ? parseMotionTokens(dtcg.dtcg) : { durations: [], easings: [] };
  const hasTokens = motion.durations.length > 0 || motion.easings.length > 0;

  const maxMs = Math.max(...motion.durations.map((d) => d.ms), 1);

  return (
    <Layout config={config} menu={menu} metadata={metadata} current={current}>
      <InlineEditHeader
        slug="foundations/motion"
        initialTitle={String(metadata.title ?? '')}
        initialDescription={String(metadata.description ?? '')}
        initialFrontmatter={metadata as Record<string, unknown>}
        markdown={content}
      >
        {dtcg && (
          <DownloadTokens
            componentId="motion"
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
          {!hasTokens && (
            <div className="mb-10 rounded-lg border border-dashed border-gray-200 p-10 text-center text-sm text-gray-400">
              No motion tokens found. Run{' '}
              <code className="rounded bg-gray-100 px-1.5 py-0.5">npm run tokens:build</code> in the workspace and push to the registry.
            </div>
          )}

          {/* ── Durations ─────────────────────────────────────────────── */}
          {motion.durations.length > 0 && (
            <section id="duration" className="scroll-mt-24 pb-12">
              <h2 className="mb-1 text-2xl font-semibold">Duration</h2>
              <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
                Five steps from micro-interaction to complex orchestration. Choose the shortest duration that still feels intentional.
              </p>
              <div className="flex flex-col gap-3">
                {motion.durations.map((tok) => (
                  <div key={tok.key} className="flex items-center gap-4">
                    <div className="w-48 shrink-0">
                      <div
                        className="h-7 rounded-sm bg-blue-500 transition-none"
                        style={{ width: `${Math.max((tok.ms / maxMs) * 100, 6)}%` }}
                      />
                    </div>
                    <code className="w-40 shrink-0 text-xs text-gray-600 dark:text-gray-400">--{tok.name}</code>
                    <span className="w-14 shrink-0 font-mono text-xs text-gray-500">{tok.value}</span>
                    <span className="text-xs text-gray-400">{tok.description}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Easing ────────────────────────────────────────────────── */}
          {motion.easings.length > 0 && (
            <section id="easing" className="scroll-mt-24 pb-12">
              <h2 className="mb-1 text-2xl font-semibold">Easing</h2>
              <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
                Cubic bézier curves that give motion a sense of physics. Use ease-out for elements entering, ease-in for elements leaving.
              </p>
              <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5">
                {motion.easings.map((tok) => {
                  const [x1, y1, x2, y2] = tok.bezier;
                  const size = 80;
                  return (
                    <div key={tok.key} className="flex flex-col items-center gap-2">
                      <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900">
                        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                          {/* grid */}
                          <line x1="0" y1={size} x2={size} y2="0" stroke="currentColor" strokeWidth="0.5" strokeDasharray="3 3" className="text-gray-200 dark:text-gray-700" />
                          {/* control arms */}
                          <line x1="0" y1={size} x2={x1 * size} y2={size - y1 * size} stroke="currentColor" strokeWidth="0.75" className="text-blue-300" />
                          <line x1={size} y1="0" x2={x2 * size} y2={size - y2 * size} stroke="currentColor" strokeWidth="0.75" className="text-blue-300" />
                          {/* control handles */}
                          <circle cx={x1 * size} cy={size - y1 * size} r="3" className="fill-blue-400" />
                          <circle cx={x2 * size} cy={size - y2 * size} r="3" className="fill-blue-400" />
                          {/* curve */}
                          <path d={bezierToPath(tok.bezier, size)} fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-600 dark:text-blue-400" />
                        </svg>
                      </div>
                      <span className="text-center text-xs font-medium text-gray-700 dark:text-gray-300">
                        {tok.key.replace('easing-', '')}
                      </span>
                      <span className="font-mono text-[10px] text-gray-400">
                        {tok.bezier.map((v) => v.toFixed(3).replace(/\.?0+$/, '')).join(', ')}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Easing reference table */}
              <div className="mt-8 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-gray-400">
                      <th className="pb-2 pr-4 font-medium">Token</th>
                      <th className="pb-2 pr-4 font-medium">Cubic bézier</th>
                      <th className="pb-2 font-medium">When to use</th>
                    </tr>
                  </thead>
                  <tbody>
                    {motion.easings.map((tok) => (
                      <tr key={tok.key} className="border-b text-gray-500 dark:text-gray-400">
                        <td className="py-2 pr-4">
                          <code className="rounded bg-gray-100 px-1 text-xs dark:bg-gray-800">--{tok.name}</code>
                        </td>
                        <td className="py-2 pr-4 font-mono text-xs">
                          cubic-bezier({tok.bezier.join(', ')})
                        </td>
                        <td className="py-2 text-xs text-gray-400">{tok.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {dtcg && (
            <TokenOutputTabs
              css={dtcg.css}
              scss={dtcg.scss}
              tailwind={dtcg.tailwind}
              dtcg={dtcg.dtcg}
              name="motion"
            />
          )}

          <PrevNextNav
            previous={{ title: 'Border Radius', href: '/foundations/border-radius' }}
            next={{ title: 'Focus States', href: '/foundations/focus' }}
          />
        </div>

        <AnchorNav
          groups={[
            { duration: 'Duration' },
            { easing: 'Easing' },
          ]}
        />
      </div>
    </Layout>
  );
}
