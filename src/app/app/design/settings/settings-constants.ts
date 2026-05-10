export const INCLUDE_FOUNDATIONS_SETTING_KEY = 'handoff.design.includeFoundations';
export const DESIGN_MD_SETTING_KEY = 'handoff.design.designMd';

export const COMPONENT_REFERENCE_SETTINGS = [
  {
    id: 'buttons',
    label: 'Buttons',
    description: 'Upload a reference image showing default button styles and states.',
    storageKey: 'handoff.design.componentReference.buttons',
    filename: 'buttons.png',
  },
  {
    id: 'inputs',
    label: 'Inputs',
    description: 'Upload a reference image showing default input, textarea, and form field styles.',
    storageKey: 'handoff.design.componentReference.inputs',
    filename: 'inputs.png',
  },
] as const;
