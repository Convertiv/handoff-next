'use client';

import { useState, type ReactNode } from 'react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Switch } from '../../ui/switch';
import { ChevronDownIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useEditContext } from '../EditContext';
import { fieldLinkKey, useFieldLink } from '../FieldLinkContext';
import FieldLabel from './FieldLabel';
import { TextField } from './TextField';
import { RichTextField } from './RichTextField';
import { ImageField } from './ImageField';
import { LinkField } from './LinkField';
import { ButtonField } from './ButtonField';
import { SelectField } from './SelectField';
import { VideoFileField } from './VideoFileField';
import { SlotField } from './SlotField';
import { FunctionField } from './FunctionField';
import { RawJsonField } from './RawJsonField';

export function renderFormFields(obj: any, data: any, path: string[] = []) {
  return Object.entries(obj ?? {}).map(([key, value]: [string, any]) => {
    const currentPath = [...path, key];

    // A malformed descriptor should cost one field, not the whole editor. Same failure shape as the
    // array crash below: one bad property took down the page and left no way to fix it by hand.
    if (!value || typeof value !== 'object') return null;

    /**
     * A field that cannot be authored *and* has something else standing in for it: not rendered at all.
     *
     * `image-gallery`'s `thumbnailSlot` and `lightboxSlot` are the case. The component derives both from
     * `src`, which measurement now offers on the same item, so the two slots are pure noise — an author
     * types into them and the component discards it.
     *
     * Set only where a replacement exists (see `applyCapabilitiesToProperties`). A slot with nothing
     * standing in for it keeps its control and gets a warning instead, because an unresolved measurement is
     * not proof the field is unauthorable — the probe may simply never have reached it.
     */
    if (value.hidden === true) return null;

    if (value.type === 'boolean') {
      return (
        <FieldRow key={key} path={currentPath} className="flex items-center justify-between pb-4 pt-2">
          <FieldLabel label={obj[key].name || key} htmlFor={currentPath.join('.')} type={value.type} />
          <InputField fieldKey={currentPath} value={value} data={data} />
        </FieldRow>
      );
    }

    return (
      <FieldRow key={key} path={currentPath} className="space-y-2 pb-6 pt-2">
        <div className="flex items-center justify-between">
          <FieldLabel label={obj[key].name || key} htmlFor={currentPath.join('.')} type={value.type} />
        </div>
        <InputField fieldKey={currentPath} value={value} data={data} />
      </FieldRow>
    );
  });
}

/**
 * One field in the rail, linked to where it renders in the canvas (roadmap F.2).
 *
 * Hover here highlights there and vice versa. `onMouseEnter` does not bubble in React, so on nested fields the
 * innermost row wins — which is the one the pointer is actually over.
 *
 * Outside the playground `useFieldLink` returns an inert link, so this is a plain `div` with no listeners doing
 * anything: `ComponentWorkbenchDialog` renders these same fields with no canvas beside them.
 */
function FieldRow({
  path,
  className,
  children,
}: {
  path: string[];
  className: string;
  children: ReactNode;
}) {
  const { hovered, onHover } = useFieldLink();
  const key = fieldLinkKey(path.join('.'));
  const active = hovered !== null && hovered === key;
  return (
    <div
      className={active ? `${className} -mx-2 rounded-md bg-primary/5 px-2 ring-1 ring-primary/40` : className}
      onMouseEnter={() => onHover(key)}
      onMouseLeave={() => onHover(null)}
    >
      {children}
    </div>
  );
}

function ObjectField({ identifier, value, data }: { identifier: string[]; value: any; data: any }) {
  const { getData } = useEditContext();
  return <div className="space-y-2 rounded-lg">{renderFormFields(value.properties, getData(identifier, data), [...identifier])}</div>;
}

/** Remove index `idx`'s parent-array element (shared by object + scalar items). */
function useRemoveArrayItem() {
  const { getData, handleInputChange } = useEditContext();
  return (identifier: string[]) => {
    const parentPath = identifier.slice(0, -1);
    const idx = Number(identifier[identifier.length - 1]);
    const arr = getData(parentPath);
    if (Array.isArray(arr)) {
      handleInputChange(parentPath, arr.filter((_: unknown, i: number) => i !== idx));
    }
  };
}

/** True when array items are objects with their own sub-fields (vs a scalar/leaf editor). */
function hasObjectItems(value: any): boolean {
  return !!value?.items?.properties && Object.keys(value.items.properties).length > 0;
}

