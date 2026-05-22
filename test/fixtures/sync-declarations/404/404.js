/** @type {import('handoff-app').Component} */
module.exports = {
  id: '404',
  title: '404 Page',
  description: 'An error page for 404 or similar.',
  type: 'block',
  group: 'Full Width',
  entries: {
    scss: './style.scss',
    js: './script.js',
    template: './template.hbs',
  },
  should_do: ['Use for dedicated HTTP error pages.'],
  should_not_do: ['Do not use as a marketing hero.'],
  previews: {
    '404': {
      title: '404 (Page Not Found)',
      values: {
        code: '404',
        title: 'Page Not Found',
      },
    },
  },
  properties: {
    code: { name: 'Code', type: 'text', generic: 'true', default: '404' },
    title: { name: 'Title', type: 'text', generic: 'true', default: 'Page Not Found' },
  },
};
