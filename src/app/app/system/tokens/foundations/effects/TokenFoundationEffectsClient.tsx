'use client';

import groupBy from 'lodash/groupBy';
import upperFirst from 'lodash/upperFirst';
import Layout from '../../../../../components/Layout/Main';
import HeadersType from '../../../../../components/Typography/Headers';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../../../components/ui/table';

function EffectsTable({ group, effects }) {
  return (
    <div className="mb-10" id={`${group}-effects`}>
      <HeadersType.H3>{upperFirst(group)} Effects</HeadersType.H3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Value</TableHead>
            <TableHead>Reference</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {effects.map((effect) => (
            <TableRow key={effect.name}>
              <TableCell className="font-medium">{effect.name}</TableCell>
              <TableCell className="font-mono text-sm">{effect.effects?.map((e) => e.value).join(', ')}</TableCell>
              <TableCell className="font-mono text-sm text-gray-500">{effect.reference}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function TokenFoundationEffectsClient({ content, menu, metadata, current, config, design }) {
  const effectGroups = Object.fromEntries(Object.entries(groupBy(design.effect, 'group')));
  return (
    <Layout config={config} menu={menu} current={current} metadata={metadata}>
      <div className="flex flex-col gap-2 pb-7">
        <HeadersType.H1>{metadata.title}</HeadersType.H1>
        <p className="text-lg leading-relaxed text-gray-600 dark:text-gray-300">{metadata.description}</p>
      </div>
      {Object.keys(effectGroups).map((group) => (
        <EffectsTable key={group} group={group} effects={effectGroups[group]} />
      ))}
    </Layout>
  );
}