/**
 * Coerce whatever is stored into something an array editor can render.
 *
 * A field declared `type: 'array'` does not always hold an array. `alert.buttonSlot` is declared as one
 * but its preview stores a single serialized React element — an object — and `items.map(...)` then
 * threw `items.map is not a function`, which the error boundary showed as "This page couldn't load".
 * Every component whose array-typed slot has a non-array preview value hit the same wall, so editing
 * them was impossible.
 *
 * A single value becomes a one-item array, which is what the author meant. Anything else becomes empty
 * rather than crashing: an editor that opens with nothing in it can still be used, and the page around
 * it survives.
 */
export function toArrayItems(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw == null || raw === '') return [];
  return [raw];
}

function ArrayField({ identifier, value }: { identifier: string[]; value: any; data: any }) {
  const { getData, handleInputChange } = useEditContext();
  const items: any[] = toArrayItems(getData(identifier));
  const objectItems = hasObjectItems(value);
  // Scalar/leaf items (e.g. a `fields` annotation's `of: 'button'`) carry an
  // item editor via `items.editorType`/`items.type` and no `items.properties`.
  const itemDescriptor = value.items ?? { type: 'text' };

  const emptyItem = () => {
    if (objectItems) return {};
    const t = resolveFieldType(itemDescriptor);
    if (t === 'number') return 0;
    if (t === 'boolean') return false;
    // `image-url` belongs with the strings: its value *is* the URL. Seeding `{}` would hand the picker an
    // object to write into and land back at `<img src="[object Object]">` from the other direction.
    if (t === 'text' || t === 'string' || t === 'richtext' || t === 'slot' || t === 'image-url') return '';
    return {}; // button / link / image / object-shaped leaves
  };

  return (
    <div className="space-y-2 rounded-lg">
      {items.map((_item, index) =>
        objectItems ? (
          <ArrayItem key={index} identifier={[...identifier, index.toString()]} value={value} />
        ) : (
          <ArrayScalarItem key={index} identifier={[...identifier, index.toString()]} itemValue={itemDescriptor} />
        )
      )}
      <Button variant="outline" size="sm" onClick={() => handleInputChange([...identifier], [...items, emptyItem()])}>
        <PlusIcon className="mr-1 h-4 w-4" /> Add to {value.name}
      </Button>
    </div>
  );
}

/** One scalar/leaf array element — a single editor (button/link/image/text/…) + remove. */
function ArrayScalarItem({ identifier, itemValue }: { identifier: string[]; itemValue: any }) {
  const { getData } = useEditContext();
  const remove = useRemoveArrayItem();
  return (
    <div className="relative flex items-start gap-2 border-b p-3">
      <div className="min-w-0 flex-1">
        <InputField fieldKey={identifier} value={itemValue} data={getData(identifier)} />
      </div>
      <Button variant="ghost" size="sm" onClick={() => remove(identifier)}>
        <Trash2Icon className="h-4 w-4" />
      </Button>
    </div>
  );
}

function ArrayItem({ identifier, value }: { identifier: string[]; value: any }) {
  const { getData } = useEditContext();
  const [isOpen, setIsOpen] = useState(false);
  const item = getData(identifier);
  const remove = useRemoveArrayItem();

  return (
    <div className="relative min-h-[30px] border-b p-3 transition-colors duration-100">
      <div className="flex items-center justify-between">
        <FieldLabel label="Item" htmlFor={identifier[identifier.length - 1]} type={value.items?.type || 'object'} />
        <div className="flex items-center space-x-2">
          <Button variant="ghost" size="sm" onClick={() => remove(identifier)}>
            <Trash2Icon className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setIsOpen(!isOpen)}>
            <ChevronDownIcon className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </Button>
        </div>
      </div>
      <div
        className="overflow-hidden transition-all duration-200"
        style={{
          maxHeight: isOpen ? '2000px' : 0,
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? 'auto' : 'none',
        }}
      >
        {renderFormFields(value.items.properties, item, [...identifier])}
      </div>
    </div>
  );
}

/**
 * Resolve a field descriptor to the control type the switch renders.
 *
 * TS-inference schemas (8x8) carry both a render `type` and an inference
 * `kind`. The `type` can be a literal TS type string (e.g. `React.ReactNode`)
 * that the switch wouldn't otherwise recognise, so we fall back to `kind`
 * to map slots/functions/unknowns onto real controls instead of dumping JSON.
 */
