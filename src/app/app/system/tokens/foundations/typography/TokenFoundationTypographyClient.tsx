'use client';

import upperFirst from 'lodash/upperFirst';
import Layout from '../../../../../components/Layout/Main';
import HeadersType from '../../../../../components/Typography/Headers';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../../../components/ui/table';

export default function TokenFoundationTypographyClient({ content, menu, metadata, current, config, design }) {
  const typography = design.typography ?? [];
  return (
    <Layout config={config} menu={menu} current={current} metadata={metadata}>
      <div className="flex flex-col gap-2 pb-7">
        <HeadersType.H1>{metadata.title}</HeadersType.H1>
        <p className="text-lg leading-relaxed text-gray-600 dark:text-gray-300">{metadata.description}</p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Font</TableHead>
            <TableHead>Weight</TableHead>
            <TableHead>Size</TableHead>
            <TableHead>Line Height</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {typography.map((type) => (
            <TableRow key={type.machine_name}>
              <TableCell className="font-medium">{type.name}</TableCell>
              <TableCell>{type.values.fontFamily}</TableCell>
              <TableCell>{type.values.fontWeight}</TableCell>
              <TableCell>{type.values.fontSize}px</TableCell>
              <TableCell>{type.values.lineHeightPx}px</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Layout>
  );
}
