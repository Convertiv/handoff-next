'use client';

import Layout from '../../../../../components/Layout/Main';
import HeadersType from '../../../../../components/Typography/Headers';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../../../components/ui/table';

interface SpacingToken {
  key: string;
  name: string;
  value: string;
  px: number;
  description: string;
}

function parseSpacingTokens(dtcgJson: string): SpacingToken[] {
  try {
    const obj = JSON.parse(dtcgJson) as Record<string, { $type?: string; $value: string; $description?: string }>;
    return Object.entries(obj)
      .map(([key, token]) => {
        const value = token.$value ?? '0rem';
        const px = Math.round(parseFloat(value) * 16);
        return { key, name: `spacing-${key}`, value, px, description: token.$description ?? '' };
      })
      .sort((a, b) => a.px - b.px);
  } catch {
    return [];
  }
}

export default function TokenFoundationSpacingClient({ content, menu, metadata, current, config, dtcgJson }) {
  const tokens: SpacingToken[] = dtcgJson ? parseSpacingTokens(dtcgJson) : [];

  return (
    <Layout config={config} menu={menu} current={current} metadata={metadata}>
      <div className="flex flex-col gap-2 pb-7">
        <HeadersType.H1>{metadata.title}</HeadersType.H1>
        <p className="text-lg leading-relaxed text-gray-600 dark:text-gray-300">{metadata.description}</p>
      </div>

      {tokens.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[160px]">Token</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>px</TableHead>
              <TableHead>Description</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tokens.map((token) => (
              <TableRow key={token.key}>
                <TableCell className="font-mono text-sm font-medium">--{token.name}</TableCell>
                <TableCell className="font-mono text-sm">{token.value}</TableCell>
                <TableCell className="font-mono text-sm text-gray-500">{token.px}px</TableCell>
                <TableCell className="text-sm text-gray-500">{token.description}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-sm text-gray-400">
          No spacing tokens available. Run{' '}
          <code className="rounded bg-gray-100 px-1.5 py-0.5">npm run tokens:build</code> in the workspace and push to the registry.
        </p>
      )}
    </Layout>
  );
}