export function resolveFieldType(value: any): string {
  // An authored `editorType` (fields annotation, §12a) is the intent signal and
  // wins on widget selection — a `React.ReactNode` slot annotated `image` should
  // render the image editor, not the slot fallback.
  const BUILDER_EDITORS = new Set([
    // `image-url` is a picker whose value is the URL string itself, for a field like an image item's
    // `src`. `image` is bound to a whole image object and writes `src`/`srcset`/`alt` inside it.
    'text', 'richtext', 'number', 'boolean', 'select', 'image', 'image-url', 'link', 'button', 'object', 'array', 'slot',
  ]);
  const editorType = value?.editorType;
  if (typeof editorType === 'string' && BUILDER_EDITORS.has(editorType)) return editorType;

  const type = value?.type;
  if (type === 'React.ReactNode') return 'slot';
  if (type === 'function') return 'function';
  if (type === 'any') return 'any';
  const known = new Set([
    'object', 'array', 'image', 'video_file', 'button', 'link',
    'text', 'string', 'richtext', 'number', 'boolean', 'select', 'enum',
  ]);
  if (typeof type === 'string' && known.has(type)) return type;
  // Unrecognised `type` — lean on the inference `kind`.
  switch (value?.kind) {
    case 'slot': return 'slot';
    case 'function': return 'function';
    case 'enum': return 'enum';
    case 'object': return 'object';
    case 'array': return 'array';
    case 'primitive': return 'text';
    case 'unknown': return 'any';
    default: return type ?? 'any';
  }
}

export function InputField({ fieldKey, value, data }: { fieldKey: string[]; value: any; data: any }) {
  const { getData, handleInputChange } = useEditContext();

  /** Replaced by another field: gone entirely. Same rule as `renderFormFields`, for the array-item path. */
  if (value?.hidden === true) return null;

  /**
   * Measured as accepting nothing, with nothing offered in its place.
   *
   * The control stays and says so. An unresolved measurement is not proof a field is unauthorable — the
   * probe may not have reached it, which is the whole reason `probeContext` exists — and
   * `pricing-carousel.modalFooterSlot` is the live example: it renders inside a modal no prop can open, so
   * the probe cannot see it while an author almost certainly can. Removing that control would take away
   * something that works. Saying "this may do nothing" takes away nothing.
   */
  const notEditable = value?.editable === false;

  return (
    <>
      {notEditable ? (
        <p className="mb-1.5 text-[11px] text-amber-700 dark:text-amber-400">
          {typeof value?.note === 'string' && value.note
            ? value.note
            : 'This component accepts no editable value here — set in code.'}
        </p>
      ) : null}
      <InputControl fieldKey={fieldKey} value={value} data={data} getData={getData} handleInputChange={handleInputChange} />
    </>
  );
}

function InputControl({
  fieldKey,
  value,
  data,
  getData,
  handleInputChange,
}: {
  fieldKey: string[];
  value: any;
  data: any;
  getData: (k: string[]) => any;
  handleInputChange: (k: string[], v: any) => void;
}) {
  switch (resolveFieldType(value)) {
    case 'object':
      return <ObjectField identifier={fieldKey} value={value} data={data} />;
    case 'array':
      return <ArrayField identifier={fieldKey} value={value} data={data} />;
    case 'image':
      return <ImageField identifier={fieldKey} value={value} data={data} />;
    // The value at this path IS the URL, so the picker writes a string here rather than an object.
    case 'image-url':
      return <ImageField identifier={fieldKey} value={value} data={data} scalar />;
    case 'video_file':
      return <VideoFileField identifier={fieldKey} value={value} data={data} />;
    case 'button':
      return <ButtonField identifier={fieldKey} value={value} data={data} />;
    case 'link':
      return <LinkField identifier={fieldKey} value={value} data={data} />;
    case 'text':
    case 'string':
      return <TextField identifier={fieldKey} value={value} data={data} />;
    case 'richtext':
      return <RichTextField identifier={fieldKey} value={value} data={data} />;
    case 'number':
      return <Input id={fieldKey[fieldKey.length - 1]} value={getData(fieldKey) ?? ''} onChange={(e) => handleInputChange([...fieldKey], Number(e.target.value))} type="number" />;
    case 'boolean':
      return (
        <Switch
          id={fieldKey[fieldKey.length - 1]}
          checked={!!getData(fieldKey)}
          onCheckedChange={(checked) => handleInputChange([...fieldKey], checked)}
        />
      );
    case 'select':
    case 'enum':
      return <SelectField identifier={fieldKey} value={value} data={data} />;
    case 'slot':
      return <SlotField identifier={fieldKey} value={value} data={data} />;
    case 'function':
      return <FunctionField identifier={fieldKey} value={value} data={data} />;
    case 'any':
      return <RawJsonField identifier={fieldKey} value={value} data={data} />;
    default:
      // Unknown shape — offer a raw JSON editor rather than dumping the descriptor.
      return <RawJsonField identifier={fieldKey} value={value} data={data} />;
  }
}
