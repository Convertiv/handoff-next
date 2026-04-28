import { startCase } from 'lodash';
import { fetchCompDocPageMarkdown, fetchComponents, getClientRuntimeConfig, getCurrentSection, getTokensForRuntime, staticBuildMenu } from '../../../../../components/util';
import TokenComponentClient from './TokenComponentClient';

export const dynamicParams = false;

export async function generateStaticParams() {
  const comps = fetchComponents()?.map((c) => ({ component: c.id })) ?? [];
  return comps.length > 0 ? comps : [{ component: '_placeholder' }];
}

export async function generateMetadata({ params }: { params: Promise<{ component: string }> }) {
  const { component } = await params;
  const { props } = fetchCompDocPageMarkdown('docs/system/', component, '/system');
  const config = getClientRuntimeConfig();
  return {
    title: props.metadata.metaTitle || `${startCase(component)} Tokens | ${config?.app?.client} Design System`,
    description: props.metadata.metaDescription,
  };
}

export default async function TokenComponentPage({ params }: { params: Promise<{ component: string }> }) {
  const { component } = await params;
  const menu = staticBuildMenu();
  const config = getClientRuntimeConfig();
  const { props } = fetchCompDocPageMarkdown('docs/system/', component, '/system');
  const tokens = await getTokensForRuntime();
  const componentObject = tokens.components?.[component] ?? {};

  return (
    <TokenComponentClient
      id={component}
      component={componentObject}
      menu={menu}
      config={config}
      current={getCurrentSection(menu, '/system') ?? []}
      metadata={{
        ...props.metadata,
        title: props.metadata.title || startCase(component),
      }}
      scss={props.scss}
      css={props.css}
      styleDictionary={props.styleDictionary}
      types={props.types}
    />
  );
}
