export const anchorSlugify = (text: string): string => {
  let anchor = text.toString().toLowerCase();
  anchor = anchor.replace(/[^a-zA-Z0-9 ]/g, '');
  anchor = anchor.replace(/ /g, '-');
  return anchor;
};
