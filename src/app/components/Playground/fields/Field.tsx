'use client';

import { useState } from 'react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Switch } from '../../ui/switch';
import { ChevronDownIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useEditContext } from '../EditContext';
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
  return Object.entries(obj).map(([key, value]: [string, any]) => {
    const currentPath = [...path, key];

    if (value.type === 'boolean') {
      return (
        <div key={key} className="flex items-center justify-between pb-4 pt-2">
          <FieldLabel label={obj[key].name || key} htmlFor={currentPath.join('.')} type={value.type} />
          <InputField fieldKey={currentPath} value={value} data={data} />
        </div>
      );
    }

    return (
      <div key={key} className="space-y-2 pb-6 pt-2">
        <div className="flex items-center justify-between">
          <FieldLabel label={obj[key].name || key} htmlFor={currentPath.join('.')} type={value.type} />
        </div>
        <InputField fieldKey={currentPath} value={value} data={data} />
      </div>
    );
  });
}

function ObjectField({ identifier, value, data }: { identifier: string[]; value: any; data: any }) {
  const { getData } = useEditContext();
  return <div className="space-y-2 rounded-lg">{renderFormFields(value.properties, getData(identifier, data), [...identifier])}</div>;
}

function ArrayField({ identifier, value }: { identifier: string[]; value: any; data: any }) {
  const { getData, handleInputChange } = useEditContext();
  if (!value.items?.properties) {
    return <span className="text-sm text-muted-foreground">Missing items properties</span>;
  }
  let items = getData(identifier);
  if (!items) items = [];

  return (
    <div className="space-y-2 rounded-lg">
      {items.map((_item: any, index: number) => (
        <ArrayItem key={index} identifier={[...identifier, index.toString()]} value={value} />
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          handleInputChange([...identifier], [...items, {}]);
        }}
      >
        <PlusIcon className="mr-1 h-4 w-4" /> Add to {value.name}
      </Button>
    </div>
  );
}

function ArrayItem({ identifier, value }: { identifier: string[]; value: any }) {
  const { handleInputChange, getData } = useEditContext();
  const [isOpen, setIsOpen] = useState(false);
  const item = getData(identifier);

  return (
    <div className="relative min-h-[30px] border-b p-3 transition-colors duration-100">
      <div className="flex items-center justify-between">
        <FieldLabel label="Item" htmlFor={identifier[identifier.length - 1]} type={value.items?.type || 'object'} />
        <div className="flex items-center space-x-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              // Remove this item from the parent array (was setting it to null,
              // which left an empty slot behind instead of deleting it).
              const parentPath = identifier.slice(0, -1);
              const idx = Number(identifier[identifier.length - 1]);
              const arr = getData(parentPath);
              if (Array.isArray(arr)) {
                handleInputChange(parentPath, arr.filter((_: unknown, i: number) => i !== idx));
              }
            }}
          >
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
  switch (resolveFieldType(value)) {
    case 'object':
      return <ObjectField identifier={fieldKey} value={value} data={data} />;
    case 'array':
      return <ArrayField identifier={fieldKey} value={value} data={data} />;
    case 'image':
      return <ImageField identifier={fieldKey} value={value} data={data} />;
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
