'use client';

import groupBy from 'lodash/groupBy';
import upperFirst from 'lodash/upperFirst';
import Layout from '../../../../../components/Layout/Main';
import HeadersType from '../../../../../components/Typography/Headers';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../../../components/ui/table';

function ColorGroupTable({ group, colors }) {
  return (
    <div className="mb-10" id={`${group}-colors`}>
      <HeadersType.H3>{upperFirst(group)} Colors</HeadersType.H3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[60px]">Swatch</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Value</TableHead>
            <TableHead>Reference</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {colors.map((color) => (
            <TableRow key={color.name}>
              <TableCell>
                <div className="h-8 w-8 rounded border border-gray-200" style={{ backgroundColor: color.value }} />
              </TableCell>
              <TableCell className="font-medium">{color.name}</TableCell>
              <TableCell className="font-mono text-sm">{color.value}</TableCell>
              <TableCell className="font-mono text-sm text-gray-500">{color.reference}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function TokenFoundationColorsClient({ content, menu, metadata, current, config, design }) {
  const colorGroups = Object.fromEntries(Object.entries(groupBy(design.color, 'group')));
  return (
    <Layout config={config} menu={menu} current={current} metadata={metadata}>
      <div className="flex flex-col gap-2 pb-7">
        <HeadersType.H1>{metadata.title}</HeadersType.H1>
        <p className="text-lg leading-relaxed text-gray-600 dark:text-gray-300">{metadata.description}</p>
      </div>
      {Object.keys(colorGroups).map((group) => (
        <ColorGroupTable key={group} group={group} colors={colorGroups[group]} />
      ))}
    </Layout>
  );
}
