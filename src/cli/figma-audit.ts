import Handoff from '@handoff/index';
import { createFigmaAuditReport, loadFigmaComponentCatalog, type FigmaAuditReport } from '@handoff/figma/component-linking';
import { readComponentApi } from '@handoff/transformers/preview/component/api';
import { Logger } from '@handoff/utils/logger';

export type RunFigmaAuditOptions = {
  json?: boolean;
  failOnDrift?: boolean;
};

async function getAuditComponents(handoff: Handoff) {
  const runtimeComponents = handoff.runtimeConfig?.entries?.components ?? {};
  const componentIds = Object.keys(runtimeComponents);
  const builtComponents = await Promise.all(
    componentIds.map(async (id) => {
      const built = await readComponentApi(handoff, id);
      return built ? { ...runtimeComponents[id], ...built, id } : { ...runtimeComponents[id], id };
    })
  );
  return builtComponents;
}

function printReport(report: FigmaAuditReport): void {
  Logger.info(
    `Figma audit: ${report.summary.figmaComponents} Figma components, ${report.summary.handoffComponents} Handoff components, ` +
      `${report.summary.matched} matched, ${report.summary.unlinked} unlinked, ${report.summary.missingInFigma} missing in Figma, ` +
      `${report.summary.missingInHandoff} missing in Handoff, ${report.summary.metadataGaps} metadata gaps.`
  );

  const componentIssues = report.components.filter(
    (entry) => entry.status !== 'matched' || entry.missingMetadata.length > 0
  );
  if (componentIssues.length) {
    Logger.log('');
    Logger.warn('Handoff components needing attention:');
    for (const entry of componentIssues) {
      const metadata = entry.missingMetadata.length ? `; missing metadata: ${entry.missingMetadata.join(', ')}` : '';
      const match = entry.matchedFigmaComponentName ? `; figma: ${entry.matchedFigmaComponentName}` : '';
      Logger.log(`  - ${entry.id} [${entry.status}]${match}${metadata}`);
    }
  }

  if (report.figmaOnly.length) {
    Logger.log('');
    Logger.warn('Figma components missing in Handoff:');
    for (const entry of report.figmaOnly) {
      Logger.log(`  - ${entry.slug}${entry.figmaInstanceCount ? ` (${entry.figmaInstanceCount} variants)` : ''}`);
    }
  }
}

function hasDrift(report: FigmaAuditReport): boolean {
  return report.summary.unlinked > 0 || report.summary.missingInFigma > 0 || report.summary.missingInHandoff > 0 || report.summary.ambiguous > 0;
}

export async function runFigmaComponentAudit(handoff: Handoff, opts?: RunFigmaAuditOptions): Promise<FigmaAuditReport> {
  const catalog = await loadFigmaComponentCatalog(handoff);
  if (catalog.entries.length === 0) {
    throw new Error('No Figma components found. Run `handoff-app fetch` or verify Figma credentials and published components first.');
  }

  const components = await getAuditComponents(handoff);
  const report = createFigmaAuditReport(components, catalog);

  if (opts?.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }

  if (opts?.failOnDrift && hasDrift(report)) {
    throw new Error('Figma audit detected drift.');
  }

  return report;
}
