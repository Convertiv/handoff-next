export const INCLUDE_FOUNDATIONS_SETTING_KEY = 'handoff.design.includeFoundations';
export const CUSTOM_FOUNDATION_IMAGE_SETTING_KEY = 'handoff.design.customFoundationImage';
export const CUSTOM_FOUNDATION_IMAGE_FILENAME = 'custom-foundations.png';
export const DESIGN_MD_SETTING_KEY = 'handoff.design.designMd';

export const BRAND_VOICE_SETTINGS = [
  {
    id: 'companyDescription',
    label: 'Company Description',
    storageKey: 'handoff.design.brandVoice.companyDescription',
    placeholder: 'Describe the company, audience, product category, and positioning.',
  },
  {
    id: 'copyDirection',
    label: 'Copy Direction',
    storageKey: 'handoff.design.brandVoice.copyDirection',
    placeholder: 'Add guidance for headlines, CTAs, value props, and product messaging.',
  },
  {
    id: 'copyLength',
    label: 'Copy Length',
    storageKey: 'handoff.design.brandVoice.copyLength',
    placeholder: 'Describe how much copy to generate so text fits the design, e.g. short headlines, concise body copy, 2-4 word CTAs.',
  },
  {
    id: 'voiceTone',
    label: 'Voice & Tone',
    storageKey: 'handoff.design.brandVoice.voiceTone',
    placeholder: 'Describe the voice, tone, personality, and level of formality.',
  },
  {
    id: 'preferredPhrases',
    label: 'Preferred Phrases',
    storageKey: 'handoff.design.brandVoice.preferredPhrases',
    placeholder: 'List phrases, terms, claims, or patterns the generated UI should prefer.',
  },
  {
    id: 'avoidedPhrases',
    label: 'Avoided Phrases',
    storageKey: 'handoff.design.brandVoice.avoidedPhrases',
    placeholder: 'List phrases, words, claims, or tonal choices the generated UI should avoid.',
  },
  {
    id: 'sampleCopy',
    label: 'Sample Copy',
    storageKey: 'handoff.design.brandVoice.sampleCopy',
    placeholder: 'Paste representative examples of approved copy.',
  },
] as const;

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
  {
    id: 'iconography',
    label: 'Iconography',
    description: 'Upload a reference image showing icon style, stroke weight, fill treatment, and visual metaphor patterns.',
    storageKey: 'handoff.design.componentReference.iconography',
    filename: 'iconography.png',
  },
] as const;
