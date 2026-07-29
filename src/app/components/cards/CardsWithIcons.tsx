import { ArrowRight } from '@phosphor-icons/react/dist/ssr';
import type { Icon } from '@phosphor-icons/react';

type CardsWithIconsProps = {
  items: [
    {
      title: string;
      description: string;
      icon: Icon;
      link: string;
      cta?: string;
    },
  ];
};

const CardsWithIcons = ({ items }) => (
  <div className="not-prose grid grid-cols-[repeat(auto-fit,minmax(100%,1fr))] gap-6 sm:grid-cols-[repeat(auto-fit,minmax(300px,1fr))]">
    {items.map((item, index) => (
      <a
        key={index}
        href={item.link}
        className="group rounded-xl border border-gray-100 p-7 transition-colors hover:border-gray-200 hover:bg-gray-100/50 dark:border-gray-900 dark:hover:border-gray-800 dark:hover:bg-gray-900"
      >
        <div className="flex flex-col items-start gap-2">
          <div className="mb-3 flex size-9 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800">
            <item.icon className="h-5 w-5 text-gray-500 dark:text-gray-400" />
          </div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold">{item.title}</h3>
            <ArrowRight className="h-4 w-4 opacity-0 transition-all group-hover:translate-x-1 group-hover:opacity-100" />
          </div>
          <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">{item.description}</p>
        </div>
      </a>
    ))}
  </div>
);
export default CardsWithIcons;
