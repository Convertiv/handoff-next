import { startCase } from 'lodash';
import { fetchComponents, fetchDocPageMetadataAndContent, getClientRuntimeConfig, getCurrentSection, staticBuildMenu } from '../../../../components/util';
import ComponentDetailClient from './ComponentDetailClient';

export const dynamicParams = false;

export async function generateStaticParams() {
  const comps = fetchComponents()?.map((c) => ({ component: c.id })) ?? [];
  return comps.length > 0 ? comps : [{ component: '_placeholder' }];
}

export async function generateMetadata({ params }: { params: Promise<{ component: string }> }) {
  const { component } = await params;
  const components = fetchComponents()!;
  const config = getClientRuntimeConfig();
  const componentData = components.find((c) => c.id === component);
  const docs = fetchDocPageMetadataAndContent('docs/system/', component);
  const fallbackTitle = componentData?.name || startCase(component);
  const fallbackMetaTitle = `${fallbackTitle}${config?.app?.client ? ` | ${config.app.client} Design System` : ''}`;
  return {
    title: docs.metadata.metaTitle || fallbackMetaTitle,
    description: docs.metadata.metaDescription || componentData?.description,
  };
}

export default async function ComponentPage({ params }: { params: Promise<{ component: string }> }) {
  const { component } = await params;
  const components = fetchComponents()!;
  const menu = staticBuildMenu();
  const config = getClientRuntimeConfig();
  const componentData = components.find((c) => c.id === component);
  const docs = fetchDocPageMetadataAndContent('docs/system/', component);
  const componentHotReloadIsAvailable = process.env.NODE_ENV === 'development';

  const sameGroupComponents = components.filter((c) => c.group === componentData?.group);
  const groupIndex = sameGroupComponents.findIndex((c) => c.id === component);
  const previousComponent = sameGroupComponents[groupIndex - 1] ?? null;
  const nextComponent = sameGroupComponents[groupIndex + 1] ?? null;

  const fallbackTitle = componentData?.name || startCase(component);
  const fallbackMetaTitle = `${fallbackTitle}${config?.app?.client ? ` | ${config.app.client} Design System` : ''}`;

  return (
    <ComponentDetailClient
      id={component}
      menu={menu}
      config={config}
      current={getCurrentSection(menu, '/system') ?? []}
      metadata={{
        ...componentData,
        title: componentData?.name || docs.metadata.title || startCase(component),
        description: componentData?.description,
        metaTitle: docs.metadata.metaTitle || fallbackMetaTitle,
        metaDescription: docs.metadata.metaDescription || componentData?.description,
        image: docs.metadata.image || 'hero-brand-assets',
      }}
      componentHotReloadIsAvailable={componentHotReloadIsAvailable}
      previousComponent={previousComponent}
      nextComponent={nextComponent}
    />
  );
}
